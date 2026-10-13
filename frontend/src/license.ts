/**
 * Lisensi JTPOIN POS — Mode Demo 3 hari + Aktivasi permanen (100% offline).
 *
 * - ID Perangkat: diturunkan dari Android ID (stabil per HP) → "XXXX-XXXX".
 * - Kode Aktivasi: SHA-256(ID Perangkat + SECRET) → "XXXX-XXXX-XXXX".
 *   Kode satu HP tidak berlaku di HP lain.
 * - Setelah demo habis & belum aktif: data tetap bisa DILIHAT, tetapi semua
 *   operasi tulis (transaksi baru, edit data) diblokir di `apiRequest`.
 */
import * as Application from "expo-application";
import * as Crypto from "expo-crypto";
import { useCallback, useEffect, useState } from "react";
import { Platform } from "react-native";

import { storage } from "@/src/utils/storage";

export const TRIAL_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const LICENSE_SECRET = "JTPOIN#POS@2026!lisensi-offline";
/** Password master untuk membuka Generator Kode (khusus pemilik aplikasi). */
export const MASTER_PASSWORD = "bayu270386";

const K_TRIAL_START = "jtpoin_trial_start_v1";
const K_LAST_SEEN = "jtpoin_trial_last_seen_v1";
const K_ACTIVATION = "jtpoin_activation_code_v1";
const K_FALLBACK_ID = "jtpoin_device_seed_v1";

export type LicenseStatus = {
  deviceId: string;
  activated: boolean;
  expired: boolean;
  daysLeft: number;
  tampered: boolean;
  trialEndsAt: number;
};

let cached: LicenseStatus | null = null;
const listeners = new Set<(s: LicenseStatus) => void>();

async function sha256Hex(input: string) {
  return (await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, input)).toUpperCase();
}

function group(hex: string, parts: number) {
  const out: string[] = [];
  for (let i = 0; i < parts; i++) out.push(hex.slice(i * 4, i * 4 + 4));
  return out.join("-");
}

export function normalizeCode(code: string) {
  return code.toUpperCase().replace(/[^0-9A-F]/g, "");
}

async function deviceSeed(): Promise<string> {
  if (Platform.OS === "android") {
    try {
      const id = Application.getAndroidId();
      if (id) return `android:${id}`;
    } catch { /* fallback */ }
  }
  let seed = await storage.secureGet<string | null>(K_FALLBACK_ID, null);
  if (!seed) {
    seed = `rand:${Crypto.randomUUID()}`;
    await storage.secureSet(K_FALLBACK_ID, seed);
  }
  return seed;
}

export async function getDeviceId(): Promise<string> {
  return group(await sha256Hex(`${await deviceSeed()}|jtpoin-device`), 2);
}

/** Dipakai oleh Generator Kode (pemilik aplikasi). */
export async function generateActivationCode(deviceId: string): Promise<string> {
  return group(await sha256Hex(`${normalizeCode(deviceId)}|${LICENSE_SECRET}`), 3);
}

async function readNumber(key: string): Promise<number | null> {
  const [a, b] = await Promise.all([storage.secureGet<number | null>(key, null), storage.getItem<number | null>(key, null)]);
  const vals = [a, b].filter((v): v is number => typeof v === "number" && v > 0);
  return vals.length ? Math.min(...vals) : null;
}

async function writeNumber(key: string, v: number) {
  await Promise.all([storage.secureSet(key, v), storage.setItem(key, v)]);
}

export async function refreshLicense(): Promise<LicenseStatus> {
  const deviceId = await getDeviceId();
  const now = Date.now();

  const saved = await storage.secureGet<string | null>(K_ACTIVATION, null);
  const activated = !!saved && normalizeCode(saved) === normalizeCode(await generateActivationCode(deviceId));

  let start = await readNumber(K_TRIAL_START);
  if (!start) {
    start = now;
    await writeNumber(K_TRIAL_START, start);
  }
  // Deteksi jam HP dimundurkan untuk memperpanjang demo.
  const lastSeen = (await Promise.all([storage.secureGet<number | null>(K_LAST_SEEN, null), storage.getItem<number | null>(K_LAST_SEEN, null)]))
    .filter((v): v is number => typeof v === "number")
    .reduce((m, v) => Math.max(m, v), 0);
  const tampered = now < start - 60 * 60 * 1000 || (lastSeen > 0 && now < lastSeen - 60 * 60 * 1000);
  if (now > lastSeen) await Promise.all([storage.secureSet(K_LAST_SEEN, now), storage.setItem(K_LAST_SEEN, now)]);

  const trialEndsAt = start + TRIAL_DAYS * DAY_MS;
  const expired = tampered || now >= trialEndsAt;
  const daysLeft = expired ? 0 : Math.ceil((trialEndsAt - now) / DAY_MS);

  cached = { deviceId, activated, expired, daysLeft, tampered, trialEndsAt };
  listeners.forEach((l) => l(cached!));
  return cached;
}

export async function activate(code: string): Promise<boolean> {
  const deviceId = await getDeviceId();
  const expected = await generateActivationCode(deviceId);
  if (normalizeCode(code) !== normalizeCode(expected)) return false;
  await storage.secureSet(K_ACTIVATION, expected);
  await refreshLicense();
  return true;
}

/** True bila operasi tulis harus diblokir (demo habis & belum aktif). */
export async function isLocked(): Promise<boolean> {
  const s = await refreshLicense();
  return !s.activated && s.expired;
}

export const LOCKED_MESSAGE = "Masa demo 3 hari telah habis. Data tetap bisa dilihat, tetapi transaksi baru memerlukan aktivasi. Buka menu Lainnya → Aktivasi Lisensi.";

export const RESTORE_LOCKED_MESSAGE = "Restore backup hanya tersedia untuk versi yang sudah diaktivasi. Buka menu Lainnya → Aktivasi Lisensi.";

export function useLicense() {
  const [status, setStatus] = useState<LicenseStatus | null>(cached);
  useEffect(() => {
    listeners.add(setStatus);
    refreshLicense().catch(() => undefined);
    return () => { listeners.delete(setStatus); };
  }, []);
  const refresh = useCallback(() => refreshLicense(), []);
  return { status, refresh };
}
