/**
 * HTTP client untuk mode "Kasir Terhubung" (client).
 *
 * Memakai `fetch()` standar untuk request ke Server Utama (HP lain di
 * jaringan LAN yang sama atau terhubung via Tailscale/ZeroTier).
 *
 * Signature kompatibel dengan `localFetch` di `local-backend/index.ts`,
 * sehingga `apiRequest` di `src/api.ts` bisa langsung route ke sini.
 */
import type { LocalResponse } from "@/src/local-backend";
import { getLanConfig } from "./device-mode";

export class LanOfflineError extends Error {
  constructor(message = "Server Utama tidak dapat dijangkau. Pastikan HP server menyala & jaringan sama.") {
    super(message);
    this.name = "LanOfflineError";
  }
}

type Method = "GET" | "POST" | "PUT" | "DELETE";

/** Timeout default agar UI tidak hang kalau Server tidak respond.
 *  Dipanjang (30s) untuk mengakomodasi payload besar seperti list produk
 *  dengan gambar base64 di jaringan Wi-Fi lambat atau Tailscale. */
const REQUEST_TIMEOUT_MS = 30_000;

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Satu endpoint saja untuk client → server. Pastikan `path` tanpa prefix
 * `/api` (konsisten dengan localFetch). Prefix `/api` ditambahkan di sini.
 */
export async function remoteFetch(args: {
  method: Method;
  path: string;
  body: any;
  token: string | null;
}): Promise<LocalResponse> {
  const cfg = await getLanConfig();
  const host = cfg.server_host.trim();
  const port = cfg.server_port || 8787;
  if (!host) {
    throw new LanOfflineError("Alamat Server Utama belum diatur. Buka Pengaturan → Sinkronisasi Jaringan.");
  }

  const url = `http://${host}:${port}/api${args.path.startsWith("/") ? args.path : "/" + args.path}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (args.token) headers["Authorization"] = `Bearer ${args.token}`;

  let res: Response;
  try {
    res = await fetchWithTimeout(url, {
      method: args.method,
      headers,
      body: args.body === null || args.body === undefined ? undefined : JSON.stringify(args.body),
    }, REQUEST_TIMEOUT_MS);
  } catch (e) {
    throw new LanOfflineError(e instanceof Error ? e.message : String(e));
  }

  let data: any = null;
  try {
    const text = await res.text();
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  return { status: res.status, data };
}

/**
 * Health-check cepat: `GET http://host:port/health` dengan timeout ketat.
 * Dipakai layar settings & boot splash untuk cek apakah Server hidup.
 */
export async function pingLanSyncServer(host: string, port: number, timeoutMs = 3500): Promise<{ ok: boolean; service?: string; error?: string }> {
  if (!host.trim()) return { ok: false, error: "Host kosong" };
  try {
    const res = await fetchWithTimeout(`http://${host.trim()}:${port}/health`, { method: "GET" }, timeoutMs);
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    return { ok: true, service: data?.service };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
