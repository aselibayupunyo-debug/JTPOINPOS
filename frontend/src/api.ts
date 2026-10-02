/**
 * API wrapper untuk JTPOIN POS — 100% offline.
 *
 * Semua request diteruskan ke `local-backend/index.ts` (SQLite di perangkat).
 * Tidak ada koneksi jaringan ke server luar. Interface fungsi dipertahankan
 * agar screens yang sudah ada tidak perlu diubah.
 */
import { localFetch } from "@/src/local-backend";
import { storage } from "@/src/utils/storage";

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
  use_price_levels?: boolean;
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
  period: "daily" | "monthly" | "yearly" | "custom";
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
  constructor(message = "Operasi tidak tersedia saat offline") { super(message); this.name = "OfflineError"; }
}

// ---------------------------------------------------------------------------
// Core request — rutekan ke local backend. Interface tetap seperti `fetch()`-like.
// ---------------------------------------------------------------------------

type Method = "GET" | "POST" | "PUT" | "DELETE";

function parseMethod(m: string | undefined): Method {
  const up = (m || "GET").toUpperCase();
  if (up === "GET" || up === "POST" || up === "PUT" || up === "DELETE") return up;
  return "GET";
}

function parseBody(body: BodyInit | null | undefined): any {
  if (body === null || body === undefined) return null;
  if (typeof body === "string") {
    try { return JSON.parse(body); } catch { return body; }
  }
  // FormData / Blob / ArrayBuffer not supported in offline mode
  return null;
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await storage.secureGet<string | null>(TOKEN_KEY, null);
  const method = parseMethod(options.method);
  const body = parseBody(options.body as any);
  const res = await localFetch({ method, path, body, token });
  if (res.status >= 400) {
    const detail = (res.data && typeof res.data === "object" && "detail" in res.data) ? String(res.data.detail) : "Terjadi kesalahan";
    throw new Error(detail);
  }
  return res.data as T;
}

/**
 * Dipertahankan untuk kompatibilitas layar lama. Di mode offline tidak ada
 * perbedaan antara "cache" dan "fresh" — jadi `fromCache` selalu false.
 */
export async function cachedGet<T>(path: string): Promise<{ data: T; fromCache: boolean }> {
  const data = await apiRequest<T>(path);
  return { data, fromCache: false };
}

/**
 * Dipertahankan untuk kompatibilitas. Di mode offline, semua mutation
 * langsung tereksekusi (tidak pernah di-queue).
 */
export async function syncMutation(method: "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<{ data: unknown | null; queued: boolean }> {
  const data = await apiRequest<unknown>(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { data, queued: false };
}

// Offline mode — tidak ada queue, langsung return 0 / no-op.
export async function flushQueue(): Promise<{ sent: number; failed: number }> {
  return { sent: 0, failed: 0 };
}
export async function pendingSyncCount(): Promise<number> { return 0; }

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

export async function login(username: string, password: string) {
  return apiRequest<{ token: string; user: User }>("/auth/login", {
    method: "POST", body: JSON.stringify({ username, password }),
  });
}

export async function register(payload: { business_name: string; owner_name: string; username: string; password: string }) {
  // Map ke format handler lokal (display_name).
  return apiRequest<{ token: string; user: User }>("/auth/register", {
    method: "POST",
    body: JSON.stringify({
      business_name: payload.business_name,
      display_name: payload.owner_name,
      username: payload.username,
      password: payload.password,
    }),
  });
}

export async function saveToken(token: string) { return storage.secureSet(TOKEN_KEY, token); }
export async function clearToken() { return storage.secureRemove(TOKEN_KEY); }

// ---------------------------------------------------------------------------
// Import/Export Excel — perlu diproses secara lokal.
// ---------------------------------------------------------------------------

export async function uploadProducts(_file: { uri: string; name: string; mimeType?: string | null }): Promise<{ imported: number }> {
  throw new OfflineError("Import produk via Excel sedang dinonaktifkan di mode offline. Tambah produk manual lewat menu Stok.");
}

export async function downloadProductsExcel(): Promise<{ base64: string; filename: string }> {
  // Hasilkan CSV sederhana (bisa dibuka Excel) berisi daftar produk saat ini.
  const products = await apiRequest<Product[]>("/products");
  const header = ["name", "sku", "barcode", "category", "price", "cost", "stock", "min_stock", "base_unit", "product_type"];
  const rows = products.map((p) => header.map((k) => csvCell((p as any)[k])).join(","));
  const csv = [header.join(","), ...rows].join("\n");
  const base64 = toBase64(csv);
  return { base64, filename: `produk-${Date.now()}.csv` };
}

export async function downloadReportsExcel(period: "daily" | "monthly" | "yearly" | "custom", start?: string, end?: string): Promise<{ base64: string; filename: string }> {
  const qs = new URLSearchParams({ period });
  if (start) qs.set("start", start);
  if (end) qs.set("end", end);
  const [summary, products, customers, operators, salesItems] = await Promise.all([
    apiRequest<ReportSummary>(`/reports/summary?${qs}`).catch(() => null),
    apiRequest<{ rows: ProductReportRow[] }>(`/reports/products?${qs}`).catch(() => ({ rows: [] })),
    apiRequest<{ rows: CustomerReportRow[] }>(`/reports/customers?${qs}`).catch(() => ({ rows: [] })),
    apiRequest<{ rows: OperatorReportRow[] }>(`/reports/operators?${qs}`).catch(() => ({ rows: [] })),
    apiRequest<{ rows: SalesItemRow[] }>(`/reports/sales-items?${qs}`).catch(() => ({ rows: [] })),
  ]);

  const sections: string[] = [];
  if (summary) {
    sections.push("Ringkasan");
    sections.push("Field,Value");
    for (const [k, v] of Object.entries(summary)) sections.push(`${k},${csvCell(v)}`);
    sections.push("");
  }
  const addRows = (title: string, rows: any[], keys: string[]) => {
    sections.push(title);
    sections.push(keys.join(","));
    for (const r of rows) sections.push(keys.map((k) => csvCell(r[k])).join(","));
    sections.push("");
  };
  addRows("Produk", products.rows, ["name", "quantity", "revenue", "profit"]);
  addRows("Pelanggan", customers.rows, ["customer_name", "transaction_count", "total_spent", "outstanding", "profit"]);
  addRows("Operator", operators.rows, ["name", "transaction_count", "total_sales", "profit"]);
  addRows("Detail Penjualan", salesItems.rows, ["invoice_no", "created_at", "customer_name", "operator_name", "name", "quantity", "unit", "price", "subtotal"]);

  const csv = sections.join("\n");
  const base64 = toBase64(csv);
  return { base64, filename: `laporan-${period}-${Date.now()}.csv` };
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toBase64(input: string): string {
  // UTF-8 safe base64 (Hermes global `btoa` only handles latin-1).
  const bytes = utf8Encode(input);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

function utf8Encode(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) { out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f)); }
    else if (c >= 0xd800 && c <= 0xdbff) {
      const c2 = s.charCodeAt(++i);
      const cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
      out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else { out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)); }
  }
  return new Uint8Array(out);
}

// ---------------------------------------------------------------------------
// Profile / admin
// ---------------------------------------------------------------------------

export async function updateProfile(payload: { name?: string; username?: string; current_password: string; new_password?: string }) {
  // Map `name` -> `display_name` untuk handler lokal.
  const body: any = { current_password: payload.current_password };
  if (payload.name) body.display_name = payload.name;
  if (payload.username) body.username = payload.username;
  if (payload.new_password) body.new_password = payload.new_password;
  const u = await apiRequest<User>("/profile", { method: "PUT", body: JSON.stringify(body) });
  return { ok: true, user: u };
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
