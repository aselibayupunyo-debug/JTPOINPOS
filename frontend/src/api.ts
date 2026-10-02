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
  product_type?: "goods" | "service";
  base_unit?: string;
  price: number;
  cost: number;
  prices?: Record<string, number>;
  units?: { name: string; factor: number; barcode?: string; price?: number }[];
  stock: number;
  min_stock: number;
  kitchen_print?: boolean;
  image_base64?: string | null;
};

export type CartItem = Product & { quantity: number; line_id?: string; product_id?: string; unit?: string; unit_factor?: number; discount?: number; manual_discount?: number };

export type TransactionKind = "sale" | "purchase" | "sale_return" | "purchase_return";
export type PaymentKind = "cash" | "credit" | "qris_static" | "custom";
export type PaymentMethod = string; // dynamic id like pm_cash, pm_credit, pm_qris, or uuid

export type PaymentMethodDoc = {
  id: string;
  name: string;
  kind: PaymentKind;
  enabled: boolean;
  sort_order: number;
  qris_image_base64?: string | null;
};

export type PriceLevel = { id: string; name: string };

export type Category = { id: string; name: string; icon: string };

export type ParkedTransaction = {
  id: string;
  label: string;
  customer_name: string;
  customer_id?: string | null;
  price_level_id: string;
  items: { product_id: string; name: string; quantity: number; price: number; cost: number; unit?: string; unit_factor?: number; discount?: number; kitchen_print?: boolean }[];
  note: string;
  discount_percent: number;
  discount_amount: number;
  tax_percent: number;
  shipping: number;
  created_at: string;
  created_by_name?: string;
};

export type TransactionDoc = {
  id: string;
  invoice_no: string;
  transaction_type: TransactionKind;
  payment_method: PaymentMethod;
  payment_method_label?: string;
  items: { product_id: string; name: string; quantity: number; price: number; cost: number; discount?: number; unit?: string; unit_factor?: number; product_type?: "goods" | "service"; kitchen_print?: boolean }[];
  subtotal?: number;
  item_discount?: number;
  discount_percent?: number;
  discount_amount?: number;
  global_discount?: number;
  tax_percent?: number;
  tax_amount?: number;
  shipping?: number;
  total: number;
  paid_amount: number;
  outstanding: number;
  customer_name: string;
  customer_id?: string | null;
  supplier_id?: string | null;
  price_level_id?: string;
  status?: "active" | "cancelled";
  returned?: boolean;
  returned_at?: string;
  return_transaction_id?: string;
  cancel_reason?: string;
  cancelled_at?: string;
  note: string;
  created_at: string;
  created_by?: string;
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
  price_level_id?: string;
  price_level_name?: string;
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
export type SalesItemRow = {
  invoice_no: string;
  transaction_id: string;
  created_at: string;
  customer_name: string;
  operator_name: string;
  operator_id: string | null;
  product_id: string;
  name: string;
  quantity: number;
  unit: string;
  price: number;
  discount: number;
  subtotal: number;
  cost: number;
  profit: number;
};

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
  header_lines?: string[];
  footer_lines?: string[];
  logo_base64?: string | null;
  receipt_width: "58mm" | "80mm";
  whatsapp_number?: string;
  qris_static_image?: string | null;
  cashdrawer_enabled?: boolean;
  multi_printer?: boolean;
  tax_percent?: number;
  tax_label?: string;
  shipping_default?: number;
  allow_price_edit?: boolean;
  auto_park_on_cancel?: boolean;
  confirm_cancel?: boolean;
  price_levels?: PriceLevel[];
  enabled_payment_kinds?: string[];
  email_recipient?: string;
};

export const PAYMENT_KIND_LABELS: Record<PaymentKind, string> = {
  cash: "Tunai",
  credit: "Kredit",
  qris_static: "QRIS Statis",
  custom: "Kustom",
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

/** Download products export (xlsx) as base64 for later saving via expo-file-system. */
export async function downloadProductsExcel(): Promise<{ base64: string; filename: string }> {
  const token = await storage.secureGet<string | null>(TOKEN_KEY, null);
  const response = await fetch(`${baseUrl}/api/products/export`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!response.ok) {
    const err = await response.text().catch(() => "");
    throw new Error(err || "Gagal mengunduh file");
  }
  const disposition = response.headers.get("content-disposition") || "";
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  const filename = match ? match[1] : `produk-${Date.now()}.xlsx`;
  const buf = await response.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  // btoa is available on native (Hermes) via global polyfill
  const base64 = btoa(binary);
  return { base64, filename };
}

/** Download Excel laporan multi-sheet untuk periode tertentu. */
export async function downloadReportsExcel(period: "daily" | "monthly" | "yearly" | "custom", start?: string, end?: string): Promise<{ base64: string; filename: string }> {
  const token = await storage.secureGet<string | null>(TOKEN_KEY, null);
  const qs = new URLSearchParams({ period });
  if (start) qs.set("start", start);
  if (end) qs.set("end", end);
  const response = await fetch(`${baseUrl}/api/reports/export?${qs.toString()}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!response.ok) {
    const err = await response.text().catch(() => "");
    throw new Error(err || "Gagal mengunduh laporan");
  }
  const disposition = response.headers.get("content-disposition") || "";
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  const filename = match ? match[1] : `laporan-${Date.now()}.xlsx`;
  const buf = await response.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  const base64 = btoa(binary);
  return { base64, filename };
}

export async function updateProfile(payload: { name?: string; username?: string; current_password: string; new_password?: string }) {
  return apiRequest<{ ok: boolean; message?: string }>("/profile", { method: "PUT", body: JSON.stringify(payload) });
}

export type AuditLog = {
  id: string;
  actor_id: string;
  actor_name: string;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
};

export async function listAuditLogs(limit = 100) {
  return apiRequest<AuditLog[]>(`/audit-logs?limit=${limit}`);
}

export async function adminResetTransactions(password: string) {
  return apiRequest<{ ok: boolean; deleted: Record<string, number> }>("/admin/reset-transactions", { method: "POST", body: JSON.stringify({ password }) });
}

export async function adminDeleteAllProducts(password: string) {
  return apiRequest<{ ok: boolean; deleted: number }>("/admin/delete-all-products", { method: "POST", body: JSON.stringify({ password }) });
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

export const PAYMENT_LABELS: Record<string, string> = {
  cash: "Tunai",
  credit: "Kredit",
  qris_static: "QRIS Statis",
};

export type Promo = {
  id: string;
  name: string;
  kind: "buy_x_get_y" | "bundle" | "percent";
  conditions: { product_id: string; quantity: number }[];
  reward: { kind: "free_item" | "percent_discount" | "fixed_price"; product_id?: string | null; quantity: number; percent: number; fixed_price: number };
  active: boolean;
  note: string;
};

export type Shift = {
  id: string;
  operator_id: string;
  operator_name: string;
  opening_cash: number;
  closing_cash: number;
  expected_cash: number;
  difference: number;
  sales_total: number;
  cash_sales: number;
  non_cash_sales: number;
  cash_in?: number;
  cash_out?: number;
  transaction_count?: number;
  opened_at: string;
  closed_at?: string | null;
  note: string;
};
