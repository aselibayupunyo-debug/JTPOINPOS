import * as SQLite from "expo-sqlite";
import { Platform } from "react-native";

type Database = Awaited<ReturnType<typeof SQLite.openDatabaseAsync>>;
let dbPromise: Promise<Database | null> | null = null;

async function openDb(): Promise<Database | null> {
  if (Platform.OS === "web") return null;
  const db = await SQLite.openDatabaseAsync("kasirku_cache.db");
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS queue (
      id TEXT PRIMARY KEY,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      body TEXT,
      created_at TEXT NOT NULL,
      last_error TEXT
    );
  `);
  return db;
}

export function localDb(): Promise<Database | null> {
  if (!dbPromise) dbPromise = openDb().catch(() => null);
  return dbPromise;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const db = await localDb();
  if (!db) return null;
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM cache WHERE key = ?", key);
  if (!row) return null;
  try { return JSON.parse(row.value) as T; } catch { return null; }
}

export async function cacheSet<T>(key: string, value: T): Promise<void> {
  const db = await localDb();
  if (!db) return;
  await db.runAsync(
    "INSERT OR REPLACE INTO cache (key, value, updated_at) VALUES (?, ?, ?)",
    key, JSON.stringify(value), new Date().toISOString(),
  );
}

export type QueueOp = { id: string; method: string; path: string; body: string | null; created_at: string; last_error?: string | null };

export async function enqueue(op: Omit<QueueOp, "id" | "created_at">): Promise<string> {
  const db = await localDb();
  const id = `op_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  if (!db) return id;
  await db.runAsync(
    "INSERT INTO queue (id, method, path, body, created_at) VALUES (?, ?, ?, ?, ?)",
    id, op.method, op.path, op.body ?? null, new Date().toISOString(),
  );
  return id;
}

export async function listQueue(): Promise<QueueOp[]> {
  const db = await localDb();
  if (!db) return [];
  return await db.getAllAsync<QueueOp>("SELECT * FROM queue ORDER BY created_at ASC");
}

export async function dequeue(id: string): Promise<void> {
  const db = await localDb();
  if (!db) return;
  await db.runAsync("DELETE FROM queue WHERE id = ?", id);
}

export async function markQueueError(id: string, error: string): Promise<void> {
  const db = await localDb();
  if (!db) return;
  await db.runAsync("UPDATE queue SET last_error = ? WHERE id = ?", error, id);
}

export async function queueCount(): Promise<number> {
  const db = await localDb();
  if (!db) return 0;
  const row = await db.getFirstAsync<{ count: number }>("SELECT COUNT(*) as count FROM queue");
  return row?.count ?? 0;
}

export async function clearCache(): Promise<void> {
  const db = await localDb();
  if (!db) return;
  await db.execAsync("DELETE FROM cache; DELETE FROM queue;");
}
