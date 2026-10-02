import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as Linking from "expo-linking";
import bwipjs from "bwip-js";

import { BusinessSettings, formatRupiah, PAYMENT_LABELS, TransactionDoc } from "@/src/api";

function esc(value: string | number | undefined | null): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c] ?? c));
}

export function buildInvoiceHtml(tx: TransactionDoc, settings: BusinessSettings): string {
  const rows = tx.items.map((it, idx) => `
    <tr>
      <td class="num">${idx + 1}</td>
      <td>${esc(it.name)}${it.unit ? ` <span class="muted">(${esc(it.unit)})</span>` : ""}</td>
      <td class="num">${it.quantity}</td>
      <td class="num">${esc(formatRupiah(it.price))}</td>
      <td class="num">${it.discount ? "-" + esc(formatRupiah(it.discount)) : "-"}</td>
      <td class="num">${esc(formatRupiah(it.price * it.quantity - (it.discount ?? 0)))}</td>
    </tr>`).join("");
  const paymentLabel = tx.payment_method_label ?? PAYMENT_LABELS[tx.payment_method] ?? tx.payment_method;
  const customerBlock = tx.customer_name ? `
    <div><div class="label">Pelanggan</div><div class="value">${esc(tx.customer_name)}</div></div>` : "";
  const logoHtml = settings.logo_base64 ? `<img src="data:image/jpeg;base64,${settings.logo_base64}" class="logo" />` : "";
  return `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  @page { size: A5 portrait; margin: 10mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: -apple-system, "Helvetica Neue", Arial, sans-serif; color: #111; padding: 14px; max-width: 100%; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f8043; padding-bottom: 10px; margin-bottom: 14px; }
  .brand { max-width: 55%; }
  .logo { width: 48px; height: 48px; object-fit: contain; margin-bottom: 4px; border-radius: 8px; }
  .business { font-size: 16px; font-weight: 800; color: #0f8043; }
  .addr { color: #555; font-size: 10px; line-height: 1.3; }
  .meta { text-align: right; font-size: 10px; color: #333; }
  .meta .label { color: #777; }
  .meta .value { font-weight: 700; margin-bottom: 2px; font-size: 11px; }
  .section { display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 11px; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 10px; }
  th { text-align: left; background: #0f8043; color: #fff; padding: 6px 5px; font-weight: 700; font-size: 10px; letter-spacing: 0.3px; }
  td { padding: 6px 5px; border-bottom: 1px solid #e4e4e7; font-size: 10px; }
  .num { text-align: right; white-space: nowrap; }
  .totals { margin-top: 10px; margin-left: auto; width: 60%; font-size: 11px; }
  .totals .row { display: flex; justify-content: space-between; padding: 3px 0; }
  .totals .grand { border-top: 2px solid #0f8043; margin-top: 6px; padding-top: 6px; font-size: 14px; font-weight: 800; color: #0f8043; }
  .footer { margin-top: 18px; font-size: 9px; color: #666; border-top: 1px dashed #ccc; padding-top: 8px; text-align: center; }
  .muted { color: #888; font-size: 9px; }
  @media print {
    body { padding: 0; }
    .header { padding-bottom: 8px; margin-bottom: 10px; }
  }
</style></head>
<body>
  <div class="header">
    <div class="brand">
      ${logoHtml}
      <div class="business">${esc(settings.business_name)}</div>
      <div class="addr">${esc(settings.address) || ""}${settings.phone ? "<br/>Telp: " + esc(settings.phone) : ""}</div>
    </div>
    <div class="meta">
      <div class="label">INVOICE</div>
      <div class="value">${esc(tx.invoice_no)}</div>
      <div class="label">Tanggal</div>
      <div class="value">${esc(new Date(tx.created_at).toLocaleString("id-ID"))}</div>
      <div class="label">Pembayaran</div>
      <div class="value">${esc(paymentLabel)}</div>
    </div>
  </div>
  <div class="section">${customerBlock}</div>
  <table>
    <thead><tr><th style="width:20px">#</th><th>Produk</th><th class="num">Qty</th><th class="num">Harga</th><th class="num">Diskon</th><th class="num">Subtotal</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="totals">
    ${tx.subtotal && tx.subtotal !== tx.total ? `<div class="row"><span>Subtotal</span><span>${esc(formatRupiah(tx.subtotal))}</span></div>` : ""}
    ${tx.global_discount ? `<div class="row"><span>Diskon${tx.discount_percent ? ` ${tx.discount_percent}%` : ""}</span><span>-${esc(formatRupiah(tx.global_discount))}</span></div>` : ""}
    ${tx.tax_amount ? `<div class="row"><span>${esc(settings.tax_label || "Pajak")} ${tx.tax_percent}%</span><span>${esc(formatRupiah(tx.tax_amount))}</span></div>` : ""}
    ${tx.shipping ? `<div class="row"><span>Ongkir</span><span>${esc(formatRupiah(tx.shipping))}</span></div>` : ""}
    <div class="row grand"><span>TOTAL</span><span>${esc(formatRupiah(tx.total))}</span></div>
    ${tx.paid_amount ? `<div class="row"><span>Dibayar</span><span>${esc(formatRupiah(tx.paid_amount))}</span></div>` : ""}
    ${tx.outstanding ? `<div class="row"><span>Sisa</span><span>${esc(formatRupiah(tx.outstanding))}</span></div>` : ""}
    ${tx.paid_amount - tx.total > 0 ? `<div class="row"><span>Kembalian</span><span>${esc(formatRupiah(tx.paid_amount - tx.total))}</span></div>` : ""}
  </div>
  <div class="footer">${esc(settings.footer_note || "Terima kasih atas kunjungan Anda.")}<br/>Dicetak oleh JTPOIN POS · ${esc(new Date().toLocaleString("id-ID"))}</div>
</body></html>`;
}

export async function generateInvoicePdf(tx: TransactionDoc, settings: BusinessSettings): Promise<string> {
  const html = buildInvoiceHtml(tx, settings);
  // Force A5 paper in points (1pt = 1/72 inch; A5 = 148×210mm ≈ 419.5×595.3pt)
  const { uri } = await Print.printToFileAsync({ html, base64: false, width: 420, height: 595 });
  return uri;
}

export async function shareInvoicePdf(tx: TransactionDoc, settings: BusinessSettings, channel: "share" | "whatsapp" | "email" = "share"): Promise<void> {
  const uri = await generateInvoicePdf(tx, settings);
  if (channel === "whatsapp") {
    const phone = settings.whatsapp_number?.replace(/\D/g, "") || "";
    const url = `whatsapp://send?${phone ? `phone=${phone}&` : ""}text=${encodeURIComponent(`Invoice ${tx.invoice_no} dari ${settings.business_name}. Total: ${formatRupiah(tx.total)}`)}`;
    if (await Linking.canOpenURL(url)) {
      await Linking.openURL(url);
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: "Lampirkan PDF ke WhatsApp" });
      return;
    }
  }
  if (channel === "email") {
    const to = settings.email_recipient ?? "";
    const url = `mailto:${to}?subject=${encodeURIComponent(`Invoice ${tx.invoice_no}`)}&body=${encodeURIComponent(`Terlampir invoice ${tx.invoice_no} total ${formatRupiah(tx.total)}.`)}`;
    if (await Linking.canOpenURL(url)) await Linking.openURL(url);
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: "Lampirkan PDF ke email" });
    return;
  }
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: "Bagikan invoice PDF" });
}

export function barcodeSvg(code: string, options: { height?: number; scale?: number; includetext?: boolean } = {}): string {
  try {
    return bwipjs.toSVG({
      bcid: "code128",
      text: code,
      scale: options.scale ?? 2,
      height: options.height ?? 12,
      includetext: options.includetext ?? true,
      textxalign: "center",
      textsize: 8,
    });
  } catch {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="40"><text x="4" y="20">${esc(code)}</text></svg>`;
  }
}

export function buildBarcodeSheetHtml(labels: { name: string; code: string; price?: number }[], perRow: number, labelWidthMm: number, labelHeightMm: number, businessName: string): string {
  const cells = labels.map((l) => {
    const svg = barcodeSvg(l.code || l.name.toUpperCase().replace(/\s+/g, "").slice(0, 20), { height: 10, scale: 2 });
    return `<div class="cell"><div class="bname">${esc(l.name)}</div><div class="svg">${svg}</div>${l.price !== undefined ? `<div class="price">${esc(formatRupiah(l.price))}</div>` : ""}<div class="biz">${esc(businessName)}</div></div>`;
  }).join("");
  return `<!doctype html><html><head><meta charset="utf-8" />
<style>
  @page { margin: 8mm; }
  body { margin: 0; font-family: Arial, sans-serif; }
  .grid { display: grid; grid-template-columns: repeat(${perRow}, 1fr); gap: 2mm; }
  .cell { width: ${labelWidthMm}mm; height: ${labelHeightMm}mm; border: 1px dashed #ccc; padding: 2mm; display: flex; flex-direction: column; align-items: center; justify-content: center; page-break-inside: avoid; }
  .bname { font-size: 10px; font-weight: 700; text-align: center; margin-bottom: 1mm; }
  .svg svg { width: 100%; max-height: ${labelHeightMm - 14}mm; }
  .price { font-size: 11px; font-weight: 800; margin-top: 1mm; }
  .biz { font-size: 7px; color: #777; margin-top: 1mm; }
</style></head><body><div class="grid">${cells}</div></body></html>`;
}

export async function printBarcodeSheet(labels: { name: string; code: string; price?: number }[], layout: { perRow: number; widthMm: number; heightMm: number }, businessName: string): Promise<void> {
  const html = buildBarcodeSheetHtml(labels, layout.perRow, layout.widthMm, layout.heightMm, businessName);
  const { uri } = await Print.printToFileAsync({ html, base64: false });
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: "Cetak / Bagikan label barcode" });
}

// ---------- Report PDFs ----------

export type ReportTable = { title: string; subtitle?: string; headers: string[]; rows: (string | number)[][]; summary?: { label: string; value: string }[] };

export function buildReportHtml(section: ReportTable, businessName: string): string {
  const rowsHtml = section.rows.map((r) => `<tr>${r.map((cell, i) => `<td class="${typeof cell === "number" || i > 0 ? "num" : ""}">${esc(String(cell))}</td>`).join("")}</tr>`).join("");
  const headerHtml = section.headers.map((h) => `<th>${esc(h)}</th>`).join("");
  const summaryHtml = (section.summary ?? []).map((s) => `<div class="row"><span>${esc(s.label)}</span><span>${esc(s.value)}</span></div>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Helvetica Neue", Arial, sans-serif; color: #111; margin: 28px; }
  h1 { color: #0f8043; margin: 0; font-size: 22px; }
  .subtitle { color: #666; font-size: 12px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 11px; }
  th { text-align: left; background: #0f8043; color: #fff; padding: 8px; font-size: 10px; }
  td { padding: 7px 8px; border-bottom: 1px solid #e4e4e7; }
  .num { text-align: right; white-space: nowrap; }
  .summary { margin-top: 18px; margin-left: auto; width: 300px; font-size: 12px; border-top: 2px solid #0f8043; padding-top: 10px; }
  .summary .row { display: flex; justify-content: space-between; padding: 4px 0; font-weight: 600; }
  .footer { margin-top: 30px; font-size: 10px; color: #666; border-top: 1px dashed #ccc; padding-top: 10px; text-align: center; }
</style></head>
<body>
  <h1>${esc(businessName)}</h1>
  <h1 style="font-size:16px;color:#111;margin-top:4px">${esc(section.title)}</h1>
  <div class="subtitle">${esc(section.subtitle ?? "")}</div>
  <table><thead><tr>${headerHtml}</tr></thead><tbody>${rowsHtml}</tbody></table>
  ${summaryHtml ? `<div class="summary">${summaryHtml}</div>` : ""}
  <div class="footer">Dibuat ${esc(new Date().toLocaleString("id-ID"))} · JTPOIN POS</div>
</body></html>`;
}

export async function shareReportPdf(section: ReportTable, businessName: string): Promise<void> {
  const html = buildReportHtml(section, businessName);
  const { uri } = await Print.printToFileAsync({ html, base64: false });
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: `PDF ${section.title}` });
}
