import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { streamChat } from '../lib/api';
import type { ChatMessage, Snapshot } from '../lib/types';
import { btnPrimary, inputCls } from './ui';

const SUGGESTIONS = [
  { icon: '💼', text: 'My income is $8,000/month and I have 2 dependants.' },
  { icon: '🏠', text: 'My rent is $2,400, groceries $600 and I pay $120 for streaming.' },
  { icon: '🚗', text: 'Add a $5,000 car loan at 7% with a $250 minimum payment.' },
  { icon: '📊', text: 'Analyze my budget' },
  { icon: '🐷', text: 'What should I save?' },
  { icon: '🔍', text: 'Run a full review' },
];

const QUICK_ACTIONS = [
  { icon: '📊', label: 'Budget', text: 'Analyze my budget' },
  { icon: '🐷', label: 'Savings', text: 'What should I save?' },
  { icon: '🧾', label: 'Debt plan', text: 'Plan my debt payoff' },
  { icon: '🔍', label: 'Full review', text: 'Run a full review' },
];

const uid = () => crypto.randomUUID();
const storageKey = (userId: string, threadId: string) => `fc_chat_${userId}_${threadId}`;
const MAX_LEN = 4000;

function loadMessages(userId: string, threadId: string): ChatMessage[] {
  try {
    return JSON.parse(localStorage.getItem(storageKey(userId, threadId)) ?? '[]') as ChatMessage[];
  } catch {
    return [];
  }
}

function useWorkingLabel(active: boolean): string {
  const [s, setS] = useState(0);
  useEffect(() => {
    if (!active) {
      setS(0);
      return;
    }
    const t = setInterval(() => setS((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [active]);
  return s < 4 ? 'thinking…' : s < 12 ? 'crunching the numbers…' : 'almost there…';
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label="Copy message"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        });
      }}
      className="absolute -bottom-2 right-2 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-500 opacity-0 shadow-sm transition hover:text-slate-800 group-hover:opacity-100 focus:opacity-100 dark:border-slate-700 dark:bg-slate-800"
    >
      {done ? 'Copied ✓' : 'Copy'}
    </button>
  );
}

interface Props {
  userId: string;
  threadId: string;
  onSnapshot: (s: Snapshot) => void;
  onBusyChange?: (busy: boolean) => void;
}

export default function ChatPanel({ userId, threadId, onSnapshot, onBusyChange }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadMessages(userId, threadId));
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [showJump, setShowJump] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);
  const workingLabel = useWorkingLabel(busy);

  useEffect(() => {
    setMessages(loadMessages(userId, threadId));
  }, [userId, threadId]);

  useEffect(() => {
    if (busy) return;
    try {
      localStorage.setItem(storageKey(userId, threadId), JSON.stringify(messages.slice(-100)));
    } catch {
      /* storage full / disabled */
    }
  }, [messages, busy, userId, threadId]);

  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  // Follow the stream only while the user is already at the bottom.
  useEffect(() => {
    if (stick.current) endRef.current?.scrollIntoView({ behavior: busy ? 'auto' : 'smooth', block: 'end' });
  }, [messages, busy]);

  // Auto-growing textarea.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  useEffect(() => () => abortRef.current?.abort(), []);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stick.current = near;
    setShowJump(!near);
  }

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    setInput('');
    setBusy(true);
    stick.current = true;

    const assistantId = uid();
    setMessages((m) => [...m, { id: uid(), role: 'user', content }, { id: assistantId, role: 'assistant', content: '' }]);

    const patch = (fn: (m: ChatMessage) => ChatMessage) => setMessages((all) => all.map((m) => (m.id === assistantId ? fn(m) : m)));

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamChat(
        content,
        threadId,
        {
          onText: (delta) => patch((m) => ({ ...m, content: m.content + delta })),
          onState: onSnapshot,
          onError: (msg) => patch((m) => ({ ...m, content: m.content || msg, error: true })),
        },
        controller.signal,
      );
      patch((m) => (m.content ? m : { ...m, content: 'Done — check the panel on the right.' }));
    } catch (err) {
      if (controller.signal.aborted) {
        patch((m) => (m.content ? m : { ...m, content: '(stopped)' }));
      } else {
        patch((m) => ({ ...m, content: err instanceof Error ? err.message : 'Request failed', error: true }));
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
      taRef.current?.focus();
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(input);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  }

  const last = messages[messages.length - 1];
  const thinking = busy && last?.role === 'assistant' && last.content === '';
  const streaming = busy && last?.role === 'assistant' && last.content !== '';

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="mx-auto max-w-lg pt-6 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 animate-fade-up items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-2xl shadow-md">📈</div>
            <p className="animate-fade-up text-sm text-slate-600 dark:text-slate-300">Tell me about your finances in plain language, then ask for an analysis. Tap one to start:</p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {SUGGESTIONS.map((s, i) => (
                <button
                  key={s.text}
                  onClick={() => void send(s.text)}
                  style={{ animationDelay: `${80 + i * 60}ms` }}
                  className="flex animate-fade-up items-start gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left text-xs shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-400 hover:shadow-md active:scale-[0.98] dark:border-slate-700 dark:bg-slate-900"
                >
                  <span className="text-base leading-none">{s.icon}</span>
                  <span>{s.text}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => {
          const isUser = m.role === 'user';
          const isLast = m.id === last?.id;
          return (
            <div key={m.id} className={`flex animate-fade-up items-end gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
              {!isUser && (
                <span className="mb-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-[11px] font-bold text-white">AI</span>
              )}
              <div
                className={`group relative max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm leading-relaxed ${
                  isUser
                    ? 'rounded-br-md bg-emerald-600 text-white'
                    : m.error
                      ? 'rounded-bl-md bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'
                      : 'rounded-bl-md bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800'
                }`}
              >
                {m.content ||
                  (thinking && isLast ? (
                    <span className="inline-flex items-center gap-1 text-slate-500">
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:150ms]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:300ms]" />
                      <span className="ml-1 text-xs">{workingLabel}</span>
                    </span>
                  ) : null)}
                {streaming && isLast && <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-caret bg-emerald-600" />}
                {!isUser && m.content && !m.error && !(streaming && isLast) && <CopyButton text={m.content} />}
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {showJump && (
        <button
          type="button"
          onClick={() => endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })}
          className="absolute bottom-36 left-1/2 -translate-x-1/2 animate-fade-up rounded-full bg-slate-900 px-3 py-1 text-xs text-white shadow-lg hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900"
        >
          ↓ Latest
        </button>
      )}

      <div className="border-t border-slate-200 bg-white/70 backdrop-blur dark:border-slate-800 dark:bg-slate-900/70">
        {messages.length > 0 && (
          <div className="flex gap-2 overflow-x-auto px-3 pt-2.5">
            {QUICK_ACTIONS.map((a) => (
              <button
                key={a.label}
                type="button"
                disabled={busy}
                onClick={() => void send(a.text)}
                className="shrink-0 rounded-full border border-slate-300 px-3 py-1 text-xs transition hover:border-emerald-400 hover:bg-emerald-50 active:scale-95 disabled:opacity-40 dark:border-slate-700 dark:hover:bg-emerald-950/40"
              >
                {a.icon} {a.label}
              </button>
            ))}
          </div>
        )}
        <form onSubmit={onSubmit} className="flex items-end gap-2 p-3">
          <div className="relative flex-1">
            <textarea
              ref={taRef}
              className={`${inputCls} min-h-[42px] resize-none`}
              rows={1}
              placeholder="Message your coach…  (Enter to send, Shift+Enter for a new line)"
              value={input}
              maxLength={MAX_LEN}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={busy}
            />
            {input.length > MAX_LEN - 500 && <span className="absolute -top-5 right-1 text-[10px] text-slate-400">{input.length}/{MAX_LEN}</span>}
          </div>
          {busy ? (
            <button type="button" className={`${btnPrimary} bg-slate-700 hover:bg-slate-800`} onClick={() => abortRef.current?.abort()}>
              ■ Stop
            </button>
          ) : (
            <button className={`${btnPrimary} active:scale-95`} disabled={!input.trim()}>
              Send
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
