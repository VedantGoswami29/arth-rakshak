import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { connectDB } from '../config/db.js';
import {
  addDebtUnique,
  applyFinancialPatch,
  createDefaultFinancialData,
  type DebtDraft,
  ProfileOpError,
  removeDebtByName,
  removeExpenseCategory,
  replaceDebt,
} from '../domain/financial.js';
import {
  FinancialProfileModel,
  type FinancialProfileDoc,
  type IFinancialProfile,
} from '../models/FinancialProfile.js';
import { FinancialReportModel } from '../models/FinancialReport.js';
import { UserIdSchema } from '../context/requestContext.js';
import {
  REPORT_SCHEMAS,
  type FinancialData,
  type ReportDataMap,
  type ReportType,
  type UpdateFinancialDataInput,
} from '../schemas/finance.schema.js';

/**
 * MongoDB persistence layer — the only module that touches Mongoose models.
 * Every function takes an explicit, already-authenticated `userId` and scopes
 * every query by it (tenant isolation).
 */

export type FinanceServiceErrorCode =
  | 'INVALID_USER'
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'DB_UNAVAILABLE'
  | 'UNKNOWN';

export class FinanceServiceError extends Error {
  constructor(
    public readonly code: FinanceServiceErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'FinanceServiceError';
  }
}

function toServiceError(operation: string, err: unknown): FinanceServiceError {
  if (err instanceof FinanceServiceError) return err;
  if (err instanceof ProfileOpError) {
    return new FinanceServiceError(err.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'CONFLICT', err.message, err);
  }
  if (err instanceof ZodError) {
    return new FinanceServiceError('VALIDATION', `${operation}: invalid data (${err.message})`, err);
  }
  if (err instanceof mongoose.Error.ValidationError || err instanceof mongoose.Error.CastError) {
    return new FinanceServiceError('VALIDATION', `${operation}: ${err.message}`, err);
  }
  if (err instanceof mongoose.Error.VersionError) {
    return new FinanceServiceError('CONFLICT', `${operation}: concurrent update conflict`, err);
  }
  const name = (err as { name?: string } | null)?.name ?? '';
  const code = (err as { code?: number } | null)?.code;
  if (code === 11000) {
    return new FinanceServiceError('CONFLICT', `${operation}: duplicate key`, err);
  }
  if (/MongoNetwork|MongoServerSelection|MongooseServerSelection|MongoTimeout|MongoNotConnected/.test(name)) {
    return new FinanceServiceError('DB_UNAVAILABLE', `${operation}: database unavailable`, err);
  }
  return new FinanceServiceError('UNKNOWN', `${operation}: unexpected database error`, err);
}

/** Validates userId and guarantees the DB connection (cached — never reopened). */
async function run<T>(operation: string, userId: string, fn: () => Promise<T>): Promise<T> {
  try {
    // Also blocks NoSQL operator injection ({ "$ne": null }) — userId must be a plain string.
    if (!UserIdSchema.safeParse(userId).success) {
      throw new FinanceServiceError('INVALID_USER', `${operation}: invalid userId`);
    }
    await connectDB();
    return await fn();
  } catch (err) {
    const wrapped = toServiceError(operation, err);
    // Expected client errors (404/409/422) are returned to the caller; only log real faults.
    if (wrapped.code !== 'DB_UNAVAILABLE' && wrapped.code !== 'UNKNOWN') throw wrapped;
    console.error(
      `[finance.service] ${wrapped.code}: ${wrapped.message}` +
        (wrapped.cause instanceof Error ? ` (${wrapped.cause.name})` : ''),
    );
    throw wrapped;
  }
}

/* ───────────────────────────── helpers ───────────────────────────── */

type ProfileLike = Pick<IFinancialProfile, 'monthly_income' | 'dependants' | 'debts'> & {
  manual_expenses: Map<string, number> | Record<string, number> | undefined;
};

function toFinancialData(doc: ProfileLike | null | undefined): FinancialData {
  if (!doc) return createDefaultFinancialData();
  const expenses =
    doc.manual_expenses instanceof Map
      ? Object.fromEntries(doc.manual_expenses)
      : { ...(doc.manual_expenses ?? {}) };
  return {
    monthly_income: doc.monthly_income ?? 0,
    dependants: doc.dependants ?? 0,
    manual_expenses: expenses,
    debts: (doc.debts ?? []).map((d) => ({
      name: d.name,
      amount: d.amount,
      interest_rate: d.interest_rate,
      min_payment: d.min_payment ?? null,
    })),
  };
}

/** Create-if-missing, race-safe (unique index on userId + atomic upsert). */
async function upsertProfileDoc(userId: string): Promise<FinancialProfileDoc> {
  const doc = await FinancialProfileModel.findOneAndUpdate(
    { userId },
    { $setOnInsert: { userId } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
  if (!doc) throw new FinanceServiceError('UNKNOWN', 'upsert returned no document');
  return doc;
}

/* ───────────────────────────── profile ───────────────────────────── */

/** ADK `on_before_agent` equivalent: make sure the user's profile exists. */
export function ensureFinancialProfile(userId: string): Promise<FinancialData> {
  return run('ensureFinancialProfile', userId, async () => {
    try {
      return toFinancialData(await upsertProfileDoc(userId));
    } catch (err) {
      // Two first-ever requests can race on the unique index; the loser just re-reads.
      if ((err as { code?: number }).code === 11000) {
        return toFinancialData(await FinancialProfileModel.findOne({ userId }).lean());
      }
      throw err;
    }
  });
}

/** Read-only; returns defaults (without writing) if the user has no profile yet. */
export function getFinancialData(userId: string): Promise<FinancialData> {
  return run('getFinancialData', userId, async () =>
    toFinancialData(await FinancialProfileModel.findOne({ userId }).lean()),
  );
}

const MAX_UPDATE_ATTEMPTS = 6;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Serialises profile writes per user inside this process. The coach can call several profile tools
 * in one turn and the UI can fire several edits at once; without this they all race on the same
 * document and burn through the optimistic-concurrency retries. (Across multiple server instances
 * the VersionError retry below is still the safety net.)
 */
const userLocks = new Map<string, Promise<unknown>>();
function withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const next = (userLocks.get(userId) ?? Promise.resolve()).catch(() => undefined).then(fn);
  userLocks.set(userId, next);
  const cleanup = () => {
    if (userLocks.get(userId) === next) userLocks.delete(userId);
  };
  next.then(cleanup, cleanup);
  return next;
}

type ProfileMutator = (fd: FinancialData) => { financialData: FinancialData; changes: string[] };

/**
 * Read-modify-write on the user's profile with optimistic concurrency: if another request
 * changed the document in between, Mongoose throws VersionError and we re-read and re-apply.
 * Every profile write (chat tools AND the UI's CRUD endpoints) goes through here.
 */
export function mutateFinancialData(
  userId: string,
  operation: string,
  mutate: ProfileMutator,
): Promise<{ changes: string[]; financial_data: FinancialData }> {
  return run(operation, userId, () => withUserLock(userId, async () => {
    for (let attempt = 1; attempt <= MAX_UPDATE_ATTEMPTS; attempt++) {
      const doc = await upsertProfileDoc(userId);
      const { financialData, changes } = mutate(toFinancialData(doc));

      if (changes.length === 0) {
        return { changes: ['no-op'], financial_data: financialData };
      }

      doc.monthly_income = financialData.monthly_income;
      doc.dependants = financialData.dependants;
      doc.manual_expenses = new Map(Object.entries(financialData.manual_expenses));
      doc.debts = financialData.debts;

      try {
        await doc.save(); // runs Mongoose validators + version check
        return { changes, financial_data: toFinancialData(doc) };
      } catch (err) {
        if (err instanceof mongoose.Error.VersionError && attempt < MAX_UPDATE_ATTEMPTS) {
          await sleep(10 + Math.random() * 40 * attempt); // jitter so competing instances de-synchronise
          continue;
        }
        throw err;
      }
    }
    throw new FinanceServiceError('CONFLICT', `${operation}: too many concurrent updates`);
  }));
}

/** Apply an `update_financial_data` patch (chat tools). */
export const updateFinancialData = (userId: string, patch: UpdateFinancialDataInput) =>
  mutateFinancialData(userId, 'updateFinancialData', (fd) => applyFinancialPatch(fd, patch));

/* ── direct edits from the UI ── */

export const setProfileBasics = (userId: string, basics: { monthly_income?: number; dependants?: number }) =>
  updateFinancialData(userId, basics);

export const setExpense = (userId: string, category: string, amount: number) =>
  updateFinancialData(userId, { expenses_patch: { [category]: amount } });

export const removeExpense = (userId: string, category: string) =>
  mutateFinancialData(userId, 'removeExpense', (fd) => removeExpenseCategory(fd, category));

export const createDebt = (userId: string, draft: DebtDraft) =>
  mutateFinancialData(userId, 'createDebt', (fd) => addDebtUnique(fd, draft));

export const updateDebt = (userId: string, name: string, draft: DebtDraft) =>
  mutateFinancialData(userId, 'updateDebt', (fd) => replaceDebt(fd, name, draft));

export const deleteDebt = (userId: string, name: string) =>
  mutateFinancialData(userId, 'deleteDebt', (fd) => removeDebtByName(fd, name));

/* ───────────────────────────── reports ───────────────────────────── */

export function saveReport<T extends ReportType>(
  userId: string,
  reportType: T,
  data: ReportDataMap[T],
  runId?: string,
): Promise<ReportDataMap[T]> {
  return run('saveReport', userId, async () => {
    const validated = REPORT_SCHEMAS[reportType].parse(data) as ReportDataMap[T];
    await FinancialReportModel.create({ userId, reportType, data: validated, runId });
    return validated;
  });
}

export function getLatestReport<T extends ReportType>(
  userId: string,
  reportType: T,
): Promise<ReportDataMap[T] | null> {
  return run('getLatestReport', userId, async () => {
    const doc = await FinancialReportModel.findOne({ userId, reportType })
      .sort({ createdAt: -1 })
      .select({ data: 1 })
      .lean();
    if (!doc) return null;
    const parsed = REPORT_SCHEMAS[reportType].safeParse(doc.data);
    if (!parsed.success) {
      console.warn(`[finance.service] stored ${reportType} for user failed validation; ignoring`);
      return null;
    }
    return parsed.data as ReportDataMap[T];
  });
}

export async function getLatestReports(
  userId: string,
  reportTypes: readonly ReportType[],
): Promise<Partial<ReportDataMap>> {
  const entries = await Promise.all(
    reportTypes.map(async (t) => [t, await getLatestReport(userId, t)] as const),
  );
  const out: Partial<ReportDataMap> = {};
  for (const [type, value] of entries) {
    if (value) (out as Record<string, unknown>)[type] = value;
  }
  return out;
}

export function listReports(
  userId: string,
  opts: { reportType?: ReportType; limit?: number } = {},
) {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  return run('listReports', userId, async () => {
    const filter: Record<string, unknown> = { userId };
    if (opts.reportType) filter.reportType = opts.reportType;
    return FinancialReportModel.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .select({ reportType: 1, data: 1, runId: 1, createdAt: 1, _id: 0 })
      .lean();
  });
}

/** Everything the UI side panel needs: profile + latest card of each type. */
export async function getFinancialSnapshot(userId: string) {
  const [financial_data, reports] = await Promise.all([
    getFinancialData(userId),
    getLatestReports(userId, ['budget_analysis', 'savings_strategy', 'debt_reduction']),
  ]);
  return { financial_data, reports };
}

/** Right-to-erasure: removes the user's profile and every report. */
export function deleteUserData(userId: string): Promise<{ profiles: number; reports: number }> {
  return run('deleteUserData', userId, async () => {
    const [p, r] = await Promise.all([
      FinancialProfileModel.deleteOne({ userId }),
      FinancialReportModel.deleteMany({ userId }),
    ]);
    return { profiles: p.deletedCount, reports: r.deletedCount };
  });
}

/** Build indexes before serving traffic (the unique userId index backs the upsert). */
export async function initFinanceModels(): Promise<void> {
  await connectDB();
  await Promise.all([FinancialProfileModel.init(), FinancialReportModel.init()]);
}
