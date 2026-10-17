import mongoose, { Schema, type Model } from 'mongoose';
import { REPORT_TYPES, type ReportType } from '../schemas/finance.schema.js';

/**
 * Persisted specialist-agent output (the ADK `output_key` state values:
 * budget_analysis, savings_strategy, debt_reduction). History is kept; the
 * "current" value is the newest document per (userId, reportType).
 */
export interface IFinancialReport {
  userId: string;
  reportType: ReportType;
  data: Record<string, unknown>;
  /** Groups the three reports produced by one FullAnalysisPipeline run. */
  runId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const FinancialReportSchema = new Schema<IFinancialReport>(
  {
    userId: { type: String, required: true, trim: true, minlength: 1, maxlength: 128, immutable: true },
    reportType: { type: String, required: true, enum: REPORT_TYPES, immutable: true },
    data: { type: Schema.Types.Mixed, required: true },
    runId: { type: String, maxlength: 64 },
  },
  { collection: 'financial_reports', timestamps: true, minimize: false },
);

// "Latest report of type X for user Y" — the hot query.
FinancialReportSchema.index({ userId: 1, reportType: 1, createdAt: -1 });

export const FinancialReportModel: Model<IFinancialReport> =
  (mongoose.models.FinancialReport as Model<IFinancialReport> | undefined) ??
  mongoose.model<IFinancialReport>('FinancialReport', FinancialReportSchema);
