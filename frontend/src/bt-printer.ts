/**
 * Bluetooth Thermal Printer utility (ESC/POS) menggunakan react-native-thermal-printer-driver.
 *
 * CATATAN:
 *  - Native module (TurboModule) — HANYA berfungsi di APK/IPA build.
 *  - Di web atau Expo Go, semua fungsi akan throw dengan pesan jelas.
 *  - Printer tersimpan di SecureStore per-device, bukan di backend, karena tiap device
 *    biasanya dipasangkan dengan 1 printer fisik yang berbeda.
 */
import { Platform } from "react-native";

import { formatRupiah, PAYMENT_LABELS, type BusinessSettings, type TransactionDoc } from "@/src/api";
import { storage } from "@/src/utils/storage";

export type PairedPrinter = { address: string; name: string };

const PRINTER_KEY = "kasirku_bt_printer";

// Lazy-loaded ThermalPrinter untuk menghindari crash di web/Expo Go
type ThermalPrinterApi = {
  ThermalPrinter: typeof import("react-native-thermal-printer-driver").default;
  ESCPOSBuilder: typeof import("react-native-thermal-printer-driver").ESCPOSBuilder;
};

let apiPromise: Promise<ThermalPrinterApi> | null = null;
function loadApi(): Promise<ThermalPrinterApi> {
  if (apiPromise) return apiPromise;
  if (Platform.OS === "web") {
    apiPromise = Promise.reject(new Error("Printer thermal hanya tersedia di aplikasi mobile (Android/iOS build)."));
    return apiPromise;
  }
  apiPromise = (async () => {
    try {
      const mod = await import("react-native-thermal-printer-driver");
      // Access the TurboModule to force module registration
      if (!mod.default) throw new Error("Module tidak terdaftar");
      return { ThermalPrinter: mod.default, ESCPOSBuilder: mod.ESCPOSBuilder };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        `Modul printer thermal tidak terdeteksi. Pastikan Anda menjalankan aplikasi dari APK/IPA build (bukan Expo Go). Detail: ${msg}`,
      );
    }
  })();
  return apiPromise;
}

export async function isPrinterAvailable(): Promise<boolean> {
  try {
    await loadApi();
    return true;
  } catch {
    return false;
  }
}

export type ScanOutcome = { paired: { address: string; name: string }[]; found: { address: string; name: string }[] };

export async function scanPrinters(timeoutMs = 10000): Promise<ScanOutcome> {
  const { ThermalPrinter } = await loadApi();
  // Timeout fallback — some devices never fire onScanCompleted
  const scanPromise = ThermalPrinter.scan();
  const timeout = new Promise<ScanOutcome>((_, reject) => setTimeout(() => reject(new Error("Timeout scan Bluetooth (coba aktifkan Bluetooth & lokasi device)")), timeoutMs));
  const result = await Promise.race([scanPromise, timeout]);
  return {
    paired: (result.paired ?? []).map((d) => ({ address: d.address, name: d.name || d.address })),
    found: (result.found ?? []).map((d) => ({ address: d.address, name: d.name || d.address })),
  };
}

export async function stopScan(): Promise<void> {
  try {
    const { ThermalPrinter } = await loadApi();
    await ThermalPrinter.stopScan();
  } catch { /* ignore */ }
}

export async function connectPrinter(address: string, timeoutMs = 8000): Promise<void> {
  const { ThermalPrinter } = await loadApi();
  await ThermalPrinter.connect(address, { timeout: timeoutMs });
}

export async function disconnectPrinter(address?: string): Promise<void> {
  try {
    const { ThermalPrinter } = await loadApi();
    await ThermalPrinter.disconnect(address);
  } catch { /* ignore */ }
}

export async function testPrint(printer: PairedPrinter): Promise<void> {
  const { ThermalPrinter, ESCPOSBuilder } = await loadApi();
  const builder = new ESCPOSBuilder();
  const bytes = builder
    .init()
    .codePage("cp858")
    .align("center")
    .bold(true)
    .size(2)
    .text("KasirKu Pro\n")
    .size(1)
    .bold(false)
    .text("Tes koneksi printer\n")
    .text(`${printer.name}\n`)
    .text(`${new Date().toLocaleString("id-ID")}\n`)
    .feed(1)
    .align("left")
    .text("Printer sudah terhubung dengan baik.\nTerima kasih.\n")
    .feed(2)
    .cut()
    .bytes();
  const res = await ThermalPrinter.printRaw(printer.address, bytes, { paperWidthMm: 58, timeout: 15000 });
  if (!res.success) throw new Error(res.error?.message || "Gagal cetak uji");
}

// ---------- Persistensi printer per-device ----------

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

// ---------- Cetak struk transaksi ----------

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
  const printer = await getPairedPrinter();
  if (!printer) throw new Error("Belum ada printer terpasang. Buka menu Printer Bluetooth untuk mendaftarkan.");
  const { ThermalPrinter, ESCPOSBuilder } = await loadApi();
  const widthMm: 58 | 80 = settings.receipt_width === "80mm" ? 80 : 58;
  const cols = widthMm === 80 ? 48 : 32;
  const sep = "-".repeat(cols);
  const builder = new ESCPOSBuilder();
  builder.init().codePage("cp858");
  if (options.openCashDrawer || settings.cashdrawer_enabled) {
    try { builder.cashDrawer(); } catch { /* ignore */ }
  }
  builder.align("center").bold(true).size(2).text(`${settings.business_name}\n`).size(1).bold(false);
  const headerLines = (settings.header_lines ?? []).filter(Boolean).slice(0, 4);
  if (headerLines.length) headerLines.forEach((l) => builder.text(`${l}\n`));
  else {
    if (settings.address) builder.text(`${settings.address}\n`);
    if (settings.phone) builder.text(`Telp: ${settings.phone}\n`);
  }
  builder.align("left").text(`${sep}\n`);
  builder.text(`Invoice: ${tx.invoice_no}\n`);
  builder.text(`Tgl    : ${new Date(tx.created_at).toLocaleString("id-ID")}\n`);
  builder.text(`Plg    : ${tx.customer_name}\n`);
  if (tx.created_by_name) builder.text(`Kasir  : ${tx.created_by_name}\n`);
  builder.text(`${sep}\n`);
  tx.items.forEach((i) => {
    builder.text(`${i.name}${i.unit ? ` (${i.unit})` : ""}\n`);
    const line = padLine(`  ${i.quantity} x ${formatRupiah(i.price)}`, formatRupiah(i.price * i.quantity), cols);
    builder.text(`${line}\n`);
    if (i.discount) builder.text(padLine(`  Diskon`, `-${formatRupiah(i.discount)}`, cols) + "\n");
  });
  builder.text(`${sep}\n`);
  if (tx.subtotal && tx.subtotal !== tx.total) builder.text(padLine("Subtotal", formatRupiah(tx.subtotal), cols) + "\n");
  if (tx.global_discount) builder.text(padLine(`Diskon${tx.discount_percent ? ` ${tx.discount_percent}%` : ""}`, `-${formatRupiah(tx.global_discount)}`, cols) + "\n");
  if (tx.tax_amount) builder.text(padLine(`${settings.tax_label || "Pajak"} ${tx.tax_percent}%`, formatRupiah(tx.tax_amount), cols) + "\n");
  if (tx.shipping) builder.text(padLine("Ongkir", formatRupiah(tx.shipping), cols) + "\n");
  builder.bold(true).size(2);
  // size(2) doubles height; produce bigger total
  builder.text(padLine("TOTAL", formatRupiah(tx.total), Math.max(16, Math.floor(cols / 2))) + "\n");
  builder.size(1).bold(false);
  builder.text(padLine("Metode", tx.payment_method_label || PAYMENT_LABELS[tx.payment_method] || tx.payment_method, cols) + "\n");
  if (tx.paid_amount) builder.text(padLine("Dibayar", formatRupiah(tx.paid_amount), cols) + "\n");
  if (tx.outstanding) builder.text(padLine("Sisa Htg", formatRupiah(tx.outstanding), cols) + "\n");
  const change = (tx.paid_amount ?? 0) - tx.total;
  if (change > 0) builder.text(padLine("Kembalian", formatRupiah(change), cols) + "\n");
  builder.text(`${sep}\n`);
  const footerLines = (settings.footer_lines ?? []).filter(Boolean).slice(0, 4);
  const effectiveFooter = footerLines.length ? footerLines : (settings.footer_note ? [settings.footer_note] : ["Terima kasih"]);
  builder.align("center");
  effectiveFooter.forEach((l) => builder.text(`${l}\n`));
  builder.feed(3).cut();

  const bytes = builder.bytes();
  const res = await ThermalPrinter.printRaw(printer.address, bytes, {
    paperWidthMm: widthMm,
    timeout: 20000,
    copies: Math.max(1, options.copies ?? 1),
  });
  if (!res.success) throw new Error(res.error?.message || "Gagal mencetak struk");
}

/** Buka cash drawer saja (tanpa cetak isi struk). */
export async function openCashDrawerOnly(): Promise<void> {
  const printer = await getPairedPrinter();
  if (!printer) throw new Error("Belum ada printer terpasang.");
  const { ThermalPrinter, ESCPOSBuilder } = await loadApi();
  const bytes = new ESCPOSBuilder().init().cashDrawer().bytes();
  const res = await ThermalPrinter.printRaw(printer.address, bytes, { timeout: 8000 });
  if (!res.success) throw new Error(res.error?.message || "Gagal buka laci kas");
}
