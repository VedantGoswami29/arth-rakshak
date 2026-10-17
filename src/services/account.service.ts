import { coachMemory } from '../agents/coachAgent.js';
import { deleteUserData } from './finance.service.js';
import { deleteUserRecord, verifyPasswordForUser } from './user.service.js';

/**
 * Full account erasure: chat history (Mastra Memory) → financial data (Mongoose) → user record.
 * The user record is removed last so a partial failure can simply be retried.
 */
export async function deleteAccount(userId: string, password: string) {
  await verifyPasswordForUser(userId, password);

  const { threads } = await coachMemory.listThreads({ filter: { resourceId: userId }, perPage: false });
  for (const t of threads) await coachMemory.deleteThread(t.id);

  const finance = await deleteUserData(userId);
  await deleteUserRecord(userId);
  return { threads: threads.length, ...finance };
}
