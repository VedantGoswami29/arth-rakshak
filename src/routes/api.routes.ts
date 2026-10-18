import { Router, type Response } from 'express';
import { z } from 'zod';
import { signAccessToken } from '../context/auth.js';
import { createRequestContext } from '../context/requestContext.js';
import { mastra } from '../mastra.js';
import { ChangePasswordSchema, DeleteAccountSchema } from '../schemas/auth.schema.js';
import { ChatRequestSchema, REPORT_TYPES } from '../schemas/finance.schema.js';
import { deleteAccount } from '../services/account.service.js';
import { BasicsBodySchema, DebtBodySchema, DebtNameParam, ExpenseBodySchema, ExpenseCategoryParam } from '../schemas/profile.schema.js';
import {
  createDebt,
  deleteDebt,
  deleteUserData,
  getFinancialSnapshot,
  listReports,
  removeExpense,
  setExpense,
  setProfileBasics,
  updateDebt,
} from '../services/finance.service.js';
import { changePassword, getUserById, revokeAllTokens } from '../services/user.service.js';
import { requireAuth, userId } from './middleware.js';

export const apiRoutes = Router();
apiRoutes.use(requireAuth); // everything below is authenticated

/** Thread ids are namespaced by userId so one user can never address another's conversation. */
const threadKey = (uid: string, threadId: string) => `${uid}:${threadId}`;

function chatOptions(uid: string, threadId: string) {
  return {
    requestContext: createRequestContext(uid), // ← userId flows to tools/agents from here, never from the LLM
    memory: { thread: threadKey(uid, threadId), resource: uid },
  };
}

/**
 * Mastra does NOT throw when the model call fails — it logs the error and ends the stream,
 * so a failed turn used to look like a successful empty one. We check the error explicitly
 * and return a short, safe message (details stay in the server log).
 */
function chatFailureMessage(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  if (/tool call validation failed/i.test(text)) {
    return "The AI produced an invalid update. Nothing was changed — please try again, or rephrase (e.g. \"My rent is $2,400 per month\").";
  }
  if (/rate limit|429/i.test(text)) return 'The AI service is rate limited right now. Please try again in a moment.';
  return 'The AI request failed. Nothing was changed — please try again.';
}

// ── Chat (JSON) ───────────────────────────────────────────────────────────
apiRoutes.post('/chat', async (req, res) => {
  const parsed = ChatRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', issues: parsed.error.issues });
    return;
  }
  const uid = userId(res);
  const { message, threadId } = parsed.data;

  const result = await mastra.getAgent('financeCoachAgent').generate(message, chatOptions(uid, threadId));
  if (result.error) {
    console.error('[chat]', result.error);
    res.status(502).json({ error: chatFailureMessage(result.error) });
    return;
  }
  const snapshot = await getFinancialSnapshot(uid); // cards + profile for the side panel
  res.json({ reply: result.text, threadId, ...snapshot });
});

// ── Chat (Server-Sent Events) ─────────────────────────────────────────────
function sse(res: Response) {
  return (event: string, data: unknown) => {
    if (!res.writableEnded && !res.destroyed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
}

apiRoutes.post('/chat/stream', async (req, res) => {
  const parsed = ChatRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', issues: parsed.error.issues });
    return;
  }
  const uid = userId(res);
  const { message, threadId } = parsed.data;

  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // disable nginx buffering
  });
  res.flushHeaders();

  const send = sse(res);
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controller.abort(); // client went away → stop spending tokens
  });
  // Analyses can run a while with no text; keep proxies from closing an idle connection.
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
  }, 15_000);

  try {
    const stream = await mastra
      .getAgent('financeCoachAgent')
      .stream(message, { ...chatOptions(uid, threadId), abortSignal: controller.signal });
    for await (const delta of stream.textStream) send('text', { delta });
    if (stream.error) throw stream.error; // model/provider failure surfaced instead of a fake "done"
    send('state', { threadId, ...(await getFinancialSnapshot(uid)) });
    send('done', {});
  } catch (err) {
    if (!controller.signal.aborted) {
      console.error('[chat/stream]', err);
      send('error', { error: chatFailureMessage(err) });
    }
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
});

// ── Profile & reports (what the side panel renders) ───────────────────────
apiRoutes.get('/state', async (_req, res) => {
  res.json(await getFinancialSnapshot(userId(res)));
});

// ── Direct profile editing (CRUD without going through the chat) ──────────
// Every route returns the fresh snapshot (profile + latest reports) so the UI can just swap it in.
// Writes go through the same service/optimistic-concurrency path the chat tools use.
function bad(res: Response, error: z.ZodError) {
  res.status(400).json({ error: 'Invalid request', issues: error.issues });
}

apiRoutes.patch('/profile', async (req, res) => {
  const body = BasicsBodySchema.safeParse(req.body);
  if (!body.success) return bad(res, body.error);
  const uid = userId(res);
  await setProfileBasics(uid, body.data);
  res.json(await getFinancialSnapshot(uid));
});

apiRoutes.put('/profile/expenses/:category', async (req, res) => {
  const category = ExpenseCategoryParam.safeParse(req.params.category);
  const body = ExpenseBodySchema.safeParse(req.body);
  if (!category.success) return bad(res, category.error);
  if (!body.success) return bad(res, body.error);
  const uid = userId(res);
  await setExpense(uid, category.data, body.data.amount);
  res.json(await getFinancialSnapshot(uid));
});

apiRoutes.delete('/profile/expenses/:category', async (req, res) => {
  const category = ExpenseCategoryParam.safeParse(req.params.category);
  if (!category.success) return bad(res, category.error);
  const uid = userId(res);
  await removeExpense(uid, category.data);
  res.json(await getFinancialSnapshot(uid));
});

apiRoutes.post('/profile/debts', async (req, res) => {
  const body = DebtBodySchema.safeParse(req.body);
  if (!body.success) return bad(res, body.error);
  const uid = userId(res);
  await createDebt(uid, body.data);
  res.status(201).json(await getFinancialSnapshot(uid));
});

apiRoutes.put('/profile/debts/:name', async (req, res) => {
  const name = DebtNameParam.safeParse(req.params.name);
  const body = DebtBodySchema.safeParse(req.body);
  if (!name.success) return bad(res, name.error);
  if (!body.success) return bad(res, body.error);
  const uid = userId(res);
  await updateDebt(uid, name.data, body.data);
  res.json(await getFinancialSnapshot(uid));
});

apiRoutes.delete('/profile/debts/:name', async (req, res) => {
  const name = DebtNameParam.safeParse(req.params.name);
  if (!name.success) return bad(res, name.error);
  const uid = userId(res);
  await deleteDebt(uid, name.data);
  res.json(await getFinancialSnapshot(uid));
});

const ReportsQuery = z.object({
  type: z.enum(REPORT_TYPES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
apiRoutes.get('/reports', async (req, res) => {
  const q = ReportsQuery.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: 'Invalid query', issues: q.error.issues });
    return;
  }
  res.json({ reports: await listReports(userId(res), { reportType: q.data.type, limit: q.data.limit }) });
});

// ── Account management ────────────────────────────────────────────────────
apiRoutes.get('/me', async (_req, res) => {
  const user = await getUserById(userId(res));
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json({ user });
});

apiRoutes.post('/me/password', async (req, res) => {
  const parsed = ChangePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', issues: parsed.error.issues });
    return;
  }
  const uid = userId(res);
  const { tokenVersion } = await changePassword(uid, parsed.data.currentPassword, parsed.data.newPassword);
  res.json({ token: await signAccessToken(uid, tokenVersion) }); // old tokens are now invalid
});

apiRoutes.post('/me/logout-all', async (_req, res) => {
  await revokeAllTokens(userId(res));
  res.json({ ok: true });
});

// Full erasure: chat history + financial data + user record (password required).
apiRoutes.delete('/me', async (req, res) => {
  const parsed = DeleteAccountSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request' });
    return;
  }
  res.json({ deleted: await deleteAccount(userId(res), parsed.data.password) });
});

apiRoutes.delete('/me/data', async (_req, res) => {
  res.json({ deleted: await deleteUserData(userId(res)) });
});
