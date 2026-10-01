import Constants from "expo-constants";

import { cacheGet, cacheSet, dequeue, enqueue, listQueue, markQueueError, queueCount } from "@/src/local-db";
import { storage } from "@/src/utils/storage";

const baseUrl = String(
  Constants.expoConfig?.extra?.backendUrl ?? process.env.EXPO_PUBLIC_BACKEND_URL ?? "",
).replace(/\/$/, "");

export const TOKEN_KEY = "kasirku_auth_token";

export type Permission = "sales" | "purchases" | "returns" | "inventory" | "reports" | "cashflow" | "debts" | "operators" | "settings";

export type User = {
  id: string;
  business_id: string;
  business_name: string;
  name: string;
  username: string;
  role: "owner" | "manager" | "cashier" | "inventory" | "kitchen" | string;
  permissions?: Permission[];
};

export type Product = {
  id: string;
  name: string;
  sku: string;
  barcode: string;
  category: string;
  price: number;
  cost: number;
  stock: number;
  min_stock: number;
  kitchen_print?: boolean;
  image_base64?: string | null;
};

export type CartItem = Product & { quantity: number };

export type TransactionKind = "sale" | "purchase" | "sale_return" | "purchase_return";
export type PaymentMethod = "cash" | "credit" | "bank" | "wallet" | "qris";

export type TransactionDoc = {
  id: string;
  invoice_no: string;
  transaction_type: TransactionKind;
  payment_method: PaymentMethod;
  items: { product_id: string; name: string; quantity: number; price: number; cost: number; kitchen_print?: boolean }[];
  total: number;
  paid_amount: number;
  outstanding: number;
  customer_name: string;
  customer_id?: string | null;
  supplier_id?: string | null;
  note: string;
  created_at: string;
  created_by_name?: string;
};

export type CashEntry = {
  id: string;
  entry_type: "income" | "expense";
  amount: number;
  category: string;
  note: string;
  created_at: string;
  created_by?: string;
};

export type Operator = {
  id: string;
  name: string;
  username: string;
  role: string;
  permissions?: Permission[];
};

export type Contact = {
  id: string;
  name: string;
  phone: string;
  address: string;
  note: string;
  transaction_count?: number;
  total_spent?: number;
  outstanding?: number;
};

export type ReportSummary = {
  period: "daily" | "monthly" | "yearly";
  sales_total: number;
  purchase_total: number;
  transaction_count: number;
  gross_profit: number;
  receivable: number;
  payable: number;
  low_stock: number;
  cash_balance: number;
  cash_in: number;
  cash_out: number;
};

export type ProductReportRow = { product_id: string; name: string; quantity: number; revenue: number; profit: number };
export type CustomerReportRow = { customer_id: string | null; customer_name: string; transaction_count: number; total_spent: number; outstanding: number; profit: number };
export type OperatorReportRow = { operator_id: string | null; name: string; transaction_count: number; total_sales: number; profit: number };

export type IntegrationState = {
  qris: { configured: boolean };
  whatsapp: { configured: boolean };
  bluetooth_printing: { configured: boolean; note?: string };
};

export type BusinessSettings = {
  business_name: string;
  address: string;
  phone: string;
  footer_note: string;
  logo_base64?: string | null;
  receipt_width: "58mm" | "80mm";
  whatsapp_number?: string;
};

export class OfflineError extends Error {
  constructor(message = "Perangkat sedang offline") { super(message); this.name = "OfflineError"; }
}

async function rawFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = await storage.secureGet<string | null>(TOKEN_KEY, null);
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${baseUrl}/api${path}`, { ...options, headers });
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await rawFetch(path, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.detail ?? "Terjadi kesalahan koneksi");
  return body as T;
}

/** GET with cache-first on offline failure. Writes successful responses to local SQLite cache. */
export async function cachedGet<T>(path: string): Promise<{ data: T; fromCache: boolean }> {
  try {
    const data = await apiRequest<T>(path);
    await cacheSet(`get:${path}`, data);
    return { data, fromCache: false };
  } catch (e) {
    const cached = await cacheGet<T>(`get:${path}`);
    if (cached !== null) return { data: cached, fromCache: true };
    throw e;
  }
}

/** POST/PUT/DELETE that falls back to local offline queue when network fails. */
export async function syncMutation(method: "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<{ data: unknown | null; queued: boolean }> {
  const payload = body === undefined ? null : JSON.stringify(body);
  try {
    const res = await rawFetch(path, { method, body: payload ?? undefined });
    const parsed = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(parsed.detail ?? "Permintaan ditolak server");
    return { data: parsed, queued: false };
  } catch (e) {
    const isNetwork = e instanceof TypeError || (e instanceof Error && /network/i.test(e.message));
    if (!isNetwork) throw e;
    await enqueue({ method, path, body: payload });
    return { data: null, queued: true };
  }
}

export async function flushQueue(): Promise<{ sent: number; failed: number }> {
  const ops = await listQueue();
  let sent = 0;
  let failed = 0;
  for (const op of ops) {
    try {
      const res = await rawFetch(op.path, { method: op.method, body: op.body ?? undefined });
      if (!res.ok && res.status !== 404 && res.status !== 409) throw new Error(await res.text());
      await dequeue(op.id);
      sent += 1;
    } catch (err) {
      failed += 1;
      await markQueueError(op.id, err instanceof Error ? err.message : "Unknown error");
      break;
    }
  }
  return { sent, failed };
}

export async function pendingSyncCount(): Promise<number> { return queueCount(); }

export async function login(username: string, password: string) {
  return apiRequest<{ token: string; user: User }>("/auth/login", {
    method: "POST", body: JSON.stringify({ username, password }),
  });
}

export async function register(payload: { business_name: string; owner_name: string; username: string; password: string }) {
  return apiRequest<{ token: string; user: User }>("/auth/register", {
    method: "POST", body: JSON.stringify(payload),
  });
}

export async function saveToken(token: string) { return storage.secureSet(TOKEN_KEY, token); }
export async function clearToken() { return storage.secureRemove(TOKEN_KEY); }

export async function uploadProducts(file: { uri: string; name: string; mimeType?: string | null }) {
  const token = await storage.secureGet<string | null>(TOKEN_KEY, null);
  const form = new FormData();
  form.append("file", { uri: file.uri, name: file.name, type: file.mimeType ?? "application/octet-stream" } as unknown as Blob);
  const response = await fetch(`${baseUrl}/api/products/import`, {
    method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : undefined, body: form,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.detail ?? "Import gagal");
  return body as { imported: number };
}

export function formatRupiah(value: number) {
  return `Rp ${Math.round(value).toLocaleString("id-ID")}`;
}

export function hasPermission(user: User | null, permission: Permission) {
  if (!user) return false;
  if (user.role === "owner") return true;
  return (user.permissions ?? []).includes(permission);
}

export const PERMISSION_LABELS: Record<Permission, string> = {
  sales: "Penjualan",
  purchases: "Pembelian",
  returns: "Retur",
  inventory: "Stok & Produk",
  reports: "Laporan",
  cashflow: "Arus Kas",
  debts: "Hutang & Piutang",
  operators: "Kelola Operator",
  settings: "Pengaturan Toko",
};

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  cash: "Tunai",
  credit: "Kredit",
  bank: "Transfer Bank",
  wallet: "E-Wallet",
  qris: "QRIS",
};
