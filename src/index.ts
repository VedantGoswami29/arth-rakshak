import type { Server } from 'node:http';
import { createApp } from './app.js';
import { disconnectDB } from './config/db.js';
import { env } from './config/env.js';
import { mastraStorage } from './mastra.js';
import { initFinanceModels } from './services/finance.service.js';
import { initUserModel } from './services/user.service.js';

async function main() {
  await initFinanceModels(); // connect once + build indexes before serving
  await initUserModel();

  const server: Server = createApp().listen(env.PORT, () => {
    console.info(`AI Financial Coach listening on http://localhost:${env.PORT}`);
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.info(`${signal} received — shutting down`);
    server.close();
    server.closeIdleConnections();
    await Promise.allSettled([disconnectDB(), mastraStorage.close()]);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
