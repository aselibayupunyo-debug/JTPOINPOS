/**
 * Hook reaktif untuk LAN sync mode & kesehatan koneksi.
 *
 * - Mode "mandiri": tidak ada polling, hanya return mode.
 * - Mode "server":  cek `getLanSyncServerStatus()` tiap beberapa detik.
 * - Mode "client":  ping `/health` ke Server Utama setiap 10 detik.
 *
 * Mengembalikan state yang reaktif supaya badge di header dapat
 * memperlihatkan status langsung tanpa perlu refresh manual.
 */
import { useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";

import { getLanConfig, type DeviceMode, type LanConfig } from "./device-mode";
import { pingLanSyncServer } from "./http-client";
import { getLanSyncServerStatus } from "./http-server";

export type LanConnectivity = "idle" | "checking" | "online" | "offline";

export type LanModeState = {
  mode: DeviceMode;
  connectivity: LanConnectivity;
  serverHost: string;
  serverPort: number;
  deviceName: string;
  /** Waktu ping terakhir (ms since epoch) untuk mode client. */
  lastCheckAt: number | null;
};

const PING_INTERVAL_MS = 10_000;
const SERVER_INTERVAL_MS = 15_000;

const DEFAULT_STATE: LanModeState = {
  mode: "mandiri",
  connectivity: "idle",
  serverHost: "",
  serverPort: 8787,
  deviceName: "",
  lastCheckAt: null,
};

export function useLanMode(): LanModeState {
  const [state, setState] = useState<LanModeState>(DEFAULT_STATE);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cfgRef = useRef<LanConfig | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    let appStateSub: ReturnType<typeof AppState.addEventListener> | null = null;

    const clearTimer = () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };

    const runCheck = async () => {
      const cfg = cfgRef.current;
      if (!cfg) return;
      if (cfg.mode === "mandiri") {
        if (!mountedRef.current) return;
        setState((s) => ({ ...s, connectivity: "idle", lastCheckAt: Date.now() }));
        return;
      }
      if (cfg.mode === "server") {
        const status = getLanSyncServerStatus();
        if (!mountedRef.current) return;
        setState((s) => ({ ...s, connectivity: status.running ? "online" : "offline", lastCheckAt: Date.now() }));
        return;
      }
      // client
      if (!cfg.server_host.trim()) {
        if (!mountedRef.current) return;
        setState((s) => ({ ...s, connectivity: "offline", lastCheckAt: Date.now() }));
        return;
      }
      if (!mountedRef.current) return;
      setState((s) => ({ ...s, connectivity: "checking" }));
      const res = await pingLanSyncServer(cfg.server_host, cfg.server_port, 3500);
      if (!mountedRef.current) return;
      setState((s) => ({
        ...s,
        connectivity: res.ok ? "online" : "offline",
        lastCheckAt: Date.now(),
      }));
    };

    const applyConfig = async () => {
      const cfg = await getLanConfig();
      cfgRef.current = cfg;
      if (!mountedRef.current) return;
      setState({
        mode: cfg.mode,
        connectivity: cfg.mode === "mandiri" ? "idle" : "checking",
        serverHost: cfg.server_host,
        serverPort: cfg.server_port,
        deviceName: cfg.device_name,
        lastCheckAt: null,
      });
      clearTimer();
      // Jalankan immediate check lalu set interval sesuai mode
      runCheck();
      if (cfg.mode !== "mandiri") {
        timerRef.current = setInterval(runCheck, cfg.mode === "client" ? PING_INTERVAL_MS : SERVER_INTERVAL_MS);
      }
    };

    applyConfig();

    // Re-poll config saat app jadi aktif (user mungkin ganti mode di settings)
    appStateSub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next === "active") {
        applyConfig();
      }
    });

    return () => {
      mountedRef.current = false;
      clearTimer();
      try { appStateSub?.remove(); } catch { /* noop */ }
    };
  }, []);

  return state;
}
