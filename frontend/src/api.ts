import Constants from "expo-constants";
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

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await storage.secureGet<string | null>(TOKEN_KEY, null);
  const headers = new Headers(options.headers);
  if (!(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${baseUrl}/api${path}`, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.detail ?? "Terjadi kesalahan koneksi");
  return body as T;
}

export async function login(username: string, password: string) {
  return apiRequest<{ token: string; user: User }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export async function register(payload: { business_name: string; owner_name: string; username: string; password: string }) {
  return apiRequest<{ token: string; user: User }>("/auth/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function saveToken(token: string) {
  return storage.secureSet(TOKEN_KEY, token);
}

export async function clearToken() {
  return storage.secureRemove(TOKEN_KEY);
}

export async function uploadProducts(file: { uri: string; name: string; mimeType?: string | null }) {
  const token = await storage.secureGet<string | null>(TOKEN_KEY, null);
  const form = new FormData();
  form.append("file", { uri: file.uri, name: file.name, type: file.mimeType ?? "application/octet-stream" } as unknown as Blob);
  const response = await fetch(`${baseUrl}/api/products/import`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
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
