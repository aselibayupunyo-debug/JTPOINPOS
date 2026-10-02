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
  if (!username || !password) throw new HttpError(400, "Isi username & password");
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
async function listContacts(businessId: string, kind: "customer" | "supplier"): Promise<any[]> {
  return fetchListJSON("contacts", businessId, "AND kind = ?", [kind]);
}
async function upsertContact(businessId: string, body: any, kind: "customer" | "supplier", id?: string): Promise<any> {
  const db = await getDb();
  const doc = { ...body, id: id || body.id || uuid(), business_id: businessId, kind };
  await db.runAsync("INSERT INTO contacts (id,business_id,kind,json) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET json = excluded.json, kind = excluded.kind", [doc.id, businessId, kind, JSON.stringify(doc)]);
  return doc;
}
export async function getCustomers(ctx: Ctx): Promise<any> { return listContacts(requireUser(ctx).business_id, "customer"); }
export async function createCustomer(ctx: Ctx): Promise<any> { return upsertContact(requireUser(ctx).business_id, ctx.body, "customer"); }
export async function updateCustomer(ctx: Ctx): Promise<any> { return upsertContact(requireUser(ctx).business_id, ctx.body, "customer", ctx.params.id); }
export async function deleteCustomer(ctx: Ctx): Promise<any> { return deleteSimple("contacts", requireUser(ctx).business_id, ctx.params.id); }
export async function getSuppliers(ctx: Ctx): Promise<any> { return listContacts(requireUser(ctx).business_id, "supplier"); }
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
    if (!body.admin_password) throw new HttpError(400, "Retur transaksi butuh password");
    const row = await db.getFirstAsync<any>("SELECT password_hash, password_salt FROM users WHERE id = ?", [u.id]);
    if (!row || !(await verifyPassword(String(body.admin_password), row.password_hash, row.password_salt))) {
      throw new HttpError(401, "Password admin salah");
    }
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
  const outstanding = Math.max(0, total - paid);

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
  // Record debt entry if outstanding > 0 for sale
  if (type === "sale" && outstanding > 0 && body.customer_id) {
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
  const txType = kind === "payable" ? "purchase" : "sale";
  const rows = await db.getAllAsync<{ json: string }>(
    "SELECT json FROM transactions_t WHERE business_id = ? AND transaction_type = ? ORDER BY created_at DESC",
    [u.business_id, txType],
  );
  const items = rows.map((r) => JSON.parse(r.json))
    .filter((t) => t.status !== "cancelled" && !t.returned && Number(t.outstanding || 0) > 0);
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
  const debts = await fetchListJSON<any>("debts", u.business_id);
  const receivable = debts.filter((d) => (d.kind || "receivable") === "receivable").reduce((s, d) => s + (d.remaining || 0), 0);
  const payable = debts.filter((d) => d.kind === "payable").reduce((s, d) => s + (d.remaining || 0), 0);
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
  await db.runAsync("DELETE FROM transactions_t WHERE business_id = ?", [u.business_id]);
  await db.runAsync("DELETE FROM cash_entries WHERE business_id = ?", [u.business_id]);
  await db.runAsync("DELETE FROM debts WHERE business_id = ?", [u.business_id]);
  await db.runAsync("DELETE FROM parked WHERE business_id = ?", [u.business_id]);
  await db.runAsync("DELETE FROM shifts WHERE business_id = ?", [u.business_id]);
  await appendAudit(u.business_id, u, "reset", "transactions", {});
  return { ok: true };
}
export async function deleteAllProducts(ctx: Ctx): Promise<any> {
  const u = requireUser(ctx);
  const db = await getDb();
  const row = await db.getFirstAsync<any>("SELECT password_hash, password_salt FROM users WHERE id = ?", [u.id]);
  const pw = (ctx.body || {}).password;
  if (!pw || !row || !(await verifyPassword(pw, row.password_hash, row.password_salt))) throw new HttpError(401, "Password salah");
  await db.runAsync("DELETE FROM products WHERE business_id = ?", [u.business_id]);
  await appendAudit(u.business_id, u, "delete-all", "products", {});
  return { ok: true };
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
