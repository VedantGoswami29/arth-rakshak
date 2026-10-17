import { Mastra } from '@mastra/core/mastra';
import { MongoDBStore } from '@mastra/mongodb';
import { budgetAgent } from './agents/budgetAgent.js';
import { coachAgent } from './agents/coachAgent.js';
import { debtAgent } from './agents/debtAgent.js';
import { savingsAgent } from './agents/savingsAgent.js';
import { env } from './config/env.js';
import { fullAnalysisPipeline } from './workflows/financeWorkflow.js';

/**
 * Storage here is used ONLY by Mastra internals (conversation memory threads/messages,
 * workflow run snapshots). It lives in a separate database from the Mongoose-managed
 * financial collections so the two concerns never share collections.
 * (MongoDBStore uses the official `mongodb` driver and keeps one client for the process.)
 */
const mastraStorage = new MongoDBStore({
  id: 'finance-mastra-storage',
  uri: env.MONGODB_URI,
  dbName: `${env.MONGODB_DB_NAME}_mastra`,
});

export const mastra = new Mastra({
  agents: {
    financeCoachAgent: coachAgent,
    budgetAnalysisAgent: budgetAgent,
    savingsStrategyAgent: savingsAgent,
    debtReductionAgent: debtAgent,
  },
  workflows: { fullAnalysisPipeline },
  storage: mastraStorage,
});

export { mastraStorage };
