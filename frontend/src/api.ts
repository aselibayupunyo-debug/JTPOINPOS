import Constants from "expo-constants";
import { storage } from "@/src/utils/storage";

const baseUrl = String(
  Constants.expoConfig?.extra?.backendUrl ?? process.env.EXPO_PUBLIC_BACKEND_URL ?? "",
).replace(/\/$/, "");

export const TOKEN_KEY = "kasirku_auth_token";

export type User = {
  id: string;
  business_id: string;
  business_name: string;
  name: string;
  username: string;
  role: string;
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
  image_base64?: string | null;
};

export type CartItem = Product & { quantity: number };

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await storage.secureGet<string | null>(TOKEN_KEY, null);
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
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

export async function register(input: { business_name: string; owner_name: string; username: string; password: string }) {
  return apiRequest<{ token: string; user: User }>("/auth/register", {
    method: "POST",
    body: JSON.stringify(input),
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