import mongoose, { Schema, type HydratedDocument, type Model } from 'mongoose';
import { CANONICAL_EXPENSE_CATEGORIES } from '../domain/financial.js';

/**
 * One document per user. Field names intentionally mirror the original ADK
 * `financial_data` state (snake_case) so the JSON shown to the LLM is unchanged.
 */
export interface IDebt {
  name: string;
  amount: number;
  interest_rate: number;
  min_payment: number | null;
}

export interface IFinancialProfile {
  userId: string;
  monthly_income: number;
  dependants: number;
  manual_expenses: Map<string, number>;
  debts: IDebt[];
  createdAt: Date;
  updatedAt: Date;
}

const MAX_DEBTS = 200;

const DebtSchema = new Schema<IDebt>(
  {
    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 100 },
    amount: { type: Number, required: true, min: 0 },
    interest_rate: { type: Number, required: true, min: 0, max: 1000 },
    min_payment: { type: Number, min: 0, default: null },
  },
  { _id: false },
);

const FinancialProfileSchema = new Schema<IFinancialProfile>(
  {
    userId: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 128,
      immutable: true,
    },
    monthly_income: { type: Number, default: 0, min: 0 },
    dependants: {
      type: Number,
      default: 0,
      min: 0,
      validate: { validator: Number.isInteger, message: 'dependants must be an integer' },
    },
    manual_expenses: {
      type: Map,
      of: { type: Number, min: 0 },
      default: () => new Map<string, number>(),
      validate: {
        validator: (m: Map<string, number>) =>
          [...m.keys()].every((k) => (CANONICAL_EXPENSE_CATEGORIES as readonly string[]).includes(k)),
        message: 'manual_expenses keys must be canonical expense categories',
      },
    },
    debts: {
      type: [DebtSchema],
      default: [],
      validate: { validator: (a: unknown[]) => a.length <= MAX_DEBTS, message: `at most ${MAX_DEBTS} debts` },
    },
  },
  {
    collection: 'financial_profiles',
    timestamps: true,
    // Concurrent writers to the same profile get a VersionError instead of silently overwriting.
    optimisticConcurrency: true,
  },
);

// Tenant isolation + upsert key: exactly one profile per user.
FinancialProfileSchema.index({ userId: 1 }, { unique: true });

export type FinancialProfileDoc = HydratedDocument<IFinancialProfile>;

// `mongoose.models.X ||` keeps hot reload / watch mode from re-registering the model.
export const FinancialProfileModel: Model<IFinancialProfile> =
  (mongoose.models.FinancialProfile as Model<IFinancialProfile> | undefined) ??
  mongoose.model<IFinancialProfile>('FinancialProfile', FinancialProfileSchema);
