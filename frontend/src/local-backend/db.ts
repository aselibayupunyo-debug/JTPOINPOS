/**
 * Local SQLite backend untuk JTPOIN POS.
 *
 * File ini menyediakan `getDb()` yang mengembalikan handle SQLite tunggal
 * untuk semua handler. Schema dibuat idempoten via CREATE TABLE IF NOT EXISTS.
 * Semua data persist di device user — tidak ada komunikasi ke server.
 */
import * as SQLite from "expo-sqlite";
import { Platform } from "react-native";

export type Database = Awaited<ReturnType<typeof SQLite.openDatabaseAsync>>;

const DB_NAME = "jtpoin_offline.db";
let dbPromise: Promise<Database> | null = null;

async function createDb(): Promise<Database> {
  if (Platform.OS === "web") {
    // Web preview tidak mendukung SQLite via wa-sqlite di Metro saat ini.
    // Native Android/iOS build berfungsi penuh. Lempar error jelas agar UI
    // bisa menampilkan pesan ramah ke user.
    throw new Error("Mode offline hanya tersedia di aplikasi Android/iOS native, bukan preview web.");
  }
  return SQLite.openDatabaseAsync(DB_NAME);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  business_name TEXT NOT NULL,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT DEFAULT 'owner',
  permissions TEXT DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS business_settings (
  business_id TEXT PRIMARY KEY,
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_products_biz ON products(business_id);
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payment_methods (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contacts_biz_kind ON contacts(business_id, kind);
CREATE TABLE IF NOT EXISTS transactions_t (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  transaction_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tx_biz_type ON transactions_t(business_id, transaction_type);
CREATE INDEX IF NOT EXISTS idx_tx_biz_date ON transactions_t(business_id, created_at);
CREATE TABLE IF NOT EXISTS cash_entries (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cash_biz ON cash_entries(business_id);
CREATE TABLE IF NOT EXISTS debts (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_debts_biz ON debts(business_id);
CREATE TABLE IF NOT EXISTS parked (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS shifts (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shifts_biz ON shifts(business_id);
CREATE TABLE IF NOT EXISTS promos (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_biz ON audit_logs(business_id);
CREATE TABLE IF NOT EXISTS counters (
  business_id TEXT NOT NULL,
  name TEXT NOT NULL,
  value INTEGER NOT NULL,
  PRIMARY KEY (business_id, name)
);
CREATE TABLE IF NOT EXISTS stock_adjustments (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stockadj_biz ON stock_adjustments(business_id);
CREATE INDEX IF NOT EXISTS idx_stockadj_prod ON stock_adjustments(product_id);
CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_expense_biz ON expenses(business_id);
CREATE TABLE IF NOT EXISTS technicians (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS expense_categories (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  json TEXT NOT NULL
);
`;

export async function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await createDb();
      await db.execAsync(SCHEMA);
      return db;
    })();
  }
  return dbPromise;
}

export function uuid(): string {
  // RFC4122 v4-ish (not crypto-strong but adequate for local IDs)
  const hex = "0123456789abcdef";
  const seg = (n: number) => Array.from({ length: n }, () => hex[Math.floor(Math.random() * 16)]).join("");
  return `${seg(8)}-${seg(4)}-4${seg(3)}-${["8","9","a","b"][Math.floor(Math.random()*4)]}${seg(3)}-${seg(12)}`;
}

export function nowIso(): string { return new Date().toISOString(); }

export async function nextCounter(businessId: string, name: string, start = 1): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: number }>(
    "SELECT value FROM counters WHERE business_id = ? AND name = ?",
    [businessId, name],
  );
  const next = (row?.value ?? (start - 1)) + 1;
  await db.runAsync(
    "INSERT INTO counters (business_id, name, value) VALUES (?, ?, ?) ON CONFLICT(business_id, name) DO UPDATE SET value = ?",
    [businessId, name, next, next],
  );
  return next;
}
