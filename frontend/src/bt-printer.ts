/**
 * Direct Bluetooth Thermal Printer helper menggunakan `rn-bluetooth-classic-printer`.
 *
 * STRATEGI:
 *  - Modul ini adalah Expo native module (auto-linked), bukan TurboModule
 *    standalone. Pendaftaran modul mengikuti sistem Expo sehingga tidak crash
 *    di APK.
 *  - Hanya mendukung Android (Bluetooth Classic SPP) — sesuai printer thermal
 *    POS Indonesia yang umum.
 *  - Pairing printer dilakukan di menu Pengaturan Bluetooth Android, kemudian
 *    aplikasi memilih dari daftar paired device.
 *  - Printer tersimpan di SecureStore per-device.
 *  - Lazy require: di web/Expo Go, modul tidak dibebankan sehingga tidak crash.
 */
import * as Linking from "expo-linking";
import { PermissionsAndroid, Platform } from "react-native";

import { formatRupiah, PAYMENT_LABELS, type BusinessSettings, type TransactionDoc } from "@/src/api";
import { storage } from "@/src/utils/storage";

export type PairedPrinter = { address: string; name: string };

const PRINTER_KEY = "jtpoin_bt_printer";

type BtModule = typeof import("rn-bluetooth-classic-printer");
let btCache: BtModule | null | undefined; // undefined = untried, null = unavailable
function tryLoadBt(): BtModule | null {
  if (btCache !== undefined) return btCache;
  if (Platform.OS !== "android") { btCache = null; return null; }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("rn-bluetooth-classic-printer") as BtModule;
    if (!mod || typeof mod.getPairedDevices !== "function") { btCache = null; return null; }
    btCache = mod;
    return mod;
  } catch {
    btCache = null;
    return null;
  }
}

export async function isPrinterAvailable(): Promise<boolean> {
  return tryLoadBt() !== null;
}

// ---------- Permission ----------
async function ensurePermissions(): Promise<void> {
  if (Platform.OS !== "android") return;
  const perms: string[] = [];
  const sdk = Platform.Version as number;
  if (sdk >= 31) {
    perms.push(
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    );
  } else {
    perms.push(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    );
  }
  const result = await PermissionsAndroid.requestMultiple(perms as Parameters<typeof PermissionsAndroid.requestMultiple>[0]);
  const denied = Object.entries(result).filter(([, v]) => v !== PermissionsAndroid.RESULTS.GRANTED);
  if (denied.length) {
    const neverAgain = denied.some(([, v]) => v === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN);
    throw new Error(
      neverAgain
        ? "Izin Bluetooth ditolak permanen. Buka Pengaturan Android → Aplikasi → JTPOIN POS → Izin, lalu aktifkan Bluetooth & lokasi."
        : "Izin Bluetooth diperlukan untuk mencetak struk.",
    );
  }
}

// ---------- Scan / pair ----------
export type ScanOutcome = { paired: PairedPrinter[]; found: PairedPrinter[] };

export async function scanPrinters(timeoutMs = 12000): Promise<ScanOutcome> {
  const bt = tryLoadBt();
  if (!bt) throw new Error("Modul Bluetooth tidak tersedia. Butuh APK Android build (bukan Expo Go/web).");
  await ensurePermissions();
  if (!bt.isBluetoothEnabled()) {
    const ok = await bt.requestEnableBluetooth().catch(() => false);
    if (!ok) throw new Error("Bluetooth belum aktif. Aktifkan Bluetooth dulu di HP.");
  }
  const pairedRaw = await bt.getPairedDevices();
  const paired: PairedPrinter[] = pairedRaw.map((d) => ({ address: d.id, name: d.name || d.id }));

  const found: PairedPrinter[] = [];
  const seen = new Set<string>();
  const sub = bt.startScanning((d) => {
    if (!seen.has(d.id)) { seen.add(d.id); found.push({ address: d.id, name: d.name || d.id }); }
  });
  await new Promise((r) => setTimeout(r, timeoutMs));
  try { bt.stopScanning(); } catch { /* ignore */ }
  try { sub.remove(); } catch { /* ignore */ }
  return { paired, found };
}

export async function stopScan(): Promise<void> {
  const bt = tryLoadBt();
  if (!bt) return;
  try { bt.stopScanning(); } catch { /* ignore */ }
}

// ---------- Connection ----------
export async function connectPrinter(address: string): Promise<void> {
  const bt = tryLoadBt();
  if (!bt) throw new Error("Modul Bluetooth tidak tersedia.");
  await ensurePermissions();
  const current = bt.getConnectedDevice();
  if (current && current.id === address) return;
  if (current) { try { await bt.disconnect(); } catch { /* ignore */ } }
  const ok = await bt.connectDevice(address);
  if (!ok) throw new Error("Gagal konek ke printer. Pastikan printer menyala & sudah di-pair di Pengaturan Android.");
}

export async function disconnectPrinter(_address?: string): Promise<void> {
  const bt = tryLoadBt();
  if (!bt) return;
  try { await bt.disconnect(); } catch { /* ignore */ }
}

// ---------- Persistence ----------
export async function savePairedPrinter(printer: PairedPrinter | null): Promise<void> {
  if (!printer) return storage.secureRemove(PRINTER_KEY);
  await storage.secureSet(PRINTER_KEY, JSON.stringify(printer));
}

export async function getPairedPrinter(): Promise<PairedPrinter | null> {
  const raw = await storage.secureGet<string | null>(PRINTER_KEY, null);
  if (!raw) return null;
  try { return JSON.parse(raw) as PairedPrinter; }
  catch { return null; }
}

// ---------- ESC/POS Builder (JS, menghasilkan base64) ----------
const ESC = 0x1b, GS = 0x1d;

class EscposBuilder {
  private bytes: number[] = [];
  push(...b: number[]) { for (const x of b) this.bytes.push(x & 0xff); return this; }
  init() { return this.push(ESC, 0x40); }
  codePage() { return this.push(ESC, 0x74, 0x10); } // CP858 (contains €, umumnya kompatibel)
  text(s: string) {
    const clean = s.replace(/[^\x00-\xff\n\t]/g, "?").replace(/\r/g, "");
    for (let i = 0; i < clean.length; i++) this.push(clean.charCodeAt(i));
    return this;
  }
  line(s = "") { return this.text(s + "\n"); }
  align(a: "left" | "center" | "right") { return this.push(ESC, 0x61, a === "left" ? 0 : a === "center" ? 1 : 2); }
  bold(on: boolean) { return this.push(ESC, 0x45, on ? 1 : 0); }
  double(on: boolean) { return this.push(GS, 0x21, on ? 0x11 : 0x00); }
  feed(n = 1) { for (let i = 0; i < n; i++) this.push(0x0a); return this; }
  cut() { return this.push(GS, 0x56, 0x01); }
  cashDrawer() { return this.push(ESC, 0x70, 0x00, 0x19, 0xfa); }
  base64() {
    const chunk = 0x8000;
    let bin = "";
    for (let i = 0; i < this.bytes.length; i += chunk) bin += String.fromCharCode(...this.bytes.slice(i, i + chunk));
    // eslint-disable-next-line no-restricted-globals
    return typeof btoa !== "undefined" ? btoa(bin) : "";
  }
}

// ---------- Public: cetak ----------
async function sendBase64(base64: string, copies = 1): Promise<void> {
  const bt = tryLoadBt();
  if (!bt) throw new Error("Modul Bluetooth tidak tersedia. Butuh APK Android build.");
  const printer = await getPairedPrinter();
  if (!printer) throw new Error("Belum ada printer tersimpan. Pair printer di menu Printer Bluetooth dulu.");
  await connectPrinter(printer.address);
  for (let i = 0; i < Math.max(1, copies); i++) {
    const ok = await bt.printRaw(base64);
    if (!ok) throw new Error("Gagal mengirim data ke printer. Coba cek koneksi.");
    if (i < copies - 1) await new Promise((r) => setTimeout(r, 400));
  }
}

export async function testPrint(printer: PairedPrinter): Promise<void> {
  const bt = tryLoadBt();
  if (!bt) throw new Error("Modul Bluetooth tidak tersedia.");
  await connectPrinter(printer.address);
  const b = new EscposBuilder();
  b.init().codePage()
    .align("center").bold(true).double(true).line("JTPOIN POS").double(false).bold(false)
    .line("Tes koneksi printer")
    .line(printer.name)
    .line(new Date().toLocaleString("id-ID"))
    .feed(1)
    .align("left")
    .line("Jika struk ini keluar rapi,")
    .line("printer sudah siap digunakan.")
    .line("Terima kasih.")
    .feed(2)
    .cut();
  const ok = await bt.printRaw(b.base64());
  if (!ok) throw new Error("Gagal cetak uji. Printer tidak merespons.");
}

function padLine(left: string, right: string, cols: number): string {
  const l = left.slice(0, cols - 1);
  const r = right.slice(0, cols);
  const space = Math.max(1, cols - l.length - r.length);
  return `${l}${" ".repeat(space)}${r}`;
}

export async function printReceipt(
  tx: TransactionDoc,
  settings: BusinessSettings,
  options: { openCashDrawer?: boolean; copies?: number } = {},
): Promise<void> {
  const widthMm: 58 | 80 = settings.receipt_width === "80mm" ? 80 : 58;
  const cols = widthMm === 80 ? 48 : 32;
  const sep = "-".repeat(cols);
  const b = new EscposBuilder();
  b.init().codePage();
  if (options.openCashDrawer || settings.cashdrawer_enabled) b.cashDrawer();
  b.align("center").bold(true).double(true).line(settings.business_name).double(false).bold(false);
  const headerLines = (settings.header_lines ?? []).filter(Boolean).slice(0, 4);
  if (headerLines.length) headerLines.forEach((l) => b.line(l));
  else {
    if (settings.address) b.line(settings.address);
    if (settings.phone) b.line(`Telp: ${settings.phone}`);
  }
  b.align("left").line(sep);
  b.line(`Invoice: ${tx.invoice_no ?? "-"}`);
  b.line(`Tgl    : ${new Date(tx.created_at).toLocaleString("id-ID")}`);
  b.line(`Plg    : ${tx.customer_name ?? "Umum"}`);
  if (tx.created_by_name) b.line(`Kasir  : ${tx.created_by_name}`);
  b.line(sep);
  (tx.items ?? []).forEach((i) => {
    b.line(`${i.name}${i.unit ? ` (${i.unit})` : ""}`);
    b.line(padLine(`  ${i.quantity} x ${formatRupiah(i.price)}`, formatRupiah(i.price * i.quantity), cols));
    if (i.discount) b.line(padLine("  Diskon", `-${formatRupiah(i.discount)}`, cols));
  });
  b.line(sep);
  if (tx.subtotal && tx.subtotal !== tx.total) b.line(padLine("Subtotal", formatRupiah(tx.subtotal), cols));
  if (tx.global_discount) b.line(padLine(`Diskon${tx.discount_percent ? ` ${tx.discount_percent}%` : ""}`, `-${formatRupiah(tx.global_discount)}`, cols));
  if (tx.tax_amount) b.line(padLine(`${settings.tax_label || "Pajak"} ${tx.tax_percent}%`, formatRupiah(tx.tax_amount), cols));
  if (tx.shipping) b.line(padLine("Ongkir", formatRupiah(tx.shipping), cols));
  b.bold(true).double(true).line(padLine("TOTAL", formatRupiah(tx.total), Math.max(14, Math.floor(cols / 2)))).double(false).bold(false);
  b.line(padLine("Metode", tx.payment_method_label || PAYMENT_LABELS[tx.payment_method] || tx.payment_method || "-", cols));
  if (tx.paid_amount) b.line(padLine("Dibayar", formatRupiah(tx.paid_amount), cols));
  if ((tx.outstanding ?? 0) > 0) b.line(padLine("Sisa Htg", formatRupiah(tx.outstanding ?? 0), cols));
  const change = (tx.paid_amount ?? 0) - tx.total;
  if (change > 0) b.line(padLine("Kembalian", formatRupiah(change), cols));
  b.line(sep);
  const footerLines = (settings.footer_lines ?? []).filter(Boolean).slice(0, 4);
  const effectiveFooter = footerLines.length ? footerLines : (settings.footer_note ? [settings.footer_note] : ["Terima kasih"]);
  b.align("center");
  effectiveFooter.forEach((l) => b.line(l));
  b.feed(3).cut();

  await sendBase64(b.base64(), options.copies ?? 1);
}

export async function openCashDrawerOnly(): Promise<void> {
  const b = new EscposBuilder();
  b.init().cashDrawer().feed(1);
  await sendBase64(b.base64());
}

/** Buka pengaturan Bluetooth Android (shortcut dari UI). */
export async function openBluetoothSettings(): Promise<void> {
  if (Platform.OS === "android") {
    try { await Linking.sendIntent("android.settings.BLUETOOTH_SETTINGS"); }
    catch { try { await Linking.openSettings(); } catch { /* ignore */ } }
  }
}
