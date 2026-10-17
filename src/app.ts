import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express from 'express';
import { isDbReady } from './config/db.js';
import { env } from './config/env.js';
import { apiRoutes } from './routes/api.routes.js';
import { authRoutes } from './routes/auth.routes.js';
import { errorHandler } from './routes/middleware.js';

/** Express app: JSON API (/auth, /api) + the built Vite SPA (frontend/dist) from the same origin. */
export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (env.TRUST_PROXY !== undefined) app.set('trust proxy', env.TRUST_PROXY);

  // Security headers (no extra dependency). The SPA only needs same-origin scripts/styles/fetch.
  app.use((_req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy':
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    });
    next();
  });

  if (env.CORS_ORIGIN) {
    app.use(
      cors({
        origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(',').map((s) => s.trim()),
        allowedHeaders: ['Authorization', 'Content-Type'],
        methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      }),
    );
  }

  app.get('/health', (_req, res) => {
    res.json({ status: isDbReady() ? 'ok' : 'degraded', db: isDbReady() });
  });

  app.use('/auth', express.json({ limit: '8kb' }), authRoutes);
  app.use('/api', express.json({ limit: '32kb' }), apiRoutes);
  app.use(['/auth', '/api'], (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // ── Frontend (Vite build) ───────────────────────────────────────────────
  const distDir = path.resolve(env.FRONTEND_DIST_DIR ?? path.join(process.cwd(), 'frontend', 'dist'));
  const indexHtml = path.join(distDir, 'index.html');

  if (fs.existsSync(indexHtml)) {
    app.use(
      express.static(distDir, {
        index: false,
        setHeaders: (res, filePath) => {
          // Vite fingerprints everything under /assets → cache forever; index.html must always revalidate.
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          } else {
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      }),
    );
    // SPA fallback: any other GET serves index.html (client-side routing).
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      res.set('Cache-Control', 'no-cache').sendFile(indexHtml);
    });
  } else {
    console.warn(`[web] ${indexHtml} not found — serving the API only. Run "npm run build:web" first.`);
    app.get('/', (_req, res) => {
      res.status(200).type('text/plain').send('API is running. Build the frontend with "npm run build:web".');
    });
  }

  app.use(errorHandler);
  return app;
}
