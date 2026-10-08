/**
 * Scanner feedback — suara beep sukses/error + persistensi toggle.
 *
 * - `playScanSuccess()` / `playScanError()`: beep audio pendek (lazy-load,
 *   cache player instance). Safe untuk dipanggil berkali-kali tanpa delay.
 * - `getScannerEnabled()` / `setScannerEnabled()`: toggle on/off disimpan
 *   di AsyncStorage sehingga preferensi user bertahan antar sesi.
 *
 * Audio sources di-inline base64 (lihat `scanner-feedback-sources.ts`)
 * untuk menghindari Metro asset resolution yang bermasalah di web.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAudioPlayer, type AudioPlayer } from "expo-audio";

import { BEEP_ERROR_URI, BEEP_SUCCESS_URI } from "./scanner-feedback-sources";

const KEY_ENABLED = "jtpoin_scanner_enabled_v1";

let successPlayer: AudioPlayer | null = null;
let errorPlayer: AudioPlayer | null = null;

function getSuccessPlayer(): AudioPlayer | null {
  if (successPlayer) return successPlayer;
  try {
    successPlayer = createAudioPlayer({ uri: BEEP_SUCCESS_URI });
    return successPlayer;
  } catch {
    return null;
  }
}

function getErrorPlayer(): AudioPlayer | null {
  if (errorPlayer) return errorPlayer;
  try {
    errorPlayer = createAudioPlayer({ uri: BEEP_ERROR_URI });
    return errorPlayer;
  } catch {
    return null;
  }
}

export function playScanSuccess(): void {
  const p = getSuccessPlayer();
  if (!p) return;
  try {
    p.seekTo(0);
    p.play();
  } catch { /* ignore */ }
}

export function playScanError(): void {
  const p = getErrorPlayer();
  if (!p) return;
  try {
    p.seekTo(0);
    p.play();
  } catch { /* ignore */ }
}

export async function getScannerEnabled(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(KEY_ENABLED);
    if (v === null) return true; // default aktif
    return v === "1";
  } catch {
    return true;
  }
}

export async function setScannerEnabled(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_ENABLED, enabled ? "1" : "0");
  } catch { /* ignore */ }
}
