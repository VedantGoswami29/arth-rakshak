import type { Snapshot, User } from './types';

const TOKEN_KEY = 'fc_token';

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: (() => void) | null) => {
  onUnauthorized = fn;
};

function headers(json = true): HeadersInit {
  const h: Record<string, string> = {};
  if (json) h['Content-Type'] = 'application/json';
  const t = tokenStore.get();
  if (t) h.Authorization = `Bearer ${t}`;
  return h;
}

async function toError(res: Response): Promise<ApiError> {
  let message = `Request failed (${res.status})`;
  try {
    const body = await res.json();
    if (body?.error) message = body.error;
    if (Array.isArray(body?.issues) && body.issues[0]?.message) message = body.issues[0].message;
  } catch {
    /* non-JSON body */
  }
  return new ApiError(res.status, message);
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: headers(body !== undefined),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await toError(res);
    // An expired/revoked token on an authenticated route → sign out. (Login failures are 401 too, but have no token.)
    if (res.status === 401 && tokenStore.get() && !path.startsWith('/auth/')) onUnauthorized?.();
    throw err;
  }
  return (await res.json()) as T;
}

interface AuthResponse {
  user: User;
  token: string;
}

export const api = {
  register: (email: string, password: string, name?: string) =>
    request<AuthResponse>('POST', '/auth/register', { email, password, ...(name ? { name } : {}) }),
  login: (email: string, password: string) => request<AuthResponse>('POST', '/auth/login', { email, password }),
  me: () => request<{ user: User }>('GET', '/api/me'),
  state: () => request<Snapshot>('GET', '/api/state'),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ token: string }>('POST', '/api/me/password', { currentPassword, newPassword }),
  logoutAll: () => request<{ ok: true }>('POST', '/api/me/logout-all'),
  deleteData: () => request<unknown>('DELETE', '/api/me/data'),
  deleteAccount: (password: string) => request<unknown>('DELETE', '/api/me', { password }),
};

export interface StreamHandlers {
  onText: (delta: string) => void;
  onState: (snapshot: Snapshot) => void;
  onError: (message: string) => void;
}

/** POST /api/chat/stream and parse the Server-Sent Events by hand (EventSource can't POST or send headers). */
export async function streamChat(
  message: string,
  threadId: string,
  handlers: StreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ message, threadId }),
    signal,
  });
  if (!res.ok || !res.body) {
    if (res.status === 401 && tokenStore.get()) onUnauthorized?.();
    throw await toError(res);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const dispatch = (raw: string) => {
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of raw.split('\n')) {
      if (line.startsWith(':')) continue; // heartbeat comment
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
    if (dataLines.length === 0) return;
    const data = JSON.parse(dataLines.join('\n'));
    if (event === 'text') handlers.onText(data.delta as string);
    else if (event === 'state') handlers.onState(data as Snapshot);
    else if (event === 'error') handlers.onError((data.error as string) ?? 'Chat failed');
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (raw.trim()) dispatch(raw);
    }
  }
  if (buffer.trim()) dispatch(buffer);
}
