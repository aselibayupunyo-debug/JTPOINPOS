/**
 * Device mode storage untuk LAN sync.
 *
 * JTPOIN POS mendukung 3 mode:
 * - "mandiri": database lokal sendiri (default, offline penuh)
 * - "server": HP ini jadi pusat data, menerima koneksi HP lain via HTTP
 *             di port 8787. Database tetap di SQLite lokal.
 * - "client": HP ini thin-client, semua API call diteruskan ke Server
 *             via HTTP. Jika Server offline → transaksi ditolak.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

export type DeviceMode = "mandiri" | "server" | "client";

const KEY = "jtpoin_lan_sync_config_v1";
export const LAN_SYNC_PORT = 8787;
export const LAN_SYNC_SERVICE_TYPE = "jtpoin";

export type LanConfig = {
  mode: DeviceMode;
  /** Server IP yang dipakai saat mode = "client". Contoh: "192.168.1.5" atau "100.64.1.3" (Tailscale). */
  server_host: string;
  /** Port TCP server (default 8787). */
  server_port: number;
  /** Nama device untuk advertisement mDNS (hanya di mode server). */
  device_name: string;
};

const DEFAULT_CONFIG: LanConfig = {
  mode: "mandiri",
  server_host: "",
  server_port: LAN_SYNC_PORT,
  device_name: "JTPOIN Server",
};

let cached: LanConfig | null = null;

export async function getLanConfig(): Promise<LanConfig> {
  if (cached) return cached;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) {
      cached = { ...DEFAULT_CONFIG };
      return cached;
    }
    const parsed = JSON.parse(raw) as Partial<LanConfig>;
    cached = { ...DEFAULT_CONFIG, ...parsed };
    return cached;
  } catch {
    cached = { ...DEFAULT_CONFIG };
    return cached;
  }
}

export async function setLanConfig(patch: Partial<LanConfig>): Promise<LanConfig> {
  const current = await getLanConfig();
  const next: LanConfig = { ...current, ...patch };
  cached = next;
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

/** Reset cache (dipanggil kalau user re-login agar mode terbaru dipakai). */
export function invalidateLanConfigCache(): void {
  cached = null;
}
