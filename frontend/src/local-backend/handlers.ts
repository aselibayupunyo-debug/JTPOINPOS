/**
 * Semua handler untuk Local Backend JTPOIN POS.
 *
 * Setiap handler menerima (ctx) dan mengembalikan data JSON. Dispatcher
 * `localFetch` di `index.ts` memilih handler berdasarkan path + method.
 */
import { getDb, nextCounter, nowIso, uuid } from "./db";
import { hashPassword, randomToken, verifyPassword } from "./crypto";

export type Ctx = {
  path: string; // e.g., "/products/abc123"
  method: "GET" | "POST" | "PUT" | "DELETE";
  body: Record<string, any> | null;
  query: Record<string, string>;
  user: UserRow | null;
  params: Record<string, string>;
};

export type UserRow = {
  id: string;
  business_id: string;
  business_name: string;
  username: string;
  display_name: string;
  role: string;
  permissions: string[];
};

export class HttpError extends Error {
  constructor(public status: number, public detail: string) { super(detail); }
}

// ---------- Helpers ----------
async function loadSettings(businessId: string): Promise<any> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ json: string }>(
    "SELECT json FROM business_settings WHERE business_id = ?",
    [businessId],
  );
  if (row?.json) return JSON.parse(row.json);
  // Defaults
  return {
    business_id: businessId,
    business_name: "",
    address: "",
    phone: "",
    email: "",
    tax_label: "Pajak",
    tax_percent: 0,
    receipt_width: "58mm",
    footer_note: "Terima kasih",
    logo_base64: null,
    header_lines: [],
    footer_lines: [],
    cashdrawer_enabled: false,
    allow_price_edit: true,
    auto_park_on_cancel: false,
    confirm_cancel: true,
    price_levels: [{ id: "default", name: "Standar" }],
    enabled_payment_kinds: ["cash", "credit", "qris_static", "custom"],
    email_recipient: "",
  };
}

async function saveSettings(businessId: string, settings: any): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "INSERT INTO business_settings (business_id, json) VALUES (?, ?) ON CONFLICT(business_id) DO UPDATE SET json = ?",
    [businessId, JSON.stringify(settings), JSON.stringify(settings)],
  );
}

async function fetchListJSON<T>(table: string, businessId: string, extraWhere = "", params: any[] = []): Promise<T[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ json: string }>(
    `SELECT json FROM ${table} WHERE business_id = ? ${extraWhere}`,
    [businessId, ...params],
  );
  return rows.map((r) => JSON.parse(r.json)) as T[];
}

// ---------- AUTH ----------
export async function registerHandler(ctx: Ctx): Promise<any> {
  const { username, password, business_name, display_name } = ctx.body || {};
  if (!username || !password || !business_name) throw new HttpError(400, "username, password, dan business_name wajib diisi");
  const db = await getDb();
  const existing = await db.getFirstAsync("SELECT id FROM users WHERE username = ?", [username]);
  if (existing) throw new HttpError(400, "Username sudah dipakai");
  const { hash, salt } = await hashPassword(password);
  const user = {
    id: uuid(),
    business_id: uuid(),
    business_name: String(business_name),
    username: String(username),
    display_name: String(display_name || business_name),
    password_hash: hash,
    password_salt: salt,
    role: "owner",
    permissions: JSON.stringify(["sales","purchases","returns","products","contacts","settings","reports","admin"]),
    created_at: nowIso(),
  };
  await db.runAsync(
    "INSERT INTO users (id,business_id,business_name,username,display_name,password_hash,password_salt,role,permissions,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [user.id, user.business_id, user.business_name, user.username, user.display_name, user.password_hash, user.password_salt, user.role, user.permissions, user.created_at],
  );
  // Seed default settings + payment methods + categories
  await saveSettings(user.business_id, { ...(await loadSettings(user.business_id)), business_name: user.business_name });
  const defaultPM = [
    { id: "pm_cash", name: "Tunai", kind: "cash", active: true },
    { id: "pm_credit", name: "Kredit", kind: "credit", active: true },
    { id: "pm_qris", name: "QRIS Statis", kind: "qris_static", active: true },
  ];
  for (const pm of defaultPM) {
    await db.runAsync("INSERT INTO payment_methods (id,business_id,json) VALUES (?,?,?)", [pm.id, user.business_id, JSON.stringify(pm)]);
  }
  const defaultCats = [
    { id: uuid(), business_id: user.business_id, name: "Umum", icon: "pricetag-outline" },
  ];
  for (const c of defaultCats) {
    await db.runAsync("INSERT INTO categories (id,business_id,json) VALUES (?,?,?)", [c.id, user.business_id, JSON.stringify(c)]);
  }
  const token = await randomToken();
  await db.runAsync("INSERT INTO sessions (token,user_id,created_at) VALUES (?,?,?)", [token, user.id, nowIso()]);
  return { token, user: await meFromUserId(user.id) };
}

export async function loginHandler(ctx: Ctx): Promise<any> {
  const { username, password } = ctx.body || {};
  if (!username || !password) {
    // Diagnostic: tunjukkan apa yg benar2 diterima server supaya mudah debug
    // kalau LAN sync bermasalah (body kosong, keys salah, dll).
    const bodyType = ctx.body === null ? "null" : typeof ctx.body;
    const keys = ctx.body && typeof ctx.body === "object" ? Object.keys(ctx.body).join(",") : "-";
    const bodyPreview = ctx.body !== null && ctx.body !== undefined
      ? (typeof ctx.body === "string" ? ctx.body.slice(0, 60) : JSON.stringify(ctx.body).slice(0, 60))
      : "-";
    throw new HttpError(400, `Isi username & password [body=${bodyType} keys=${keys} preview=${bodyPreview}]`);
  }
  const db = await getDb();
  const row = await db.getFirstAsync<any>("SELECT * FROM users WHERE username = ?", [username]);
  if (!row) throw new HttpError(401, "Username/password salah");
  const ok = await verifyPassword(String(password), row.password_hash, row.password_salt);
  if (!ok) throw new HttpError(401, "Username/password salah");
  const token = await randomToken();
  await db.runAsync("INSERT INTO sessions (token,user_id,created_at) VALUES (?,?,?)", [token, row.id, nowIso()]);
  return { token, user: await meFromUserId(row.id) };
}

async function meFromUserId(userId: string): Promise<any> {
  const db = await getDb();
  const row = await db.getFirstAsync<any>("SELECT * FROM users WHERE id = ?", [userId]);
  if (!row) throw new HttpError(401, "Sesi tidak valid");
  return {
    id: row.id,
    business_id: row.business_id,
    business_name: row.business_name,
    username: row.username,
    // UI mengharap field `name` — alias dari display_name internal.
    name: row.display_name,
    display_name: row.display_name,
    role: row.role,
    permissions: JSON.parse(row.permissions || "[]"),
  };
}

export async function meHandler(ctx: Ctx): Promise<any> {
  if (!ctx.user) throw new HttpError(401, "Sesi tidak valid");
  return meFromUserId(ctx.user.id);
}

export async function logoutHandler(_ctx: Ctx): Promise<any> {
  // Token handled by caller (clears local storage)
  return { ok: true };
}

export async function changePasswordHandler(ctx: Ctx): Promise<any> {
  if (!ctx.user) throw new HttpError(401, "Sesi tidak valid");
  const { current_password, new_password, display_name, username } = ctx.body || {};
  const db = await getDb();
  if (!current_password) throw new HttpError(400, "Isi password saat ini");
  const row = await db.getFirstAsync<any>("SELECT password_hash, password_salt FROM users WHERE id = ?", [ctx.user.id]);
  if (!row || !(await verifyPassword(current_password, row.password_hash, row.password_salt))) {
    throw new HttpError(401, "Password saat ini salah");
  }
  if (new_password) {
    const { hash, salt } = await hashPassword(new_password);
    await db.runAsync("UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?", [hash, salt, ctx.user.id]);
  }
  if (display_name) {
    await db.runAsync("UPDATE users SET display_name = ? WHERE id = ?", [display_name, ctx.user.id]);
  }
  if (username) {
    const existing = await db.getFirstAsync<any>("SELECT id FROM users WHERE username = ? AND id != ?", [username, ctx.user.id]);
    if (existing) throw new HttpError(400, "Username sudah dipakai");
    await db.runAsync("UPDATE users SET username = ? WHERE id = ?", [username, ctx.user.id]);
  }
  return meFromUserId(ctx.user.id);
}

// ---------- Resolve current user from token ----------
export async function resolveUser(token: string | null): Promise<UserRow | null> {
  if (!token) return null;
  const db = await getDb();
  const row = await db.getFirstAsync<any>(
    "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?",
    [token],
  );
  if (!row) return null;
  return {
    id: row.id, business_id: row.business_id, business_name: row.business_name,
    username: row.username, display_name: row.display_name, role: row.role,
    permissions: JSON.parse(row.permissions || "[]"),
  };
}

function requireUser(ctx: Ctx): UserRow {
  if (!ctx.user) throw new HttpError(401, "Sesi tidak valid");
  return ctx.user;
}

// ---------- SETTINGS ----------
export async function getSettings(ctx: Ctx): Promise<any> {
  const u = requireUser(ctx);
  return loadSettings(u.business_id);
}

export async function putSettings(ctx: Ctx): Promise<any> {
  const u = requireUser(ctx);
  const current = await loadSettings(u.business_id);
  const next = { ...current, ...(ctx.body || {}), business_id: u.business_id };
  await saveSettings(u.business_id, next);
  return next;
}

// ---------- CRUD GENERIC: name/icon tables (categories, payment_methods, promos) ----------
async function listSimple(table: string, businessId: string): Promise<any[]> {
  return fetchListJSON<any>(table, businessId);
}
async function upsertSimple(table: string, businessId: string, body: any, id?: string): Promise<any> {
  const db = await getDb();
  const doc = { ...body, id: id || body.id || uuid(), business_id: businessId };
  await db.runAsync(
    `INSERT INTO ${table} (id,business_id,json) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET json = excluded.json`,
    [doc.id, businessId, JSON.stringify(doc)],
  );
  return doc;
}
async function deleteSimple(table: string, businessId: string, id: string): Promise<any> {
  const db = await getDb();
  await db.runAsync(`DELETE FROM ${table} WHERE id = ? AND business_id = ?`, [id, businessId]);
  return { ok: true };
}

// ---------- PRODUCTS ----------
export async function listProducts(ctx: Ctx): Promise<any> {
  const u = requireUser(ctx);
  return fetchListJSON("products", u.business_id);
}
export async function createProduct(ctx: Ctx): Promise<any> {
  const u = requireUser(ctx);
  const db = await getDb();
  const now = nowIso();
  const doc = { ...(ctx.body || {}), id: uuid(), business_id: u.business_id, created_at: now, updated_at: now };
  await db.runAsync("INSERT INTO products (id,business_id,json,created_at,updated_at) VALUES (?,?,?,?,?)", [doc.id, u.business_id, JSON.stringify(doc), now, now]);
  return doc;
}
export async function updateProduct(ctx: Ctx): Promise<any> {
  const u = requireUser(ctx);
  const db = await getDb();
  const id = ctx.params.id;
  const existing = await db.getFirstAsync<{ json: string }>("SELECT json FROM products WHERE id = ? AND business_id = ?", [id, u.business_id]);
  if (!existing) throw new HttpError(404, "Produk tidak ditemukan");
  const prev = JSON.parse(existing.json);
  const now = nowIso();
  const next = { ...prev, ...(ctx.body || {}), id, business_id: u.business_id, updated_at: now };
  await db.runAsync("UPDATE products SET json = ?, updated_at = ? WHERE id = ?", [JSON.stringify(next), now, id]);
  return next;
}
export async function deleteProduct(ctx: Ctx): Promise<any> {
  const u = requireUser(ctx);
  return deleteSimple("products", u.business_id, ctx.params.id);
}

// ---------- PRODUCTS IMPORT (CSV) ----------
/**
 * Import banyak produk sekaligus dari array rows (frontend sudah parse CSV).
 * Baris existing berdasarkan `sku` atau `barcode` akan di-upsert.
 */
export async function importProducts(ctx: Ctx): Promise<any> {
  const u = requireUser(ctx);
  const db = await getDb();
  const rows: any[] = Array.isArray(ctx.body?.rows) ? ctx.body.rows : [];
  if (!rows.length) throw new HttpError(400, "Tidak ada baris untuk diimpor");

  // Index existing products by sku/barcode untuk upsert.
  const existing = await db.getAllAsync<{ id: string; json: string }>(
    "SELECT id, json FROM products WHERE business_id = ?",
    [u.business_id],
  );
  const byKey: Record<string, any> = {};
  for (const r of existing) {
    const d = JSON.parse(r.json);
    if (d.sku) byKey[`sku:${String(d.sku).toLowerCase()}`] = d;
    if (d.barcode) byKey[`bc:${String(d.barcode).toLowerCase()}`] = d;
  }

  const now = nowIso();
  let created = 0, updated = 0;
  for (const raw of rows) {
    const name = String(raw.name ?? raw.nama ?? "").trim();
    if (!name) continue;
    const price = Number(raw.price ?? raw.harga ?? 0) || 0;
    const cost = Number(raw.cost ?? raw.pokok ?? raw.hpp ?? 0) || 0;
    const stock = Number(raw.stock ?? raw.stok ?? 0) || 0;
    const min_stock = Number(raw.min_stock ?? raw.stok_minimal ?? 0) || 0;
    const sku = String(raw.sku ?? "").trim();
    const barcode = String(raw.barcode ?? "").trim();
    const category = String(raw.category ?? raw.kategori ?? "Umum").trim() || "Umum";
    const base_unit = String(raw.base_unit ?? raw.satuan ?? "Pcs").trim() || "Pcs";
    const product_type = (String(raw.product_type ?? raw.tipe ?? "goods").toLowerCase() === "service") ? "service" : "goods";

    const key = sku ? `sku:${sku.toLowerCase()}` : (barcode ? `bc:${barcode.toLowerCase()}` : "");
    const match = key ? byKey[key] : null;
    if (match) {
      const next = { ...match, name, sku, barcode, category, price, cost, stock, min_stock, base_unit, product_type, updated_at: now };
      await db.runAsync("UPDATE products SET json = ?, updated_at = ? WHERE id = ?", [JSON.stringify(next), now, match.id]);
      updated++;
    } else {
      const doc = { id: uuid(), business_id: u.business_id, name, sku, barcode, category, price, cost, stock, min_stock, base_unit, product_type, created_at: now, updated_at: now };
      await db.runAsync(
        "INSERT INTO products (id,business_id,json,created_at,updated_at) VALUES (?,?,?,?,?)",
        [doc.id, u.business_id, JSON.stringify(doc), now, now],
      );
      created++;
    }
  }
  await appendAudit(u.business_id, u, "import_products", "products", { created, updated });
  return { imported: created + updated, created, updated };
}

// ---------- STOCK ADJUSTMENTS ----------
/**
 * Catat penambahan / pengurangan stok manual.
 * body: { product_id, delta, reason?, cost? }
 */
export async function createStockAdjustment(ctx: Ctx): Promise<any> {
  const u = requireUser(ctx);
  const db = await getDb();
  const body = ctx.body || {};
  const productId = String(body.product_id || "");
  const delta = Number(body.delta || 0);
  if (!productId) throw new HttpError(400, "Produk wajib diisi");
  if (!Number.isFinite(delta) || delta === 0) throw new HttpError(400, "Perubahan stok tidak valid");

  const row = await db.getFirstAsync<{ json: string }>(
    "SELECT json FROM products WHERE id = ? AND business_id = ?",
    [productId, u.business_id],
  );
  if (!row) throw new HttpError(404, "Produk tidak ditemukan");
  const product = JSON.parse(row.json);
  const before = Number(product.stock || 0);
  const after = Math.max(0, Math.round((before + delta) * 100) / 100);
  product.stock = after;
  product.updated_at = nowIso();
  await db.runAsync("UPDATE products SET json = ?, updated_at = ? WHERE id = ?", [JSON.stringify(product), product.updated_at, productId]);

  const adj = {
    id: uuid(),
    business_id: u.business_id,
    product_id: productId,
    product_name: product.name,
    delta,
    before,
    after,
    reason: String(body.reason || (delta > 0 ? "Tambah stok" : "Kurangi stok")),
    cost: Number(body.cost || 0) || 0,
    created_at: nowIso(),
    created_by: u.id,
    created_by_name: u.display_name,
  };
  await db.runAsync(
    "INSERT INTO stock_adjustments (id,business_id,product_id,created_at,json) VALUES (?,?,?,?,?)",
    [adj.id, u.business_id, productId, adj.created_at, JSON.stringify(adj)],
  );
  return adj;
}
export async function listStockAdjustments(ctx: Ctx): Promise<any> {
  const u = requireUser(ctx);
  const db = await getDb();
  const rows = await db.getAllAsync<{ json: string }>(
    "SELECT json FROM stock_adjustments WHERE business_id = ? ORDER BY created_at DESC",
    [u.business_id],
  );
  return rows.map((r) => JSON.parse(r.json));
}

// ---------- EXPENSES ----------
export async function listExpenses(ctx: Ctx): Promise<any> {
  const u = requireUser(ctx);
  const db = await getDb();
  const [start, end] = periodRange(ctx.query);
  const rows = await db.getAllAsync<{ json: string }>(
    "SELECT json FROM expenses WHERE business_id = ? ORDER BY created_at DESC",
    [u.business_id],
  );
  const items = rows.map((r) => JSON.parse(r.json)).filter((e) => {
    const ts = new Date(e.created_at).getTime();
    return ts >= start && ts <= end;
  });
  const total = items.reduce((s, e) => s + Number(e.amount || 0), 0);
  return { total, items };
}
export async function createExpense(ctx: Ctx): Promise<any> {
  const u = requireUser(ctx);
  const db = await getDb();
  const body = ctx.body || {};
  const amount = Number(body.amount || 0);
  if (!amount || amount <= 0) throw new HttpError(400, "Jumlah biaya wajib diisi");
  const now = nowIso();
  const doc = {
    id: uuid(),
    business_id: u.business_id,
    amount,
    category: String(body.category || "Lainnya"),
    note: String(body.note || ""),
    payment_method: String(body.payment_method || "cash"),
    payment_method_label: String(body.payment_method_label || "Tunai"),
    tax_amount: Number(body.tax_amount || 0) || 0,
    tax_percent: Number(body.tax_percent || 0) || 0,
    created_at: now,
    created_by: u.id,
    created_by_name: u.display_name,
  };
  await db.runAsync("INSERT INTO expenses (id,business_id,created_at,json) VALUES (?,?,?,?)", [doc.id, u.business_id, now, JSON.stringify(doc)]);

  // Jika metode pembayaran = cash → juga catat kas keluar
  const method = String(body.payment_method || "cash");
  if (method === "cash" || method === "pm_cash") {
    const entry = {
      id: uuid(),
      business_id: u.business_id,
      amount,
      entry_type: "expense",
      category: doc.category,
      note: `Biaya: ${doc.category}${doc.note ? ` · ${doc.note}` : ""}`,
      created_at: now,
      created_by: u.id,
      created_by_name: u.display_name,
      expense_id: doc.id,
    };
    await db.runAsync("INSERT INTO cash_entries (id,business_id,created_at,json) VALUES (?,?,?,?)", [entry.id, u.business_id, now, JSON.stringify(entry)]);
  }
  return doc;
}
export async function deleteExpense(ctx: Ctx): Promise<any> {
  const u = requireUser(ctx);
  const db = await getDb();
  // Juga hapus cash entry terkait
  await db.runAsync("DELETE FROM cash_entries WHERE business_id = ? AND json LIKE ?", [u.business_id, `%"expense_id":"${ctx.params.id}"%`]);
  return deleteSimple("expenses", u.business_id, ctx.params.id);
}

// ---------- EXPENSE CATEGORIES ----------
export async function listExpenseCategories(ctx: Ctx): Promise<any> {
  const u = requireUser(ctx);
  const list = await fetchListJSON<any>("expense_categories", u.business_id);
  if (list.length === 0) {
    // Seed default pos biaya umum
    const defaults = [
      "Gaji & THR", "Listrik", "Air", "Internet", "Sewa Tempat",
      "Transportasi", "Perlengkapan Toko", "Operasional Harian",
      "Pajak & Retribusi", "Promosi & Iklan", "Perawatan Alat", "Lainnya",
    ];
    const db = await getDb();
    for (const name of defaults) {
      const d = { id: uuid(), business_id: u.business_id, name };
      await db.runAsync("INSERT INTO expense_categories (id,business_id,json) VALUES (?,?,?)", [d.id, u.business_id, JSON.stringify(d)]);
    }
    return fetchListJSON("expense_categories", u.business_id);
  }
  return list;
}
export async function createExpenseCategory(ctx: Ctx): Promise<any> {
  const u = requireUser(ctx);
  const db = await getDb();
  const doc = { id: uuid(), business_id: u.business_id, name: String((ctx.body || {}).name || "").trim() };
  if (!doc.name) throw new HttpError(400, "Nama pos biaya wajib diisi");
  await db.runAsync("INSERT INTO expense_categories (id,business_id,json) VALUES (?,?,?)", [doc.id, u.business_id, JSON.stringify(doc)]);
  return doc;
}
export async function deleteExpenseCategory(ctx: Ctx): Promise<any> {
  return deleteSimple("expense_categories", requireUser(ctx).business_id, ctx.params.id);
}

// ---------- REPORT: STOCK TRACKING ----------
export async function reportStockTracking(ctx: Ctx): Promise<any> {
  const u = requireUser(ctx);
  const [start, end] = periodRange(ctx.query);
  const db = await getDb();

  // Semua pergerakan: transaksi (sale/purchase/returns) + stock_adjustments
  const txRows = await db.getAllAsync<{ json: string }>(
    "SELECT json FROM transactions_t WHERE business_id = ? ORDER BY created_at DESC",
    [u.business_id],
  );
  const adjRows = await db.getAllAsync<{ json: string }>(
    "SELECT json FROM stock_adjustments WHERE business_id = ? ORDER BY created_at DESC",
    [u.business_id],
  );

  const rows: any[] = [];
  for (const r of txRows) {
    const tx = JSON.parse(r.json);
    if (tx.status === "cancelled") continue;
    const ts = new Date(tx.created_at).getTime();
    if (ts < start || ts > end) continue;
    const sign =
      tx.transaction_type === "sale" ? -1 :
      tx.transaction_type === "purchase" ? +1 :
      tx.transaction_type === "sale_return" ? +1 :
      tx.transaction_type === "purchase_return" ? -1 : 0;
    for (const i of (tx.items || [])) {
      if ((i.product_type || "goods") !== "goods") continue;
      rows.push({
        created_at: tx.created_at,
        product_id: i.product_id,
        product_name: i.name,
        kind: tx.transaction_type,
        reference: tx.invoice_no,
        delta: sign * Number(i.quantity || 0),
        actor: tx.created_by_name || "",
      });
    }
  }
  for (const r of adjRows) {
    const a = JSON.parse(r.json);
    const ts = new Date(a.created_at).getTime();
    if (ts < start || ts > end) continue;
    rows.push({
      created_at: a.created_at,
      product_id: a.product_id,
      product_name: a.product_name,
      kind: "adjustment",
      reference: a.reason || "Penyesuaian",
      delta: Number(a.delta || 0),
      actor: a.created_by_name || "",
    });
  }
  rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  // Current stock snapshot
  const products = await fetchListJSON<any>("products", u.business_id);
  const stock_in = rows.filter((r) => r.delta > 0).reduce((s, r) => s + r.delta, 0);
  const stock_out = rows.filter((r) => r.delta < 0).reduce((s, r) => s + Math.abs(r.delta), 0);
  return { rows, products, stock_in, stock_out, movement_count: rows.length };
}

// ---------- REPORT: EXPENSES ----------
export async function reportExpenses(ctx: Ctx): Promise<any> {
  const u = requireUser(ctx);
  const [start, end] = periodRange(ctx.query);
  const db = await getDb();
  const rows = await db.getAllAsync<{ json: string }>(
    "SELECT json FROM expenses WHERE business_id = ? ORDER BY created_at DESC",
    [u.business_id],
  );
  const items = rows.map((r) => JSON.parse(r.json)).filter((e) => {
    const ts = new Date(e.created_at).getTime();
    return ts >= start && ts <= end;
  });
  const byCategory: Record<string, number> = {};
  for (const e of items) {
    byCategory[e.category] = (byCategory[e.category] || 0) + Number(e.amount || 0);
  }
  const total = items.reduce((s, e) => s + Number(e.amount || 0), 0);
  const breakdown = Object.entries(byCategory).map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
  return { total, items, breakdown };
}

// ---------- REPORT: PROFIT & LOSS ----------
export async function reportProfitLoss(ctx: Ctx): Promise<any> {
  const u = requireUser(ctx);
  const [start, end] = periodRange(ctx.query);
  const db = await getDb();
  const txs = await txInRange(u.business_id, start, end);
  const sales = txs.filter((t) => t.transaction_type === "sale");
  const sreturns = txs.filter((t) => t.transaction_type === "sale_return");

  const gross_sales = sales.reduce((s, t) => s + (t.total || 0), 0);
  const returns_amount = sreturns.reduce((s, t) => s + (t.total || 0), 0);
  const net_sales = gross_sales - returns_amount;

  const cogs = sales.reduce((s, t) => s + (t.items || []).reduce((a: number, i: any) => a + (Number(i.cost || 0) * Number(i.quantity || 0)), 0), 0)
    - sreturns.reduce((s, t) => s + (t.items || []).reduce((a: number, i: any) => a + (Number(i.cost || 0) * Number(i.quantity || 0)), 0), 0);
  const gross_profit = net_sales - cogs;

  const expRows = await db.getAllAsync<{ json: string }>(
    "SELECT json FROM expenses WHERE business_id = ?",
    [u.business_id],
  );
  const expenses = expRows.map((r) => JSON.parse(r.json)).filter((e) => {
    const ts = new Date(e.created_at).getTime();
    return ts >= start && ts <= end;
  });
  const expenses_total = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  const expenses_by_category: Record<string, number> = {};
  for (const e of expenses) expenses_by_category[e.category] = (expenses_by_category[e.category] || 0) + Number(e.amount || 0);

  const net_profit = gross_profit - expenses_total;
  return {
    gross_sales,
    returns_amount,
    net_sales,
    cogs,
    gross_profit,
    expenses_total,
    expenses_by_category: Object.entries(expenses_by_category).map(([category, amount]) => ({ category, amount })),
    net_profit,
    margin: net_sales > 0 ? (net_profit / net_sales) * 100 : 0,
    transaction_count: sales.length,
  };
}

// ---------- REPORT: TAX SUMMARY ----------
export async function reportTaxSummary(ctx: Ctx): Promise<any> {
  const u = requireUser(ctx);
  const [start, end] = periodRange(ctx.query);
  const txs = await txInRange(u.business_id, start, end);
  const sales = txs.filter((t) => t.transaction_type === "sale");
  const purchases = txs.filter((t) => t.transaction_type === "purchase");

  const tax_out = sales.reduce((s, t) => s + Number(t.tax_amount || 0), 0);
  const tax_in = purchases.reduce((s, t) => s + Number(t.tax_amount || 0), 0);
  const dpp_out = sales.reduce((s, t) => s + Math.max(0, Number(t.total || 0) - Number(t.tax_amount || 0)), 0);
  const dpp_in = purchases.reduce((s, t) => s + Math.max(0, Number(t.total || 0) - Number(t.tax_amount || 0)), 0);

  const details = sales.filter((t) => Number(t.tax_amount || 0) > 0).map((t) => ({
    invoice_no: t.invoice_no,
    created_at: t.created_at,
    customer_name: t.customer_name,
    total: t.total,
    tax_amount: t.tax_amount,
    dpp: Math.max(0, Number(t.total || 0) - Number(t.tax_amount || 0)),
  }));

  return {
    tax_out, tax_in, dpp_out, dpp_in,
    net_tax: tax_out - tax_in,
    sales_count: sales.length,
    purchase_count: purchases.length,
    details,
  };
}

// ---------- CATEGORIES ----------
export async function listCategories(ctx: Ctx): Promise<any> { return listSimple("categories", requireUser(ctx).business_id); }
export async function createCategory(ctx: Ctx): Promise<any> { return upsertSimple("categories", requireUser(ctx).business_id, ctx.body); }
export async function updateCategory(ctx: Ctx): Promise<any> { return upsertSimple("categories", requireUser(ctx).business_id, ctx.body, ctx.params.id); }
export async function deleteCategory(ctx: Ctx): Promise<any> { return deleteSimple("categories", requireUser(ctx).business_id, ctx.params.id); }

// ---------- PAYMENT METHODS ----------
export async function listPaymentMethods(ctx: Ctx): Promise<any> { return listSimple("payment_methods", requireUser(ctx).business_id); }
export async function createPaymentMethod(ctx: Ctx): Promise<any> { return upsertSimple("payment_methods", requireUser(ctx).business_id, ctx.body); }
export async function updatePaymentMethod(ctx: Ctx): Promise<any> { return upsertSimple("payment_methods", requireUser(ctx).business_id, ctx.body, ctx.params.id); }
export async function deletePaymentMethod(ctx: Ctx): Promise<any> { return deleteSimple("payment_methods", requireUser(ctx).business_id, ctx.params.id); }

// ---------- CONTACTS (customers + suppliers) ----------
async function listContacts(businessId: string, kind: "customer" | "supplier", search?: string): Promise<any[]> {
  const base = await fetchListJSON<any>("contacts", businessId, "AND kind = ?", [kind]);
  const term = (search || "").trim().toLowerCase();
  const filtered = term
    ? base.filter((c) => `${c.name ?? ""} ${c.phone ?? ""} ${c.address ?? ""}`.toLowerCase().includes(term))
    : base;

  // Compute transaction_count, total_spent, outstanding, points per contact.
  const db = await getDb();
  const txType = kind === "customer" ? "sale" : "purchase";
  const txRows = await db.getAllAsync<{ json: string }>(
    "SELECT json FROM transactions_t WHERE business_id = ? AND transaction_type = ?",
    [businessId, txType],
  );
  const txs = txRows.map((r) => JSON.parse(r.json)).filter((t) => t.status !== "cancelled");

  return filtered.map((c) => {
    const matchKey = kind === "customer" ? "customer_id" : "supplier_id";
    const related = txs.filter((t) => t[matchKey] === c.id);
    const total_spent = related.reduce((s, t) => s + (t.total || 0), 0);
    const outstanding = related.reduce((s, t) => s + Math.max(0, t.outstanding || 0), 0);
    // Poin: 1 poin tiap Rp 1.000 pembelanjaan (hanya pelanggan).
    const points = kind === "customer" ? Math.floor(total_spent / 1000) : 0;
    return {
      ...c,
      transaction_count: related.length,
      total_spent,
      outstanding,
      points,
    };
  });
}
async function upsertContact(businessId: string, body: any, kind: "customer" | "supplier", id?: string): Promise<any> {
  const db = await getDb();
  const doc = { ...body, id: id || body.id || uuid(), business_id: businessId, kind };
  await db.runAsync("INSERT INTO contacts (id,business_id,kind,json) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET json = excluded.json, kind = excluded.kind", [doc.id, businessId, kind, JSON.stringify(doc)]);
  return doc;
}
export async function getCustomers(ctx: Ctx): Promise<any> { return listContacts(requireUser(ctx).business_id, "customer", ctx.query.search); }
export async function createCustomer(ctx: Ctx): Promise<any> { return upsertContact(requireUser(ctx).business_id, ctx.body, "customer"); }
export async function updateCustomer(ctx: Ctx): Promise<any> { return upsertContact(requireUser(ctx).business_id, ctx.body, "customer", ctx.params.id); }
export async function deleteCustomer(ctx: Ctx): Promise<any> { return deleteSimple("contacts", requireUser(ctx).business_id, ctx.params.id); }
export async function getSuppliers(ctx: Ctx): Promise<any> { return listContacts(requireUser(ctx).business_id, "supplier", ctx.query.search); }
export async function createSupplier(ctx: Ctx): Promise<any> { return upsertContact(requireUser(ctx).business_id, ctx.body, "supplier"); }
export async function updateSupplier(ctx: Ctx): Promise<any> { return upsertContact(requireUser(ctx).business_id, ctx.body, "supplier", ctx.params.id); }
export async function deleteSupplier(ctx: Ctx): Promise<any> { return deleteSimple("contacts", requireUser(ctx).business_id, ctx.params.id); }

// ---------- TRANSACTIONS ----------
async function updateProductStock(businessId: string, productId: string, delta: number): Promise<void> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ json: string }>("SELECT json FROM products WHERE id = ? AND business_id = ?", [productId, businessId]);
  if (!row) return;
  const prod = JSON.parse(row.json);
  if (prod.product_type === "service") return;
  prod.stock = Math.max(0, Number(prod.stock || 0) + delta);
  await db.runAsync("UPDATE products SET json = ?, updated_at = ? WHERE id = ?", [JSON.stringify(prod), nowIso(), productId]);
}

export async function createTransaction(ctx: Ctx): Promise<any> {
  const u = requireUser(ctx);
  const db = await getDb();
  const body = ctx.body || {};
  const type = String(body.transaction_type || "sale");

  // Validate retur
  if (type === "sale_return" || type === "purchase_return") {
    if (body.original_transaction_id) {
      const orig = await db.getFirstAsync<{ json: string }>("SELECT json FROM transactions_t WHERE id = ? AND business_id = ?", [body.original_transaction_id, u.business_id]);
      if (!orig) throw new HttpError(404, "Transaksi asli tidak ditemukan");
      const origDoc = JSON.parse(orig.json);
      if (origDoc.returned) throw new HttpError(400, "Transaksi ini sudah pernah diretur");
      if (origDoc.status === "cancelled") throw new HttpError(400, "Transaksi sudah dibatalkan");
    }
  }

  const items = (body.items ?? []) as any[];
  const subtotal = items.reduce((s, i) => s + (i.price * i.quantity - (i.discount || 0)), 0);
  const discPct = Number(body.discount_percent || 0);
  const discAmt = Number(body.discount_amount || 0);
  const taxPct = Number(body.tax_percent || 0);
  const shipping = Number(body.shipping || 0);
  const afterDisc = Math.max(0, subtotal - discAmt - Math.round(subtotal * discPct / 100));
  const taxAmt = Math.round(afterDisc * taxPct / 100);
  const total = afterDisc + taxAmt + shipping;
  const paid = Number(body.paid_amount || 0);
  // Resolve payment method kind — hanya "credit" yang boleh membuat
  // piutang/hutang. Metode lain (cash/qris/transfer) tidak menambah
  // outstanding meskipun paid < total (short-pay di-anggap selesai).
  const paymentMethodId = String(body.payment_method || "pm_cash");
  const pmRow = await db.getFirstAsync<{ json: string }>(
    "SELECT json FROM payment_methods WHERE id = ? AND business_id = ?",
    [paymentMethodId, u.business_id],
  );
  let paymentKind = "cash";
  if (pmRow) {
    try { paymentKind = JSON.parse(pmRow.json).kind || "cash"; } catch { /* ignore */ }
  } else if (paymentMethodId === "pm_credit" || paymentMethodId === "credit") {
    paymentKind = "credit";
  } else if (paymentMethodId === "pm_qris" || paymentMethodId === "qris_static") {
    paymentKind = "qris_static";
  }
  // Outstanding dihitung berdasarkan kind. Non-credit → selalu 0 (dianggap lunas).
  const outstanding = paymentKind === "credit" ? Math.max(0, total - paid) : 0;

  const now = nowIso();
  const invSerial = await nextCounter(u.business_id, `inv_${type}`);
  const prefix = type === "sale" ? "INV" : type === "purchase" ? "PO" : type === "sale_return" ? "RTS" : "RTP";
  const invoice = `${prefix}-${now.slice(0, 10).replace(/-/g, "")}-${String(invSerial).padStart(4, "0")}`;

  const doc = {
    id: uuid(),
    business_id: u.business_id,
    invoice_no: invoice,
    transaction_type: type,
    payment_method: body.payment_method || "cash",
    payment_method_label: body.payment_method_label || "Tunai",
    payment_method_kind: paymentKind,
    items,
    subtotal,
    global_discount: discAmt + Math.round(subtotal * discPct / 100),
    discount_percent: discPct,
    tax_percent: taxPct,
    tax_amount: taxAmt,
    shipping,
    total,
    paid_amount: paid,
    outstanding,
    customer_name: body.customer_name || "Umum",
    customer_id: body.customer_id || null,
    supplier_id: body.supplier_id || null,
    price_level_id: body.price_level_id || "default",
    shift_id: body.shift_id || null,
    promo_ids: body.promo_ids || [],
    note: body.note || "",
    original_transaction_id: body.original_transaction_id || null,
    created_at: now,
    created_by: u.id,
    created_by_name: u.display_name,
    status: "active",
    returned: false,
  };
  await db.runAsync(
    "INSERT INTO transactions_t (id,business_id,transaction_type,created_at,json) VALUES (?,?,?,?,?)",
    [doc.id, u.business_id, type, now, JSON.stringify(doc)],
  );
  // Stock updates
  for (const it of items) {
    const q = Number(it.quantity) * Number(it.unit_factor || 1);
    if (type === "sale") await updateProductStock(u.business_id, it.product_id, -q);
    else if (type === "purchase") await updateProductStock(u.business_id, it.product_id, q);
    else if (type === "sale_return") await updateProductStock(u.business_id, it.product_id, q);
    else if (type === "purchase_return") await updateProductStock(u.business_id, it.product_id, -q);
  }
  // Mark original as returned
  if ((type === "sale_return" || type === "purchase_return") && body.original_transaction_id) {
    const orig = await db.getFirstAsync<{ json: string }>("SELECT json FROM transactions_t WHERE id = ?", [body.original_transaction_id]);
    if (orig) {
      const origDoc = JSON.parse(orig.json);
      origDoc.returned = true;
      origDoc.returned_at = now;
      origDoc.return_transaction_id = doc.id;
      await db.runAsync("UPDATE transactions_t SET json = ? WHERE id = ?", [JSON.stringify(origDoc), body.original_transaction_id]);
    }
  }
  // Record debt entry if credit sale → outstanding > 0.
  // Metode non-credit tidak boleh menghasilkan piutang (user requirement).
  if (type === "sale" && paymentKind === "credit" && outstanding > 0 && body.customer_id) {
    const debtDoc = {
      id: uuid(), business_id: u.business_id,
      customer_id: body.customer_id, customer_name: doc.customer_name,
      amount: outstanding, remaining: outstanding, paid: 0,
      transaction_id: doc.id, invoice_no: invoice,
      created_at: now, due_date: null, kind: "receivable",
    };
    await db.runAsync("INSERT INTO debts (id,business_id,json) VALUES (?,?,?)", [debtDoc.id, u.business_id, JSON.stringify(debtDoc)]);
  }
  return doc;
}

export async function listTransactions(ctx: Ctx): Promise<any> {
  const u = requireUser(ctx);
  const db = await getDb();
  const kind = ctx.query.kind;
  const limit = Math.min(1000, Number(ctx.query.limit || 100));
  let where = "WHERE business_id = ?";
  const params: any[] = [u.business_id];
  if (kind) {
    const map: Record<string, string> = { sale: "sale", purchase: "purchase", sale_return: "sale_return", purchase_return: "purchase_return" };
    if (map[kind]) { where += " AND transaction_type = ?"; params.push(map[kind]); }
  }
  const rows = await db.getAllAsync<{ json: string }>(
    `SELECT json FROM transactions_t ${where} ORDER BY created_at DESC LIMIT ${limit}`,
    params,
  );
  return rows.map((r) => JSON.parse(r.json));
}

export async function getTransaction(ctx: Ctx): Promise<any> {
  const u = requireUser(ctx);
  const db = await getDb();
  const row = await db.getFirstAsync<{ json: string }>("SELECT json FROM transactions_t WHERE id = ? AND business_id = ?", [ctx.params.id, u.business_id]);
  if (!row) throw new HttpError(404, "Transaksi tidak ditemukan");
  return JSON.parse(row.json);
}

// ---------- PARKED ----------
export async function listParked(ctx: Ctx): Promise<any> { return fetchListJSON("parked", requireUser(ctx).business_id); }
export async function createParked(ctx: Ctx): Promise<any> {
  const u = requireUser(ctx);
  const db = await getDb();
  const doc = { ...(ctx.body || {}), id: uuid(), business_id: u.business_id, created_at: nowIso() };
  await db.runAsync("INSERT INTO parked (id,business_id,json,created_at) VALUES (?,?,?,?)", [doc.id, u.business_id, JSON.stringify(doc), doc.created_at]);
  return doc;
}
export async function deleteParked(ctx: Ctx): Promise<any> { return deleteSimple("parked", requireUser(ctx).business_id, ctx.params.id); }

// ---------- PROMOS ----------
export async function listPromos(ctx: Ctx): Promise<any> { return listSimple("promos", requireUser(ctx).business_id); }
export async function createPromo(ctx: Ctx): Promise<any> { return upsertSimple("promos", requireUser(ctx).business_id, ctx.body); }
export async function updatePromo(ctx: Ctx): Promise<any> { return upsertSimple("promos", requireUser(ctx).business_id, ctx.body, ctx.params.id); }
export async function deletePromo(ctx: Ctx): Promise<any> { return deleteSimple("promos", requireUser(ctx).business_id, ctx.params.id); }

// ---------- CASH ENTRIES ----------
export async function listCashEntries(ctx: Ctx): Promise<any> { return fetchListJSON("cash_entries", requireUser(ctx).business_id); }
export async function createCashEntry(ctx: Ctx): Promise<any> {
  const u = requireUser(ctx);
  const db = await getDb();
  const doc = { ...(ctx.body || {}), id: uuid(), business_id: u.business_id, created_at: nowIso(), created_by_name: u.display_name };
  await db.runAsync("INSERT INTO cash_entries (id,business_id,created_at,json) VALUES (?,?,?,?)", [doc.id, u.business_id, doc.created_at, JSON.stringify(doc)]);
  return doc;
}
export async function deleteCashEntry(ctx: Ctx): Promise<any> {
  const u = requireUser(ctx);
  const db = await getDb();
  await db.runAsync("DELETE FROM cash_entries WHERE id = ? AND business_id = ?", [ctx.params.id, u.business_id]);
  return { ok: true };
}

// ---------- DEBTS ----------
export async function listDebts(ctx: Ctx): Promise<any> {
  const u = requireUser(ctx);
  const kind = ctx.query.kind || "receivable";
  const db = await getDb();
  // Return TransactionDoc[] with outstanding > 0 — matches UI expectation.
  // Only credit payment transactions count as debt (per user requirement).
  const txType = kind === "payable" ? "purchase" : "sale";
  const rows = await db.getAllAsync<{ json: string }>(
    "SELECT json FROM transactions_t WHERE business_id = ? AND transaction_type = ? ORDER BY created_at DESC",
    [u.business_id, txType],
  );
  // Build cache metode utk resolve kind pada data lama tanpa payment_method_kind
  const pms = await fetchListJSON<any>("payment_methods", u.business_id);
  const kindById = new Map<string, string>(pms.map((p: any) => [p.id, p.kind || "cash"]));
  const resolveKind = (t: any): string => {
    if (t.payment_method_kind) return t.payment_method_kind;
    const id = String(t.payment_method || "");
    if (kindById.has(id)) return kindById.get(id)!;
    if (id === "pm_credit" || id === "credit") return "credit";
    return "cash";
  };
  const items = rows.map((r) => JSON.parse(r.json))
    .filter((t) =>
      t.status !== "cancelled" &&
      !t.returned &&
      Number(t.outstanding || 0) > 0 &&
      resolveKind(t) === "credit",
    );
  const total = items.reduce((s, t) => s + Number(t.outstanding || 0), 0);
  return { total, items };
}

/**
 * Pembayaran outstanding transaksi (piutang/hutang).
 * Mengurangi `outstanding` di transaksi, mencatat kas masuk/keluar.
 */
export async function payTransaction(ctx: Ctx): Promise<any> {
  const u = requireUser(ctx);
  const db = await getDb();
  const id = ctx.params.id;
  const row = await db.getFirstAsync<{ json: string }>(
    "SELECT json FROM transactions_t WHERE id = ? AND business_id = ?",
    [id, u.business_id],
  );
  if (!row) throw new HttpError(404, "Transaksi tidak ditemukan");
  const tx = JSON.parse(row.json);
  const body = ctx.body || {};
  const amount = Number(body.amount || 0);
  if (amount <= 0) throw new HttpError(400, "Jumlah bayar tidak valid");
  const outstanding = Math.max(0, Number(tx.outstanding || 0) - amount);
  tx.paid_amount = Number(tx.paid_amount || 0) + amount;
  tx.outstanding = outstanding;
  tx.last_paid_at = nowIso();
  tx.last_payment_method = body.payment_method || "cash";
  await db.runAsync("UPDATE transactions_t SET json = ? WHERE id = ?", [JSON.stringify(tx), id]);

  // Record cash entry when paid via cash
  const method = String(body.payment_method || "cash");
  const isCash = method === "cash" || method === "pm_cash";
  if (isCash) {
    const entry = {
      id: uuid(),
      business_id: u.business_id,
      amount,
      entry_type: tx.transaction_type === "purchase" ? "expense" : "income",
      category: tx.transaction_type === "purchase" ? "Pembayaran Hutang" : "Pembayaran Piutang",
      note: `Pelunasan ${tx.invoice_no}`,
      created_at: nowIso(),
      created_by: u.id,
      created_by_name: u.display_name,
    };
    await db.runAsync(
      "INSERT INTO cash_entries (id,business_id,created_at,json) VALUES (?,?,?,?)",
      [entry.id, u.business_id, entry.created_at, JSON.stringify(entry)],
    );
  }

  // Also sync any linked debt entry
  const dRow = await db.getFirstAsync<{ id: string; json: string }>(
    "SELECT id, json FROM debts WHERE business_id = ?",
    [u.business_id],
  );
  if (dRow) {
    try {
      const d = JSON.parse(dRow.json);
      if (d.transaction_id === id) {
        d.paid = (d.paid || 0) + amount;
        d.remaining = Math.max(0, (d.remaining || d.amount || 0) - amount);
        await db.runAsync("UPDATE debts SET json = ? WHERE id = ?", [JSON.stringify(d), dRow.id]);
      }
    } catch { /* ignore */ }
  }

  return { outstanding, payment_id: uuid() };
}

// ---------- SHIFTS ----------
export async function listShifts(ctx: Ctx): Promise<any> { return fetchListJSON("shifts", requireUser(ctx).business_id); }
export async function activeShift(ctx: Ctx): Promise<any> {
  const u = requireUser(ctx);
  const all = await fetchListJSON<any>("shifts", u.business_id);
  const open = all.find((s) => !s.closed_at);
  // UI mengharap object (bukan null) — kembalikan {} jika tidak ada shift aktif.
  return open || {};
}
export async function getShift(ctx: Ctx): Promise<any> {
  const u = requireUser(ctx);
  const db = await getDb();
  const row = await db.getFirstAsync<{ json: string }>(
    "SELECT json FROM shifts WHERE id = ? AND business_id = ?",
    [ctx.params.id, u.business_id],
  );
  if (!row) throw new HttpError(404, "Shift tidak ditemukan");
  const shift = JSON.parse(row.json);

  // Hitung ringkasan transaksi di dalam window shift
  const start = new Date(shift.opened_at).getTime();
  const end = shift.closed_at ? new Date(shift.closed_at).getTime() : Date.now();
  const txRows = await db.getAllAsync<{ json: string }>(
    "SELECT json FROM transactions_t WHERE business_id = ? AND transaction_type = ? ORDER BY created_at DESC",
    [u.business_id, "sale"],
  );
  const txs = txRows.map((r) => JSON.parse(r.json)).filter((t) => {
    const ts = new Date(t.created_at).getTime();
    return ts >= start && ts <= end && t.status !== "cancelled";
  });
  shift.sales_total = txs.reduce((s, t) => s + (t.total || 0), 0);
  shift.cash_sales = txs.filter((t) => (t.payment_method === "cash" || t.payment_method === "pm_cash")).reduce((s, t) => s + (t.total || 0), 0);
  shift.non_cash_sales = shift.sales_total - shift.cash_sales;
  shift.transaction_count = txs.length;
  const cashRows = await db.getAllAsync<{ json: string }>(
    "SELECT json FROM cash_entries WHERE business_id = ?",
    [u.business_id],
  );
  const cash = cashRows.map((r) => JSON.parse(r.json)).filter((c) => {
    const ts = new Date(c.created_at).getTime();
    return ts >= start && ts <= end;
  });
  shift.cash_in = cash.filter((c) => c.entry_type === "income").reduce((s, c) => s + (c.amount || 0), 0);
  shift.cash_out = cash.filter((c) => c.entry_type === "expense").reduce((s, c) => s + (c.amount || 0), 0);
  shift.expected_cash = Number(shift.opening_cash || 0) + shift.cash_sales + shift.cash_in - shift.cash_out;
  shift.difference = Number(shift.closing_cash || 0) - shift.expected_cash;
  return shift;
}
export async function openShift(ctx: Ctx): Promise<any> {
  const u = requireUser(ctx);
  const db = await getDb();
  const doc = { ...(ctx.body || {}), id: uuid(), business_id: u.business_id, opened_at: nowIso(), closed_at: null, opened_by: u.display_name };
  await db.runAsync("INSERT INTO shifts (id,business_id,json,created_at) VALUES (?,?,?,?)", [doc.id, u.business_id, JSON.stringify(doc), doc.opened_at]);
  return doc;
}
export async function closeShift(ctx: Ctx): Promise<any> {
  const u = requireUser(ctx);
  const db = await getDb();
  const row = await db.getFirstAsync<{ json: string }>("SELECT json FROM shifts WHERE id = ? AND business_id = ?", [ctx.params.id, u.business_id]);
  if (!row) throw new HttpError(404, "Shift tidak ditemukan");
  const doc = JSON.parse(row.json);
  doc.closed_at = nowIso();
  doc.closed_by = u.display_name;
  doc.closing_cash = (ctx.body || {}).closing_cash || 0;
  doc.note = (ctx.body || {}).note || "";
  await db.runAsync("UPDATE shifts SET json = ? WHERE id = ?", [JSON.stringify(doc), ctx.params.id]);
  return doc;
}

// ---------- REPORTS ----------
function parseDate(s?: string): number | null {
  if (!s) return null;
  const d = new Date(s.length === 10 ? `${s}T00:00:00` : s);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

function periodRange(q: Record<string, string>): [number, number] {
  const p = q.period || "daily";
  const now = new Date();
  let start: number;
  let end = Date.now() + 86400000;
  if (p === "custom") {
    start = parseDate(q.start) ?? now.setHours(0, 0, 0, 0);
    const e = parseDate(q.end);
    if (e !== null) end = e + 86400000 - 1;
  } else if (p === "daily") {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  } else if (p === "monthly") {
    start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  } else {
    start = new Date(now.getFullYear(), 0, 1).getTime();
  }
  return [start, end];
}

async function txInRange(businessId: string, start: number, end: number): Promise<any[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ json: string }>(
    "SELECT json FROM transactions_t WHERE business_id = ? ORDER BY created_at DESC",
    [businessId],
  );
  const list = rows.map((r) => JSON.parse(r.json));
  return list.filter((t) => {
    if (t.status === "cancelled") return false;
    const ts = new Date(t.created_at).getTime();
    return ts >= start && ts <= end;
  });
}

export async function reportSummary(ctx: Ctx): Promise<any> {
  const u = requireUser(ctx);
  const db = await getDb();
  const [start, end] = periodRange(ctx.query);
  const period = (ctx.query.period as any) || "daily";
  const txs = await txInRange(u.business_id, start, end);
  const cashEntriesAll = await fetchListJSON<any>("cash_entries", u.business_id);
  const cashEntries = cashEntriesAll.filter((c) => {
    const ts = new Date(c.created_at).getTime();
    return ts >= start && ts <= end;
  });
  const sales = txs.filter((t) => t.transaction_type === "sale");
  const sr = txs.filter((t) => t.transaction_type === "sale_return");
  const purchases = txs.filter((t) => t.transaction_type === "purchase");
  const sales_total = sales.reduce((s, t) => s + (t.total || 0), 0) - sr.reduce((s, t) => s + (t.total || 0), 0);
  const purchase_total = purchases.reduce((s, t) => s + (t.total || 0), 0);
  const gross_profit = sales.reduce((s, t) => s + (t.items || []).reduce((a: number, i: any) => a + (i.price - (i.cost || 0)) * i.quantity - (i.discount || 0), 0), 0);
  const cash_in = sales.filter((t) => t.payment_method === "cash" || t.payment_method === "pm_cash").reduce((s, t) => s + (t.total || 0), 0)
    + cashEntries.filter((c) => c.entry_type === "income").reduce((s, c) => s + (c.amount || 0), 0);
  const cash_out = purchases.filter((t) => t.payment_method === "cash" || t.payment_method === "pm_cash").reduce((s, t) => s + (t.total || 0), 0)
    + cashEntries.filter((c) => c.entry_type === "expense").reduce((s, c) => s + (c.amount || 0), 0);
  // Receivable / payable dihitung dari transaksi aktif (outstanding > 0) dengan
  // payment_method_kind === "credit", agar konsisten dgn layar Piutang/Hutang.
  // Sebelumnya pakai tabel `debts` yang menjadi stale saat transaksi di-pay off.
  const pms = await fetchListJSON<any>("payment_methods", u.business_id);
  const kindById = new Map<string, string>(pms.map((p: any) => [p.id, p.kind || "cash"]));
  const resolveKind = (t: any): string => {
    if (t.payment_method_kind) return t.payment_method_kind;
    const id = String(t.payment_method || "");
    if (kindById.has(id)) return kindById.get(id)!;
    if (id === "pm_credit" || id === "credit") return "credit";
    return "cash";
  };
  const allSales = await db.getAllAsync<{ json: string }>(
    "SELECT json FROM transactions_t WHERE business_id = ? AND transaction_type = 'sale'",
    [u.business_id],
  );
  const allPurchases = await db.getAllAsync<{ json: string }>(
    "SELECT json FROM transactions_t WHERE business_id = ? AND transaction_type = 'purchase'",
    [u.business_id],
  );
  const receivable = allSales
    .map((r) => JSON.parse(r.json))
    .filter((t) => t.status !== "cancelled" && !t.returned && Number(t.outstanding || 0) > 0 && resolveKind(t) === "credit")
    .reduce((s, t) => s + Number(t.outstanding || 0), 0);
  const payable = allPurchases
    .map((r) => JSON.parse(r.json))
    .filter((t) => t.status !== "cancelled" && !t.returned && Number(t.outstanding || 0) > 0 && resolveKind(t) === "credit")
    .reduce((s, t) => s + Number(t.outstanding || 0), 0);
  const products = await fetchListJSON<any>("products", u.business_id);
  const low_stock = products.filter((p) => p.product_type !== "service" && Number(p.stock || 0) <= Number(p.min_stock || 0)).length;
  return {
    period,
    sales_total,
    purchase_total,
    transaction_count: sales.length,
    gross_profit,
    receivable,
    payable,
    low_stock,
    cash_balance: cash_in - cash_out,
    cash_in,
    cash_out,
  };
}

export async function reportProducts(ctx: Ctx): Promise<any> {
  const u = requireUser(ctx);
  const [start, end] = periodRange(ctx.query);
  const txs = (await txInRange(u.business_id, start, end)).filter((t) => t.transaction_type === "sale");
  const bucket = new Map<string, any>();
  for (const t of txs) for (const i of (t.items || [])) {
    const key = i.product_id;
    const b = bucket.get(key) || { product_id: key, name: i.name, quantity: 0, revenue: 0, profit: 0 };
    b.quantity += i.quantity;
    b.revenue += i.price * i.quantity;
    b.profit += (i.price - (i.cost || 0)) * i.quantity - (i.discount || 0);
    bucket.set(key, b);
  }
  return { rows: Array.from(bucket.values()).sort((a, b) => b.profit - a.profit) };
}

export async function reportCustomers(ctx: Ctx): Promise<any> {
  const u = requireUser(ctx);
  const [start, end] = periodRange(ctx.query);
  const txs = (await txInRange(u.business_id, start, end)).filter((t) => t.transaction_type === "sale");
  const bucket = new Map<string, any>();
  for (const t of txs) {
    const key = t.customer_id || `name:${t.customer_name || "Umum"}`;
    const b = bucket.get(key) || { customer_id: t.customer_id || null, customer_name: t.customer_name || "Umum", transaction_count: 0, total_spent: 0, outstanding: 0, profit: 0 };
    b.transaction_count += 1;
    b.total_spent += t.total || 0;
    b.outstanding += t.outstanding || 0;
    for (const i of (t.items || [])) b.profit += (i.price - (i.cost || 0)) * i.quantity - (i.discount || 0);
    bucket.set(key, b);
  }
  return { rows: Array.from(bucket.values()).sort((a, b) => b.total_spent - a.total_spent) };
}

export async function reportOperators(ctx: Ctx): Promise<any> {
  const u = requireUser(ctx);
  const [start, end] = periodRange(ctx.query);
  const txs = (await txInRange(u.business_id, start, end)).filter((t) => t.transaction_type === "sale");
  const bucket = new Map<string, any>();
  for (const t of txs) {
    const key = t.created_by || "-";
    const b = bucket.get(key) || { operator_id: t.created_by || null, name: t.created_by_name || "-", transaction_count: 0, total_sales: 0, profit: 0 };
    b.transaction_count += 1;
    b.total_sales += t.total || 0;
    for (const i of (t.items || [])) b.profit += (i.price - (i.cost || 0)) * i.quantity - (i.discount || 0);
    bucket.set(key, b);
  }
  return { rows: Array.from(bucket.values()).sort((a, b) => b.total_sales - a.total_sales) };
}

export async function reportSalesItems(ctx: Ctx): Promise<any> {
  const u = requireUser(ctx);
  const [start, end] = periodRange(ctx.query);
  const operator = ctx.query.operator_id;
  const product = ctx.query.product_id;
  const txs = (await txInRange(u.business_id, start, end)).filter((t) => t.transaction_type === "sale");
  const rows: any[] = [];
  for (const t of txs) {
    if (operator && t.created_by !== operator) continue;
    for (const i of (t.items || [])) {
      if (product && i.product_id !== product) continue;
      rows.push({
        transaction_id: t.id, invoice_no: t.invoice_no, created_at: t.created_at,
        customer_name: t.customer_name, operator_name: t.created_by_name,
        product_id: i.product_id, name: i.name, unit: i.unit || "",
        quantity: i.quantity, price: i.price, subtotal: i.price * i.quantity - (i.discount || 0),
      });
    }
  }
  return { rows };
}

// ---------- OPERATORS (users within business) ----------
export async function listOperators(ctx: Ctx): Promise<any> {
  const u = requireUser(ctx);
  const db = await getDb();
  const rows = await db.getAllAsync<any>("SELECT id, username, display_name, role, permissions FROM users WHERE business_id = ?", [u.business_id]);
  return rows.map((r) => ({ ...r, permissions: JSON.parse(r.permissions || "[]") }));
}
export async function createOperator(ctx: Ctx): Promise<any> {
  const u = requireUser(ctx);
  const db = await getDb();
  const body = ctx.body || {};
  if (!body.username || !body.password) throw new HttpError(400, "Isi username & password");
  const existing = await db.getFirstAsync("SELECT id FROM users WHERE username = ?", [body.username]);
  if (existing) throw new HttpError(400, "Username sudah dipakai");
  const { hash, salt } = await hashPassword(String(body.password));
  const doc = {
    id: uuid(), business_id: u.business_id, business_name: u.business_name,
    username: body.username, display_name: body.display_name || body.username,
    password_hash: hash, password_salt: salt,
    role: body.role || "cashier", permissions: JSON.stringify(body.permissions || ["sales"]),
    created_at: nowIso(),
  };
  await db.runAsync("INSERT INTO users (id,business_id,business_name,username,display_name,password_hash,password_salt,role,permissions,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [doc.id, doc.business_id, doc.business_name, doc.username, doc.display_name, doc.password_hash, doc.password_salt, doc.role, doc.permissions, doc.created_at]);
  return { ...doc, permissions: JSON.parse(doc.permissions) };
}
export async function updateOperator(ctx: Ctx): Promise<any> {
  const u = requireUser(ctx);
  const db = await getDb();
  const body = ctx.body || {};
  const id = ctx.params.id;
  const existing = await db.getFirstAsync<any>("SELECT * FROM users WHERE id = ? AND business_id = ?", [id, u.business_id]);
  if (!existing) throw new HttpError(404, "Operator tidak ditemukan");
  let hash = existing.password_hash; let salt = existing.password_salt;
  if (body.password) { const r = await hashPassword(String(body.password)); hash = r.hash; salt = r.salt; }
  const display_name = body.display_name || existing.display_name;
  const role = body.role || existing.role;
  const permissions = JSON.stringify(body.permissions || JSON.parse(existing.permissions || "[]"));
  await db.runAsync("UPDATE users SET display_name=?, role=?, permissions=?, password_hash=?, password_salt=? WHERE id = ?",
    [display_name, role, permissions, hash, salt, id]);
  return { id, display_name, role, permissions: JSON.parse(permissions) };
}
export async function deleteOperator(ctx: Ctx): Promise<any> {
  const u = requireUser(ctx);
  if (ctx.params.id === u.id) throw new HttpError(400, "Tidak bisa hapus akun sendiri");
  const db = await getDb();
  await db.runAsync("DELETE FROM users WHERE id = ? AND business_id = ?", [ctx.params.id, u.business_id]);
  return { ok: true };
}

// ---------- AUDIT LOGS ----------
export async function listAuditLogs(ctx: Ctx): Promise<any> {
  const u = requireUser(ctx);
  const db = await getDb();
  const rows = await db.getAllAsync<{ json: string }>("SELECT json FROM audit_logs WHERE business_id = ? ORDER BY created_at DESC LIMIT 500", [u.business_id]);
  return rows.map((r) => JSON.parse(r.json));
}
export async function appendAudit(businessId: string, user: UserRow, action: string, target: string, details: any = {}): Promise<void> {
  const db = await getDb();
  const doc = { id: uuid(), business_id: businessId, action, target, details, created_at: nowIso(), created_by: user.id, created_by_name: user.display_name };
  await db.runAsync("INSERT INTO audit_logs (id,business_id,created_at,json) VALUES (?,?,?,?)", [doc.id, businessId, doc.created_at, JSON.stringify(doc)]);
}

// ---------- ADMIN ----------
export async function resetTransactions(ctx: Ctx): Promise<any> {
  const u = requireUser(ctx);
  const db = await getDb();
  const row = await db.getFirstAsync<any>("SELECT password_hash, password_salt FROM users WHERE id = ?", [u.id]);
  const pw = (ctx.body || {}).password;
  if (!pw || !row || !(await verifyPassword(pw, row.password_hash, row.password_salt))) throw new HttpError(401, "Password salah");

  // Hitung jumlah sebelum dihapus (untuk ditampilkan di UI).
  const count = async (table: string): Promise<number> => {
    const r = await db.getFirstAsync<{ c: number }>(`SELECT COUNT(*) as c FROM ${table} WHERE business_id = ?`, [u.business_id]);
    return r?.c ?? 0;
  };
  const deleted = {
    transactions: await count("transactions_t"),
    parked: await count("parked"),
    cashflow: await count("cash_entries"),
    shifts: await count("shifts"),
    debts: await count("debts"),
    stock_adjustments: await count("stock_adjustments"),
    expenses: await count("expenses"),
  };

  // Hitung total produk sebelum di-reset stok.
  const productCount = await count("products");

  await db.runAsync("DELETE FROM transactions_t WHERE business_id = ?", [u.business_id]);
  await db.runAsync("DELETE FROM cash_entries WHERE business_id = ?", [u.business_id]);
  await db.runAsync("DELETE FROM debts WHERE business_id = ?", [u.business_id]);
  await db.runAsync("DELETE FROM parked WHERE business_id = ?", [u.business_id]);
  await db.runAsync("DELETE FROM shifts WHERE business_id = ?", [u.business_id]);
  await db.runAsync("DELETE FROM stock_adjustments WHERE business_id = ?", [u.business_id]);
  await db.runAsync("DELETE FROM expenses WHERE business_id = ?", [u.business_id]);

  // Reset stok semua produk ke 0 (produk tidak dihapus, cuma stoknya).
  const products = await db.getAllAsync<{ id: string; json: string }>("SELECT id, json FROM products WHERE business_id = ?", [u.business_id]);
  for (const p of products) {
    try {
      const doc = JSON.parse(p.json);
      doc.stock = 0;
      doc.updated_at = nowIso();
      await db.runAsync("UPDATE products SET json = ?, updated_at = ? WHERE id = ?", [JSON.stringify(doc), doc.updated_at, p.id]);
    } catch { /* skip jika json rusak */ }
  }

  // Reset counter nomor invoice supaya mulai dari 1 lagi.
  await db.runAsync("DELETE FROM counters WHERE business_id = ?", [u.business_id]);

  await appendAudit(u.business_id, u, "reset", "transactions", { deleted, products_stock_reset: productCount });
  return { ok: true, deleted, products_stock_reset: productCount };
}
export async function deleteAllProducts(ctx: Ctx): Promise<any> {
  const u = requireUser(ctx);
  const db = await getDb();
  const row = await db.getFirstAsync<any>("SELECT password_hash, password_salt FROM users WHERE id = ?", [u.id]);
  const pw = (ctx.body || {}).password;
  if (!pw || !row || !(await verifyPassword(pw, row.password_hash, row.password_salt))) throw new HttpError(401, "Password salah");
  const cRow = await db.getFirstAsync<{ c: number }>("SELECT COUNT(*) as c FROM products WHERE business_id = ?", [u.business_id]);
  const deleted = cRow?.c ?? 0;
  await db.runAsync("DELETE FROM products WHERE business_id = ?", [u.business_id]);
  await db.runAsync("DELETE FROM stock_adjustments WHERE business_id = ?", [u.business_id]);
  await appendAudit(u.business_id, u, "delete-all", "products", { deleted });
  return { ok: true, deleted };
}

// ---------- EMERGENCY PROFILE UPDATE ----------
/**
 * Reset profil pemilik tanpa butuh password lama. Dipanggil setelah user
 * memasukkan password darurat di layar login (validasinya di sisi frontend
 * karena hanya pemilik perangkat yang punya akses fisik).
 *
 * Hanya boleh dipanggil untuk akun owner (role=owner) milik user yang login.
 */
export async function emergencyProfileHandler(ctx: Ctx): Promise<any> {
  if (!ctx.user) throw new HttpError(401, "Sesi tidak valid");
  if (ctx.user.role !== "owner") throw new HttpError(403, "Mode darurat hanya untuk akun pemilik");
  const { new_password, display_name, username } = ctx.body || {};
  const db = await getDb();
  if (new_password) {
    if (String(new_password).length < 6) throw new HttpError(400, "Password baru minimal 6 karakter");
    const { hash, salt } = await hashPassword(String(new_password));
    await db.runAsync("UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?", [hash, salt, ctx.user.id]);
  }
  if (display_name) {
    await db.runAsync("UPDATE users SET display_name = ? WHERE id = ?", [String(display_name), ctx.user.id]);
  }
  if (username) {
    const existing = await db.getFirstAsync<any>("SELECT id FROM users WHERE username = ? AND id != ?", [String(username), ctx.user.id]);
    if (existing) throw new HttpError(400, "Username sudah dipakai");
    await db.runAsync("UPDATE users SET username = ? WHERE id = ?", [String(username), ctx.user.id]);
  }
  return meFromUserId(ctx.user.id);
}

// ---------- RESTORE from backup JSON ----------
/**
 * Memulihkan seluruh data dari file backup JSON (hasil `/backup`).
 * Semua tabel di-replace untuk business user saat ini.
 */
export async function restoreHandler(ctx: Ctx): Promise<any> {
  const u = requireUser(ctx);
  const payload = ctx.body || {};
  const db = await getDb();
  const bid = u.business_id;

  const restored: Record<string, number> = {};

  async function replaceTable(table: string, items: any[], hasCreated: boolean) {
    await db.runAsync(`DELETE FROM ${table} WHERE business_id = ?`, [bid]);
    for (const raw of items || []) {
      const doc = { ...raw, business_id: bid };
      const id = String(doc.id || uuid());
      doc.id = id;
      if (hasCreated) {
        const createdAt = String(doc.created_at || nowIso());
        if (table === "transactions_t") {
          await db.runAsync(
            `INSERT INTO ${table} (id,business_id,transaction_type,created_at,json) VALUES (?,?,?,?,?)`,
            [id, bid, String(doc.transaction_type || "sale"), createdAt, JSON.stringify(doc)],
          );
        } else {
          await db.runAsync(
            `INSERT INTO ${table} (id,business_id,created_at,json) VALUES (?,?,?,?)`,
            [id, bid, createdAt, JSON.stringify(doc)],
          );
        }
      } else if (table === "products") {
        const now = nowIso();
        await db.runAsync(
          `INSERT INTO products (id,business_id,json,created_at,updated_at) VALUES (?,?,?,?,?)`,
          [id, bid, JSON.stringify(doc), String(doc.created_at || now), String(doc.updated_at || now)],
        );
      } else if (table === "contacts") {
        await db.runAsync(
          `INSERT INTO contacts (id,business_id,kind,json) VALUES (?,?,?,?)`,
          [id, bid, String(doc.kind || "customer"), JSON.stringify(doc)],
        );
      } else {
        await db.runAsync(
          `INSERT INTO ${table} (id,business_id,json) VALUES (?,?,?)`,
          [id, bid, JSON.stringify(doc)],
        );
      }
    }
    restored[table] = (items || []).length;
  }

  if (payload.settings) {
    await saveSettings(bid, { ...payload.settings, business_id: bid });
    restored.settings = 1;
  }
  await replaceTable("products", payload.products || [], false);
  await replaceTable("categories", payload.categories || [], false);
  await replaceTable("payment_methods", payload.payment_methods || [], false);
  await replaceTable("contacts", payload.contacts || [], false);
  await replaceTable("transactions_t", payload.transactions || [], true);
  await replaceTable("cash_entries", payload.cash_entries || [], true);
  await replaceTable("debts", payload.debts || [], false);
  await replaceTable("parked", payload.parked || [], true);
  await replaceTable("shifts", payload.shifts || [], true);
  await replaceTable("promos", payload.promos || [], false);

  await appendAudit(bid, u, "restore", "backup", { restored });
  return { restored };
}

// ---------- INTEGRATIONS/STATUS ----------
export async function integrationsStatus(_ctx: Ctx): Promise<any> {
  return {
    bluetooth_printing: { configured: true, label: "Printer Bluetooth / ESC-POS", note: "Scan & pair printer di menu Lainnya → Printer Bluetooth" },
    offline_mode: { configured: true, label: "Mode Offline", note: "Semua data tersimpan di perangkat" },
    qris: { configured: false, label: "QRIS Statis", note: "Upload gambar QRIS di Pengaturan" },
    whatsapp: { configured: false, label: "WhatsApp", note: "Opsional — kirim struk via WA" },
  };
}

// ---------- BACKUP ----------
export async function backup(ctx: Ctx): Promise<any> {
  const u = requireUser(ctx);
  const db = await getDb();
  async function dump(table: string): Promise<any[]> {
    const rows = await db.getAllAsync<{ json: string }>(
      `SELECT json FROM ${table} WHERE business_id = ?`,
      [u.business_id],
    );
    return rows.map((r) => JSON.parse(r.json));
  }
  return {
    version: 1,
    exported_at: nowIso(),
    business_id: u.business_id,
    business_name: u.business_name,
    settings: await loadSettings(u.business_id),
    products: await dump("products"),
    categories: await dump("categories"),
    payment_methods: await dump("payment_methods"),
    contacts: await dump("contacts"),
    transactions: await dump("transactions_t"),
    cash_entries: await dump("cash_entries"),
    debts: await dump("debts"),
    parked: await dump("parked"),
    shifts: await dump("shifts"),
    promos: await dump("promos"),
  };
}

// ---------- LOGO ESC/POS (fallback: empty) ----------
export async function logoEscpos(_ctx: Ctx): Promise<any> {
  // TODO: implement image → ESC/POS raster in JS. For now return empty so
  // caller skips logo printing. Users still get receipt text normally.
  return { bytes_base64: "", width: 0, height: 0, note: "Logo offline belum didukung — upgrade di sesi berikutnya." };
}

// ---------- SYNC (no-op, offline) ----------
export async function syncNoop(_ctx: Ctx): Promise<any> {
  return { ok: true, offline: true };
}
