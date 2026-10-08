/**
 * Discovery via mDNS/Bonjour untuk LAN sync.
 *
 * - Mode server: publish service "jtpoin" di port 8787
 * - Mode client: scan service "jtpoin" di LAN, dapat daftar HP server
 *
 * Expo-zeroconf butuh native build. Di web/Expo Go, modul tidak tersedia
 * → semua function fallback aman (empty result / silent fail).
 */
import { LAN_SYNC_SERVICE_TYPE } from "./device-mode";

type Zeroconf = typeof import("expo-zeroconf");

let mod: Zeroconf | null = null;
function getModule(): Zeroconf | null {
  if (mod) return mod;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require("expo-zeroconf");
    if (mod && mod.isAvailable) return mod;
    return null;
  } catch {
    return null;
  }
}

export type DiscoveredServer = {
  name: string;
  host: string;
  port: number;
};

let publishedHandle: { unpublish: () => void } | null = null;

/** Publish mDNS service (dipanggil dari mode server). Idempotent. */
export async function publishLanService(name: string, port: number): Promise<void> {
  const z = getModule();
  if (!z) return;
  if (publishedHandle) {
    try { publishedHandle.unpublish(); } catch { /* noop */ }
    publishedHandle = null;
  }
  try {
    const handle = await z.publishService({
      name: name || "JTPOIN Server",
      type: LAN_SYNC_SERVICE_TYPE,
      protocol: "tcp",
      port,
      txt: { app: "jtpoin-pos", version: "1" },
    });
    publishedHandle = handle;
  } catch {
    publishedHandle = null;
  }
}

export function unpublishLanService(): void {
  if (!publishedHandle) return;
  try { publishedHandle.unpublish(); } catch { /* noop */ }
  publishedHandle = null;
}

/** Scan LAN selama `timeoutMs` ms, kembalikan daftar server JTPOIN yang resolve. */
export async function scanLanServers(timeoutMs = 4000): Promise<DiscoveredServer[]> {
  const z = getModule();
  if (!z) return [];
  try {
    const list = await z.scan(LAN_SYNC_SERVICE_TYPE, { protocol: "tcp", timeoutMs, autoResolve: true });
    const results: DiscoveredServer[] = [];
    for (const svc of list) {
      const addresses = svc.addresses || [];
      // Prefer IPv4 untuk kompatibilitas HTTP di Android
      const ipv4 = addresses.find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a));
      const host = ipv4 || addresses[0] || svc.host || "";
      if (!host) continue;
      results.push({ name: svc.name, host, port: svc.port || 8787 });
    }
    return results;
  } catch {
    return [];
  }
}

export function isDiscoveryAvailable(): boolean {
  return getModule() !== null;
}
