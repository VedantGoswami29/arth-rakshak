import mongoose from 'mongoose';
import { env } from './env.js';

/**
 * One shared Mongoose connection for the whole process.
 *
 * The connection promise is cached on `globalThis`, so it survives module
 * re-evaluation (tsx watch / hot reload) and is never reopened per tool call.
 * Mongoose maintains its own pool (maxPoolSize) and reconnects automatically.
 */
type MongooseCache = {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
  listenersAttached: boolean;
};

const globalForMongoose = globalThis as typeof globalThis & {
  __financeMongooseCache?: MongooseCache;
};

const cache: MongooseCache = (globalForMongoose.__financeMongooseCache ??= {
  conn: null,
  promise: null,
  listenersAttached: false,
});

function attachListeners(): void {
  if (cache.listenersAttached) return;
  cache.listenersAttached = true;
  mongoose.connection.on('error', (err: Error) => console.error(`[mongo] connection error: ${err.name}: ${err.message}`));
  mongoose.connection.on('disconnected', () => console.warn('[mongo] disconnected'));
  mongoose.connection.on('reconnected', () => console.info('[mongo] reconnected'));
}

export async function connectDB(): Promise<typeof mongoose> {
  if (cache.conn) return cache.conn;

  if (!cache.promise) {
    mongoose.set('strictQuery', true);
    attachListeners();
    cache.promise = mongoose
      .connect(env.MONGODB_URI, {
        dbName: env.MONGODB_DB_NAME,
        maxPoolSize: env.MONGODB_MAX_POOL_SIZE,
        serverSelectionTimeoutMS: 5_000,
        socketTimeoutMS: 45_000,
        // Fail fast instead of silently queueing operations while disconnected.
        bufferCommands: false,
        autoIndex: env.MONGOOSE_AUTO_INDEX,
      })
      .then((m) => {
        console.info(`[mongo] connected (db: ${env.MONGODB_DB_NAME})`);
        return m;
      })
      .catch((err) => {
        cache.promise = null; // allow a retry on the next call
        throw err;
      });
  }

  cache.conn = await cache.promise;
  return cache.conn;
}

export function isDbReady(): boolean {
  return mongoose.connection.readyState === 1;
}

export async function disconnectDB(): Promise<void> {
  if (!cache.conn && !cache.promise) return;
  await mongoose.disconnect();
  cache.conn = null;
  cache.promise = null;
}
