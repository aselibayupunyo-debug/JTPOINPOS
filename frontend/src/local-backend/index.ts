/**
 * Local Backend router untuk JTPOIN POS.
 *
 * Semua API call dari UI (via `apiRequest` di `src/api.ts`) dirutekan ke
 * handler lokal di `./handlers.ts`. Tidak ada komunikasi jaringan — semua
 * data disimpan di SQLite perangkat.
 */
import * as h from "./handlers";
import { getDb, nowIso, uuid } from "./db";
import { HttpError, resolveUser, type Ctx } from "./handlers";
import { hashPassword } from "./crypto";

export { HttpError } from "./handlers";

type Method = "GET" | "POST" | "PUT" | "DELETE";
type Handler = (ctx: Ctx) => Promise<any>;

// --- Route table ---------------------------------------------------------

// Entries are matched in order; `:id` captures a path segment.
const ROUTES: { method: Method; pattern: string; handler: Handler; public?: boolean }[] = [
  // Auth
  { method: "POST", pattern: "/auth/login", handler: h.loginHandler, public: true },
  { method: "POST", pattern: "/auth/register", handler: h.registerHandler, public: true },
  { method: "GET", pattern: "/auth/me", handler: h.meHandler },
  { method: "POST", pattern: "/auth/logout", handler: h.logoutHandler },
  { method: "PUT", pattern: "/profile", handler: h.changePasswordHandler },
  { method: "PUT", pattern: "/profile/emergency", handler: h.emergencyProfileHandler },

  // Backup / Restore
  { method: "GET", pattern: "/backup", handler: h.backup },
  { method: "POST", pattern: "/restore", handler: h.restoreHandler },

  // Settings
  { method: "GET", pattern: "/settings", handler: h.getSettings },
  { method: "PUT", pattern: "/settings", handler: h.putSettings },
  { method: "GET", pattern: "/settings/logo-escpos", handler: h.logoEscpos },

  // Products
  { method: "GET", pattern: "/products", handler: h.listProducts },
  { method: "POST", pattern: "/products", handler: h.createProduct },
  { method: "POST", pattern: "/products/import", handler: h.importProducts },
  { method: "PUT", pattern: "/products/:id", handler: h.updateProduct },
  { method: "DELETE", pattern: "/products/:id", handler: h.deleteProduct },

  // Stock adjustments
  { method: "GET", pattern: "/stock-adjustments", handler: h.listStockAdjustments },
  { method: "POST", pattern: "/stock-adjustments", handler: h.createStockAdjustment },

  // Expenses + categories
  { method: "GET", pattern: "/expenses", handler: h.listExpenses },
  { method: "POST", pattern: "/expenses", handler: h.createExpense },
  { method: "DELETE", pattern: "/expenses/:id", handler: h.deleteExpense },
  { method: "GET", pattern: "/expense-categories", handler: h.listExpenseCategories },
  { method: "POST", pattern: "/expense-categories", handler: h.createExpenseCategory },
  { method: "DELETE", pattern: "/expense-categories/:id", handler: h.deleteExpenseCategory },

  // Categories
  { method: "GET", pattern: "/categories", handler: h.listCategories },
  { method: "POST", pattern: "/categories", handler: h.createCategory },
  { method: "PUT", pattern: "/categories/:id", handler: h.updateCategory },
  { method: "DELETE", pattern: "/categories/:id", handler: h.deleteCategory },

  // Payment methods
  { method: "GET", pattern: "/payment-methods", handler: h.listPaymentMethods },
  { method: "POST", pattern: "/payment-methods", handler: h.createPaymentMethod },
  { method: "PUT", pattern: "/payment-methods/:id", handler: h.updatePaymentMethod },
  { method: "DELETE", pattern: "/payment-methods/:id", handler: h.deletePaymentMethod },

  // Customers
  { method: "GET", pattern: "/customers", handler: h.getCustomers },
  { method: "POST", pattern: "/customers", handler: h.createCustomer },
  { method: "PUT", pattern: "/customers/:id", handler: h.updateCustomer },
  { method: "DELETE", pattern: "/customers/:id", handler: h.deleteCustomer },

  // Suppliers
  { method: "GET", pattern: "/suppliers", handler: h.getSuppliers },
  { method: "POST", pattern: "/suppliers", handler: h.createSupplier },
  { method: "PUT", pattern: "/suppliers/:id", handler: h.updateSupplier },
  { method: "DELETE", pattern: "/suppliers/:id", handler: h.deleteSupplier },

  // Transactions
  { method: "GET", pattern: "/transactions", handler: h.listTransactions },
  { method: "POST", pattern: "/transactions", handler: h.createTransaction },
  { method: "GET", pattern: "/transactions/:id", handler: h.getTransaction },
  { method: "POST", pattern: "/transactions/:id/pay", handler: h.payTransaction },

  // Parked
  { method: "GET", pattern: "/parked", handler: h.listParked },
  { method: "POST", pattern: "/parked", handler: h.createParked },
  { method: "DELETE", pattern: "/parked/:id", handler: h.deleteParked },

  // Promos
  { method: "GET", pattern: "/promos", handler: h.listPromos },
  { method: "POST", pattern: "/promos", handler: h.createPromo },
  { method: "PUT", pattern: "/promos/:id", handler: h.updatePromo },
  { method: "DELETE", pattern: "/promos/:id", handler: h.deletePromo },

  // Cash entries
  { method: "GET", pattern: "/cash-entries", handler: h.listCashEntries },
  { method: "POST", pattern: "/cash-entries", handler: h.createCashEntry },
  { method: "DELETE", pattern: "/cash-entries/:id", handler: h.deleteCashEntry },

  // Debts
  { method: "GET", pattern: "/debts", handler: h.listDebts },

  // Shifts
  { method: "GET", pattern: "/shifts", handler: h.listShifts },
  { method: "GET", pattern: "/shifts/current", handler: h.activeShift },
  { method: "POST", pattern: "/shifts/open", handler: h.openShift },
  { method: "GET", pattern: "/shifts/:id", handler: h.getShift },
  { method: "POST", pattern: "/shifts/:id/close", handler: h.closeShift },

  // Reports
  { method: "GET", pattern: "/reports/summary", handler: h.reportSummary },
  { method: "GET", pattern: "/reports/products", handler: h.reportProducts },
  { method: "GET", pattern: "/reports/customers", handler: h.reportCustomers },
  { method: "GET", pattern: "/reports/operators", handler: h.reportOperators },
  { method: "GET", pattern: "/reports/sales-items", handler: h.reportSalesItems },
  { method: "GET", pattern: "/reports/stock-tracking", handler: h.reportStockTracking },
  { method: "GET", pattern: "/reports/expenses", handler: h.reportExpenses },
  { method: "GET", pattern: "/reports/profit-loss", handler: h.reportProfitLoss },
  { method: "GET", pattern: "/reports/tax-summary", handler: h.reportTaxSummary },

  // Operators
  { method: "GET", pattern: "/operators", handler: h.listOperators },
  { method: "POST", pattern: "/operators", handler: h.createOperator },
  { method: "PUT", pattern: "/operators/:id", handler: h.updateOperator },
  { method: "DELETE", pattern: "/operators/:id", handler: h.deleteOperator },

  // Audit
  { method: "GET", pattern: "/audit-logs", handler: h.listAuditLogs },

  // Integrations / meta
  { method: "GET", pattern: "/integrations/status", handler: h.integrationsStatus },

  // Admin
  { method: "POST", pattern: "/admin/reset-transactions", handler: h.resetTransactions },
  { method: "POST", pattern: "/admin/delete-all-products", handler: h.deleteAllProducts },
];

// --- Matcher -------------------------------------------------------------

function matchRoute(method: Method, path: string): { entry: typeof ROUTES[number]; params: Record<string, string> } | null {
  for (const entry of ROUTES) {
    if (entry.method !== method) continue;
    const pSegs = entry.pattern.split("/").filter(Boolean);
    const uSegs = path.split("/").filter(Boolean);
    if (pSegs.length !== uSegs.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < pSegs.length; i++) {
      if (pSegs[i].startsWith(":")) params[pSegs[i].slice(1)] = decodeURIComponent(uSegs[i]);
      else if (pSegs[i] !== uSegs[i]) { ok = false; break; }
    }
    if (ok) return { entry, params };
  }
  return null;
}

function parseQuery(qs: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!qs) return out;
  for (const part of qs.split("&")) {
    if (!part) continue;
    const [k, ...rest] = part.split("=");
    out[decodeURIComponent(k)] = decodeURIComponent(rest.join("=") || "");
  }
  return out;
}

// --- Entrypoint ----------------------------------------------------------

export type LocalResponse = {
  status: number;
  data: any;
};

/**
 * Dispatch sebuah "request" ke local handler.
 *
 * - `path` tanpa prefix `/api` (sudah dibuang caller).
 * - `method` adalah HTTP verb standard.
 * - `body` adalah plain object (sudah di-parse dari JSON string jika perlu).
 * - `token` adalah token Bearer dari secure storage.
 */
export async function localFetch(args: {
  method: Method;
  path: string;
  body: any;
  token: string | null;
}): Promise<LocalResponse> {
  const [rawPath, qs] = args.path.split("?");
  const match = matchRoute(args.method, rawPath);
  if (!match) {
    return { status: 404, data: { detail: `Endpoint ${args.method} ${rawPath} tidak ditemukan (offline)` } };
  }

  // Resolve user from token for every call (sessions table is cheap in SQLite)
  const user = match.entry.public ? null : await resolveUser(args.token);
  if (!match.entry.public && !user) {
    return { status: 401, data: { detail: "Sesi tidak valid" } };
  }

  const ctx: Ctx = {
    path: rawPath,
    method: args.method,
    body: args.body ?? null,
    query: parseQuery(qs || ""),
    user,
    params: match.params,
  };

  try {
    const data = await match.entry.handler(ctx);
    return { status: 200, data };
  } catch (e) {
    if (e instanceof HttpError) return { status: e.status, data: { detail: e.detail } };
    const msg = e instanceof Error ? e.message : "Kesalahan tidak dikenal";
    return { status: 500, data: { detail: msg } };
  }
}

// --- First-run seeding --------------------------------------------------

const DEFAULT_ADMIN_USERNAME = "admin";
const DEFAULT_ADMIN_PASSWORD = "admin";

/**
 * Dipanggil sekali saat app launch. Memastikan setidaknya ada 1 akun admin
 * default (`admin` / `admin`) agar user baru bisa langsung login.
 */
export async function initLocalBackend(): Promise<void> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ cnt: number }>("SELECT COUNT(*) as cnt FROM users");
  if ((row?.cnt ?? 0) > 0) return;

  const { hash, salt } = await hashPassword(DEFAULT_ADMIN_PASSWORD);
  const userId = uuid();
  const businessId = uuid();
  const now = nowIso();
  const permissions = JSON.stringify(["sales", "purchases", "returns", "inventory", "reports", "cashflow", "debts", "operators", "settings"]);

  await db.runAsync(
    `INSERT INTO users (id,business_id,business_name,username,display_name,password_hash,password_salt,role,permissions,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [userId, businessId, "JTPOIN POS", DEFAULT_ADMIN_USERNAME, "Admin", hash, salt, "owner", permissions, now],
  );

  // Default settings for the seeded business
  const settings = {
    business_id: businessId,
    business_name: "JTPOIN POS",
    address: "",
    phone: "",
    footer_note: "Terima kasih atas kunjungan Anda",
    receipt_width: "58mm" as const,
    logo_base64: null,
    header_lines: [],
    footer_lines: [],
    cashdrawer_enabled: false,
    multi_printer: false,
    tax_percent: 0,
    tax_label: "Pajak",
    shipping_default: 0,
    allow_price_edit: true,
    allow_preview_print: true,
    auto_park_on_cancel: false,
    confirm_cancel: true,
    price_levels: [{ id: "default", name: "Standar" }],
    enabled_payment_kinds: ["cash", "credit", "qris_static", "custom"],
    email_recipient: "",
  };
  await db.runAsync(
    "INSERT INTO business_settings (business_id, json) VALUES (?, ?)",
    [businessId, JSON.stringify(settings)],
  );

  // Default payment methods — expected by the cashier screen
  const defaultPM = [
    { id: "pm_cash", name: "Tunai", kind: "cash", enabled: true, sort_order: 0 },
    { id: "pm_credit", name: "Kredit", kind: "credit", enabled: true, sort_order: 1 },
    { id: "pm_qris", name: "QRIS Statis", kind: "qris_static", enabled: true, sort_order: 2 },
  ];
  for (const pm of defaultPM) {
    await db.runAsync("INSERT INTO payment_methods (id,business_id,json) VALUES (?,?,?)",
      [pm.id, businessId, JSON.stringify({ ...pm, business_id: businessId })]);
  }

  // One default category so pickers aren't empty
  const catId = uuid();
  await db.runAsync("INSERT INTO categories (id,business_id,json) VALUES (?,?,?)",
    [catId, businessId, JSON.stringify({ id: catId, business_id: businessId, name: "Umum", icon: "pricetag-outline" })]);
}
