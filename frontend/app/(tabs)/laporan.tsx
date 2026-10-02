import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect } from "expo-router";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, Share, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest, BusinessSettings, CustomerReportRow, downloadReportsExcel, formatRupiah, OperatorReportRow, PAYMENT_LABELS, ProductReportRow, ReportSummary, SalesItemRow, TransactionDoc } from "@/src/api";
import { useAppStyles } from "@/src/app-styles";
import { useAuth } from "@/src/auth-context";
import { Header } from "@/src/components/header";
import { SyncBanner } from "@/src/components/sync-banner";
import { shareInvoicePdf, shareReportPdf } from "@/src/pdf";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";

type Period = "daily" | "monthly" | "yearly" | "custom";
type Tab = "ringkasan" | "produk" | "pelanggan" | "operator" | "barang" | "transaksi";

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function firstDayOfMonthYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export default function LaporanScreen() {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user, can } = useAuth();
  const toast = useToast();
  const [period, setPeriod] = useState<Period>("daily");
  const [tab, setTab] = useState<Tab>("ringkasan");
  const [customStart, setCustomStart] = useState<string>(firstDayOfMonthYmd());
  const [customEnd, setCustomEnd] = useState<string>(todayYmd());
  const [customOpen, setCustomOpen] = useState(false);
  const [draftStart, setDraftStart] = useState<string>(firstDayOfMonthYmd());
  const [draftEnd, setDraftEnd] = useState<string>(todayYmd());
  const [report, setReport] = useState<ReportSummary | null>(null);
  const [products, setProducts] = useState<ProductReportRow[]>([]);
  const [customers, setCustomers] = useState<CustomerReportRow[]>([]);
  const [operators, setOperators] = useState<OperatorReportRow[]>([]);
  const [salesItems, setSalesItems] = useState<SalesItemRow[]>([]);
  const [transactions, setTransactions] = useState<TransactionDoc[]>([]);
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [pdfBusy, setPdfBusy] = useState<string | null>(null);
  const [xlsxBusy, setXlsxBusy] = useState(false);
  const [metricDetail, setMetricDetail] = useState<null | { title: string; rows: { label: string; value: string }[]; description?: string }>(null);
  const [operatorDetail, setOperatorDetail] = useState<null | { operator: OperatorReportRow; rows: SalesItemRow[] }>(null);

  const load = useCallback(async (p: Period, s?: string, e?: string) => {
    // Build date-range filter string safely; backend will tolerate blanks
    const safeStart = typeof s === "string" ? s.trim() : "";
    const safeEnd = typeof e === "string" ? e.trim() : "";
    const qs = p === "custom"
      ? `period=custom&start=${encodeURIComponent(safeStart)}&end=${encodeURIComponent(safeEnd)}`
      : `period=${p}`;

    // Compute client-side filter window as ISO strings. Guard every date op.
    let startIso = "";
    let endIso = "";
    try {
      if (p === "custom" && /^\d{4}-\d{2}-\d{2}$/.test(safeStart) && /^\d{4}-\d{2}-\d{2}$/.test(safeEnd)) {
        const sd = new Date(`${safeStart}T00:00:00`);
        const ed = new Date(`${safeEnd}T23:59:59.999`);
        if (!Number.isNaN(sd.getTime())) startIso = sd.toISOString();
        if (!Number.isNaN(ed.getTime())) endIso = ed.toISOString();
      } else {
        const now = new Date();
        if (p === "daily") startIso = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        else if (p === "monthly") startIso = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        else if (p === "yearly") startIso = new Date(now.getFullYear(), 0, 1).toISOString();
      }
    } catch { /* keep empty — no filter */ }

    // Fetch each endpoint independently so one failure does not blank the whole screen.
    const safely = async <T,>(path: string, fallback: T): Promise<T> => {
      try { return (await apiRequest<T>(path)); } catch { return fallback; }
    };

    const [sum, pr, c, op, si, tx] = await Promise.all([
      safely<ReportSummary | null>(`/reports/summary?${qs}`, null),
      safely<{ rows: ProductReportRow[] }>(`/reports/products?${qs}`, { rows: [] }),
      safely<{ rows: CustomerReportRow[] }>(`/reports/customers?${qs}`, { rows: [] }),
      safely<{ rows: OperatorReportRow[] }>(`/reports/operators?${qs}`, { rows: [] }),
      safely<{ rows: SalesItemRow[] }>(`/reports/sales-items?${qs}`, { rows: [] }),
      safely<TransactionDoc[]>(`/transactions?kind=sale&limit=300`, []),
    ]);

    setReport(sum);
    setProducts(Array.isArray(pr?.rows) ? pr.rows : []);
    setCustomers(Array.isArray(c?.rows) ? c.rows : []);
    setOperators(Array.isArray(op?.rows) ? op.rows : []);
    setSalesItems(Array.isArray(si?.rows) ? si.rows : []);

    const txList = Array.isArray(tx) ? tx : [];
    const filtered = txList.filter((t) => {
      if (!t || typeof t.created_at !== "string") return false;
      if (t.status === "cancelled") return false;
      if (startIso && t.created_at < startIso) return false;
      if (endIso && t.created_at > endIso) return false;
      return true;
    });
    // Cap display list to avoid Hermes OOM on devices with many transactions.
    setTransactions(filtered.slice(0, 200));
  }, []);

  // Load on screen focus and whenever period/custom range changes. Single effect avoids
  // double-fetch races that were causing hard crashes on some Android devices.
  useFocusEffect(useCallback(() => {
    load(period, customStart, customEnd).catch(() => undefined);
  }, [load, period, customStart, customEnd]));
  useEffect(() => {
    apiRequest<BusinessSettings>("/settings").then(setSettings).catch(() => undefined);
  }, []);

  if (!can("reports")) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top, alignItems: "center", justifyContent: "center", padding: 24 }]}>
        <Ionicons name="lock-closed-outline" size={44} color={colors.muted} />
        <Text style={[styles.title, { fontSize: 22, textAlign: "center", marginTop: 16 }]}>Laporan terkunci</Text>
        <Text style={[styles.subtitle, { textAlign: "center" }]}>Pemilik belum mengaktifkan kewenangan Laporan.</Text>
      </View>
    );
  }

  const periodLabel = period === "daily" ? "Hari ini" : period === "monthly" ? "Bulan ini" : period === "yearly" ? "Tahun ini" : `${customStart} s/d ${customEnd}`;

  const openCustom = () => {
    setDraftStart(customStart);
    setDraftEnd(customEnd);
    setCustomOpen(true);
  };

  const applyCustom = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draftStart) || !/^\d{4}-\d{2}-\d{2}$/.test(draftEnd)) {
      return toast.error("Format tanggal salah", "Gunakan format YYYY-MM-DD, contoh 2026-06-01.");
    }
    if (draftStart > draftEnd) return toast.error("Rentang tidak valid", "Tanggal mulai harus sebelum tanggal akhir.");
    setCustomStart(draftStart); setCustomEnd(draftEnd);
    setPeriod("custom");
    setCustomOpen(false);
  };

  const openMetric = (key: string) => {
    if (!report) return;
    if (key === "sales") {
      const rows = salesItems
        .reduce<Record<string, { total: number; count: number; name: string }>>((acc, r) => {
          const k = r.invoice_no;
          const b = acc[k] ?? { total: 0, count: 0, name: `${r.invoice_no} · ${r.customer_name}` };
          b.total += r.subtotal; b.count += r.quantity;
          acc[k] = b;
          return acc;
        }, {});
      setMetricDetail({
        title: `Penjualan · ${periodLabel}`,
        description: `${report.transaction_count} transaksi · total ${formatRupiah(report.sales_total)}`,
        rows: Object.values(rows).map((r) => ({ label: `${r.name} (${r.count}x)`, value: formatRupiah(r.total) })),
      });
    } else if (key === "profit") {
      setMetricDetail({
        title: `Laba kotor · ${periodLabel}`,
        description: formatRupiah(report.gross_profit),
        rows: products.map((p) => ({ label: `${p.name} · ${p.quantity} unit`, value: formatRupiah(p.profit) })),
      });
    } else if (key === "purchase") {
      setMetricDetail({ title: `Pembelian · ${periodLabel}`, description: formatRupiah(report.purchase_total), rows: [] });
    } else if (key === "cash") {
      setMetricDetail({
        title: `Arus kas · ${periodLabel}`,
        description: `Saldo ${formatRupiah(report.cash_balance)}`,
        rows: [
          { label: "Masuk", value: formatRupiah(report.cash_in) },
          { label: "Keluar", value: formatRupiah(report.cash_out) },
        ],
      });
    } else if (key === "receivable") {
      setMetricDetail({ title: `Piutang · ${periodLabel}`, description: formatRupiah(report.receivable), rows: customers.filter((c) => c.outstanding > 0).map((c) => ({ label: c.customer_name, value: formatRupiah(c.outstanding) })) });
    } else if (key === "payable") {
      setMetricDetail({ title: `Hutang · ${periodLabel}`, description: formatRupiah(report.payable), rows: [] });
    }
  };

  const openOperator = async (operator: OperatorReportRow) => {
    try {
      const qs = period === "custom" ? `period=custom&start=${customStart}&end=${customEnd}` : `period=${period}`;
      const res = await apiRequest<{ rows: SalesItemRow[] }>(`/reports/sales-items?${qs}${operator.operator_id ? `&operator_id=${operator.operator_id}` : ""}`);
      setOperatorDetail({ operator, rows: res.rows });
    } catch (e) { toast.error("Gagal memuat detail operator", e instanceof Error ? e.message : undefined); }
  };

  const metrics = report ? [
    { key: "sales", label: "Penjualan", value: formatRupiah(report.sales_total), icon: "trending-up" as const, color: colors.brandPrimary },
    { key: "profit", label: "Laba kotor", value: formatRupiah(report.gross_profit), icon: "stats-chart" as const, color: colors.success },
    { key: "purchase", label: "Pembelian", value: formatRupiah(report.purchase_total), icon: "cart-outline" as const, color: colors.info },
    { key: "cash", label: "Saldo kas", value: formatRupiah(report.cash_balance), icon: "wallet-outline" as const, color: colors.warning },
    { key: "receivable", label: "Piutang", value: formatRupiah(report.receivable), icon: "time-outline" as const, color: colors.warning },
    { key: "payable", label: "Hutang", value: formatRupiah(report.payable), icon: "alert-circle-outline" as const, color: colors.error },
  ] : [];

  const sendPdf = async () => {
    const biz = user?.business_name ?? "JTPOIN POS";
    if (!report) return;
    try {
      if (tab === "ringkasan") {
        await shareReportPdf({
          title: `Laporan Ringkasan · ${periodLabel}`,
          subtitle: `${biz} · ${new Date().toLocaleString("id-ID")}`,
          headers: ["Metrik", "Nilai"],
          rows: metrics.map((m) => [m.label, m.value]),
          summary: [
            { label: "Transaksi", value: String(report.transaction_count) },
            { label: "Kas masuk", value: formatRupiah(report.cash_in) },
            { label: "Kas keluar", value: formatRupiah(report.cash_out) },
          ],
        }, biz);
      } else if (tab === "produk") {
        await shareReportPdf({
          title: `Laporan Per Produk · ${periodLabel}`, subtitle: biz,
          headers: ["Produk", "Qty", "Omzet", "Laba"],
          rows: products.map((p) => [p.name, p.quantity, formatRupiah(p.revenue), formatRupiah(p.profit)]),
        }, biz);
      } else if (tab === "pelanggan") {
        await shareReportPdf({
          title: `Laporan Per Pelanggan · ${periodLabel}`, subtitle: biz,
          headers: ["Pelanggan", "Transaksi", "Belanja", "Piutang"],
          rows: customers.map((c) => [c.customer_name, c.transaction_count, formatRupiah(c.total_spent), formatRupiah(c.outstanding)]),
        }, biz);
      } else if (tab === "operator") {
        await shareReportPdf({
          title: `Laporan Per Operator · ${periodLabel}`, subtitle: biz,
          headers: ["Operator", "Transaksi", "Penjualan", "Laba"],
          rows: operators.map((o) => [o.name, o.transaction_count, formatRupiah(o.total_sales), formatRupiah(o.profit)]),
        }, biz);
      } else if (tab === "barang") {
        await shareReportPdf({
          title: `Detail Barang Terjual · ${periodLabel}`, subtitle: biz,
          headers: ["Tanggal", "Invoice", "Pelanggan", "Operator", "Produk", "Qty", "Subtotal"],
          rows: salesItems.map((r) => [
            new Date(r.created_at).toLocaleString("id-ID"),
            r.invoice_no, r.customer_name, r.operator_name,
            `${r.name}${r.unit ? ` (${r.unit})` : ""}`,
            r.quantity, formatRupiah(r.subtotal),
          ]),
          summary: [
            { label: "Total qty", value: String(salesItems.reduce((s, r) => s + r.quantity, 0)) },
            { label: "Total omzet", value: formatRupiah(salesItems.reduce((s, r) => s + r.subtotal, 0)) },
          ],
        }, biz);
      } else if (tab === "transaksi") {
        await shareReportPdf({
          title: `Detail Transaksi Penjualan · ${periodLabel}`, subtitle: biz,
          headers: ["Tanggal & Jam", "Invoice", "Pelanggan", "Operator", "Item", "Total", "Metode"],
          rows: transactions.map((t) => [
            new Date(t.created_at).toLocaleString("id-ID"),
            t.invoice_no,
            t.customer_name,
            t.created_by_name ?? "-",
            String(t.items.length),
            formatRupiah(t.total),
            t.payment_method_label || PAYMENT_LABELS[t.payment_method] || t.payment_method,
          ]),
          summary: [
            { label: "Total transaksi", value: String(transactions.length) },
            { label: "Total omzet", value: formatRupiah(transactions.reduce((s, t) => s + t.total, 0)) },
          ],
        }, biz);
      }
    } catch (e) { toast.error("Gagal membuat PDF", e instanceof Error ? e.message : undefined); }
  };

  const shareReport = async () => {
    if (!report) return;
    const topProducts = products.slice(0, 5).map((p, i) => `${i + 1}. ${p.name} · ${p.quantity} unit · laba ${formatRupiah(p.profit)}`).join("\n");
    const topCustomers = customers.slice(0, 5).map((c, i) => `${i + 1}. ${c.customer_name} · ${c.transaction_count} tx · ${formatRupiah(c.total_spent)}`).join("\n");
    const topOperators = operators.slice(0, 5).map((o, i) => `${i + 1}. ${o.name} · ${o.transaction_count} tx · ${formatRupiah(o.total_sales)}`).join("\n");
    await Share.share({
      title: `Laporan ${user?.business_name}`,
      message: `*Laporan ${user?.business_name} · ${periodLabel}*\n`
        + `Penjualan: ${formatRupiah(report.sales_total)}\n`
        + `Pembelian: ${formatRupiah(report.purchase_total)}\n`
        + `Laba kotor: ${formatRupiah(report.gross_profit)}\n`
        + `Transaksi: ${report.transaction_count}\n`
        + `Piutang: ${formatRupiah(report.receivable)} · Hutang: ${formatRupiah(report.payable)}\n`
        + `Saldo kas: ${formatRupiah(report.cash_balance)}\n\n`
        + (topProducts ? `*Produk terlaris*\n${topProducts}\n\n` : "")
        + (topCustomers ? `*Pelanggan teraktif*\n${topCustomers}\n\n` : "")
        + (topOperators ? `*Kinerja operator*\n${topOperators}` : ""),
    });
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Header eyebrow={user?.business_name} title="Laporan" subtitle="Ringkasan performa bisnis" />
        <SyncBanner />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {([
            { key: "daily", label: "Hari ini" },
            { key: "monthly", label: "Bulan ini" },
            { key: "yearly", label: "Tahun ini" },
          ] as { key: Period; label: string }[]).map((item) => (
            <Pressable key={item.key} testID={`period-${item.key}`} onPress={() => setPeriod(item.key)} style={[styles.chip, period === item.key && styles.chipActive]}>
              <Text style={[styles.chipText, period === item.key && styles.chipTextActive]}>{item.label}</Text>
            </Pressable>
          ))}
          <Pressable testID="period-custom" onPress={openCustom} style={[styles.chip, period === "custom" && styles.chipActive]}>
            <Text style={[styles.chipText, period === "custom" && styles.chipTextActive]}>
              {period === "custom" ? `${customStart} → ${customEnd}` : "Custom periode"}
            </Text>
          </Pressable>
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {([
            { key: "ringkasan", label: "Ringkasan" },
            { key: "produk", label: "Per Produk" },
            { key: "pelanggan", label: "Per Pelanggan" },
            { key: "operator", label: "Per Operator" },
            { key: "barang", label: "Detail Barang" },
            { key: "transaksi", label: "Detail Transaksi" },
          ] as { key: Tab; label: string }[]).map((item) => (
            <Pressable key={item.key} testID={`report-tab-${item.key}`} onPress={() => setTab(item.key)} style={[styles.chip, tab === item.key && styles.chipActive]}>
              <Text style={[styles.chipText, tab === item.key && styles.chipTextActive]}>{item.label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {tab === "ringkasan" ? (
          <>
            <View style={styles.metricGrid}>
              {metrics.map((m) => (
                <Pressable key={m.key} testID={`metric-${m.key}`} onPress={() => openMetric(m.key)} style={({ pressed }) => [styles.metric, pressed && { opacity: 0.7 }]}>
                  <Ionicons name={m.icon} size={22} color={m.color} />
                  <Text style={styles.metricLabel}>{m.label}</Text>
                  <Text style={styles.metricValue}>{m.value}</Text>
                  <Text style={[styles.muted, { fontSize: 10, marginTop: 4 }]}>Ketuk untuk detail</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        {tab === "produk" ? (
          <View style={styles.card} testID="report-produk-list">
            <Text style={styles.cardTitle}>Produk · {periodLabel}</Text>
            {products.length === 0 ? <Text style={[styles.muted, { marginTop: 10 }]}>Belum ada data penjualan.</Text> : products.map((p, idx) => (
              <View key={p.product_id ?? idx} style={styles.listRow}>
                <View style={[styles.settingIcon, { backgroundColor: idx < 3 ? colors.brandPrimary : colors.brandTertiary }]}>
                  <Text style={{ color: idx < 3 ? colors.onBrandPrimary : colors.brandPrimary, fontWeight: "800" }}>{idx + 1}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.productName}>{p.name ?? "-"}</Text>
                  <Text style={styles.muted}>{p.quantity ?? 0} unit · omzet {formatRupiah(p.revenue ?? 0)}</Text>
                </View>
                <Text style={[styles.productName, { color: colors.success }]}>+{formatRupiah(p.profit ?? 0)}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {tab === "pelanggan" ? (
          <View style={styles.card} testID="report-pelanggan-list">
            <Text style={styles.cardTitle}>Pelanggan · {periodLabel}</Text>
            {customers.length === 0 ? <Text style={[styles.muted, { marginTop: 10 }]}>Belum ada transaksi pelanggan.</Text> : customers.map((c, idx) => {
              const cname = (typeof c?.customer_name === "string" && c.customer_name) ? c.customer_name : "Umum";
              return (
              <View key={`${c.customer_id ?? cname}-${idx}`} style={styles.listRow}>
                <View style={styles.avatar}><Text style={styles.avatarText}>{cname.slice(0, 1).toUpperCase()}</Text></View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.productName}>{cname}</Text>
                  <Text style={styles.muted}>{c.transaction_count ?? 0} transaksi · laba {formatRupiah(c.profit ?? 0)}</Text>
                  {(c.outstanding ?? 0) > 0 ? <Text style={{ color: colors.warning, fontSize: 12, marginTop: 3, fontWeight: "700" }}>Piutang {formatRupiah(c.outstanding ?? 0)}</Text> : null}
                </View>
                <Text style={[styles.productName, { color: colors.brandPrimary }]}>{formatRupiah(c.total_spent ?? 0)}</Text>
              </View>
            );})}
          </View>
        ) : null}

        {tab === "operator" ? (
          <View style={styles.card} testID="report-operator-list">
            <Text style={styles.cardTitle}>Operator / karyawan · {periodLabel}</Text>
            {operators.length === 0 ? <Text style={[styles.muted, { marginTop: 10 }]}>Belum ada transaksi operator.</Text> : operators.map((o, idx) => {
              const label = (typeof o?.name === "string" && o.name) ? o.name : "-";
              return (
              <Pressable key={`${o.operator_id ?? label}-${idx}`} testID={`op-row-${o.operator_id ?? "none"}`} onPress={() => openOperator(o)} style={({ pressed }) => [styles.listRow, pressed && { opacity: 0.7 }]}>
                <View style={styles.avatar}><Text style={styles.avatarText}>{label.slice(0, 1).toUpperCase()}</Text></View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.productName}>{label}</Text>
                  <Text style={styles.muted}>{o.transaction_count ?? 0} transaksi · laba {formatRupiah(o.profit ?? 0)}</Text>
                  <Text style={[styles.muted, { fontSize: 10, marginTop: 2 }]}>Ketuk untuk lihat barang terjual</Text>
                </View>
                <Text style={[styles.productName, { color: colors.brandPrimary }]}>{formatRupiah(o.total_sales ?? 0)}</Text>
              </Pressable>
            );})}
          </View>
        ) : null}

        {tab === "barang" ? (
          <View style={styles.card} testID="report-barang-list">
            <Text style={styles.cardTitle}>Detail barang terjual · {periodLabel}</Text>
            <Text style={[styles.muted, { marginTop: 4, marginBottom: 10 }]}>{salesItems.length} baris · total {formatRupiah(salesItems.reduce((s, r) => s + (r?.subtotal ?? 0), 0))}</Text>
            {salesItems.length === 0 ? <Text style={styles.muted}>Belum ada barang terjual.</Text> : salesItems.slice(0, 300).map((r, i) => {
              const safeDate = (() => { try { return new Date(r.created_at).toLocaleString("id-ID"); } catch { return r.created_at ?? "-"; } })();
              return (
              <View key={`${r.transaction_id}-${r.product_id}-${i}`} style={styles.listRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.productName}>{r.name ?? "-"}{r.unit ? ` · ${r.unit}` : ""}</Text>
                  <Text style={styles.muted}>{safeDate} · {r.invoice_no ?? "-"}</Text>
                  <Text style={[styles.muted, { marginTop: 2 }]}>{r.customer_name ?? "Umum"} · oleh {r.operator_name ?? "-"}</Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={styles.productName}>{r.quantity ?? 0} × {formatRupiah(r.price ?? 0)}</Text>
                  <Text style={[styles.muted, { color: colors.success }]}>{formatRupiah(r.subtotal ?? 0)}</Text>
                </View>
              </View>
            );})}
          </View>
        ) : null}

        {tab === "transaksi" ? (
          <View style={styles.card} testID="report-transaksi-list">
            <Text style={styles.cardTitle}>Detail Transaksi Penjualan · {periodLabel}</Text>
            <Text style={[styles.muted, { marginTop: 4, marginBottom: 10 }]}>{transactions.length} transaksi · total omzet {formatRupiah(transactions.reduce((s, t) => s + (t?.total ?? 0), 0))}</Text>
            {transactions.length === 0 ? <Text style={styles.muted}>Belum ada transaksi penjualan.</Text> : transactions.map((t) => {
              const safeDate = (() => {
                try { return new Date(t.created_at).toLocaleString("id-ID"); } catch { return t.created_at ?? "-"; }
              })();
              const itemsLen = Array.isArray(t.items) ? t.items.length : 0;
              return (
              <View key={t.id} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.divider }}>
                <View style={styles.between}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.productName}>{t.invoice_no ?? "-"}</Text>
                    <Text style={styles.muted}>{safeDate}</Text>
                    <Text style={[styles.muted, { marginTop: 2 }]}>{t.customer_name ?? "Umum"} · oleh {t.created_by_name ?? "-"}</Text>
                    <Text style={[styles.muted, { marginTop: 2 }]}>{itemsLen} item · {t.payment_method_label || PAYMENT_LABELS[t.payment_method] || t.payment_method || "-"}</Text>
                  </View>
                  <Text style={[styles.productName, { color: colors.brandPrimary }]}>{formatRupiah(t.total ?? 0)}</Text>
                </View>
                <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                  <Pressable
                    testID={`tx-pdf-${t.id}`}
                    disabled={!settings || pdfBusy === t.id}
                    onPress={async () => {
                      if (!settings) return;
                      setPdfBusy(t.id);
                      try { await shareInvoicePdf(t, settings, "share"); }
                      catch (e) { toast.error("Gagal PDF", e instanceof Error ? e.message : undefined); }
                      finally { setPdfBusy(null); }
                    }}
                    style={[styles.outlineButton, { flex: 1 }, pdfBusy === t.id && { opacity: 0.5 }]}
                  >
                    {pdfBusy === t.id ? <ActivityIndicator color={colors.brandPrimary} /> : <Text style={styles.outlineText}>Bagikan PDF</Text>}
                  </Pressable>
                  <Pressable
                    testID={`tx-wa-${t.id}`}
                    disabled={!settings || pdfBusy === t.id}
                    onPress={async () => {
                      if (!settings) return;
                      setPdfBusy(t.id);
                      try { await shareInvoicePdf(t, settings, "whatsapp"); }
                      catch (e) { toast.error("Gagal WA", e instanceof Error ? e.message : undefined); }
                      finally { setPdfBusy(null); }
                    }}
                    style={[styles.outlineButton, { flex: 1 }, pdfBusy === t.id && { opacity: 0.5 }]}
                  >
                    <Text style={styles.outlineText}>Kirim WA</Text>
                  </Pressable>
                  <Pressable
                    testID={`tx-email-${t.id}`}
                    disabled={!settings || pdfBusy === t.id}
                    onPress={async () => {
                      if (!settings) return;
                      setPdfBusy(t.id);
                      try { await shareInvoicePdf(t, settings, "email"); }
                      catch (e) { toast.error("Gagal email", e instanceof Error ? e.message : undefined); }
                      finally { setPdfBusy(null); }
                    }}
                    style={[styles.outlineButton, { flex: 1 }, pdfBusy === t.id && { opacity: 0.5 }]}
                  >
                    <Text style={styles.outlineText}>Email</Text>
                  </Pressable>
                </View>
              </View>
            );})}
          </View>
        ) : null}

        <Pressable testID="send-pdf" onPress={sendPdf} style={[styles.primaryButton, { marginTop: 10 }]}>
          <Text style={styles.primaryButtonText}>Kirim laporan sebagai PDF</Text>
        </Pressable>
        <Pressable
          testID="send-xlsx"
          disabled={xlsxBusy}
          onPress={async () => {
            if (Platform.OS === "web") return toast.info("Export Excel di aplikasi mobile", "Buka di Expo Go / build Android untuk mengunduh file xlsx.");
            setXlsxBusy(true);
            try {
              const { base64, filename } = await downloadReportsExcel(period, period === "custom" ? customStart : undefined, period === "custom" ? customEnd : undefined);
              const dir = FileSystem.cacheDirectory ?? "";
              const path = `${dir}${filename}`;
              await FileSystem.writeAsStringAsync(path, base64, { encoding: FileSystem.EncodingType.Base64 });
              if (await Sharing.isAvailableAsync()) {
                await Sharing.shareAsync(path, {
                  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                  dialogTitle: "Bagikan laporan Excel",
                  UTI: "org.openxmlformats.spreadsheetml.sheet",
                });
              } else {
                toast.success("File tersimpan", path);
              }
            } catch (e) { toast.error("Export Excel gagal", e instanceof Error ? e.message : undefined); }
            finally { setXlsxBusy(false); }
          }}
          style={[styles.outlineButton, { marginTop: 10 }, xlsxBusy && { opacity: 0.5 }]}
        >
          {xlsxBusy ? <ActivityIndicator color={colors.brandPrimary} /> : <Text style={styles.outlineText}>Export Excel (.xlsx) · multi-sheet</Text>}
        </Pressable>
        <Pressable testID="share-report" onPress={shareReport} style={[styles.outlineButton, { marginTop: 10 }]}>
          <Text style={styles.outlineText}>Bagikan via WhatsApp / Lainnya</Text>
        </Pressable>
      </ScrollView>

      <Modal visible={customOpen} transparent animationType="fade" onRequestClose={() => setCustomOpen(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(28,28,30,0.55)", justifyContent: "center", padding: 24 }}>
          <View style={{ backgroundColor: colors.surface, borderRadius: 20, padding: 20 }}>
            <Text style={styles.cardTitle}>Pilih rentang tanggal</Text>
            <Text style={[styles.muted, { marginTop: 6, marginBottom: 10 }]}>Format: YYYY-MM-DD (contoh 2026-06-01)</Text>
            <Text style={styles.inputLabel}>Dari tanggal</Text>
            <TextInput
              testID="custom-start-input"
              value={draftStart}
              onChangeText={setDraftStart}
              placeholder="2026-06-01"
              placeholderTextColor={colors.muted}
              style={styles.input}
              autoCapitalize="none"
            />
            <Text style={styles.inputLabel}>Sampai tanggal</Text>
            <TextInput
              testID="custom-end-input"
              value={draftEnd}
              onChangeText={setDraftEnd}
              placeholder={todayYmd()}
              placeholderTextColor={colors.muted}
              style={styles.input}
              autoCapitalize="none"
            />
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
              <Pressable testID="preset-7days" onPress={() => {
                const end = new Date();
                const start = new Date();
                start.setDate(start.getDate() - 6);
                const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
                setDraftStart(fmt(start)); setDraftEnd(fmt(end));
              }} style={styles.chip}>
                <Text style={styles.chipText}>7 hari terakhir</Text>
              </Pressable>
              <Pressable testID="preset-30days" onPress={() => {
                const end = new Date();
                const start = new Date();
                start.setDate(start.getDate() - 29);
                const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
                setDraftStart(fmt(start)); setDraftEnd(fmt(end));
              }} style={styles.chip}>
                <Text style={styles.chipText}>30 hari terakhir</Text>
              </Pressable>
              <Pressable testID="preset-lastmonth" onPress={() => {
                const now = new Date();
                const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                const end = new Date(now.getFullYear(), now.getMonth(), 0);
                const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
                setDraftStart(fmt(start)); setDraftEnd(fmt(end));
              }} style={styles.chip}>
                <Text style={styles.chipText}>Bulan lalu</Text>
              </Pressable>
            </View>
            <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
              <Pressable onPress={() => setCustomOpen(false)} style={[styles.outlineButton, { flex: 1 }]}>
                <Text style={styles.outlineText}>Batal</Text>
              </Pressable>
              <Pressable testID="custom-apply" onPress={applyCustom} style={[styles.primaryButton, { flex: 1 }]}>
                <Text style={styles.primaryButtonText}>Terapkan</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={!!metricDetail} transparent animationType="slide" onRequestClose={() => setMetricDetail(null)}>
        <View style={{ flex: 1, backgroundColor: "rgba(28,28,30,0.55)", justifyContent: "flex-end" }}>
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "85%" }}>
            <ScrollView contentContainerStyle={{ padding: 20 }}>
              <View style={styles.between}>
                <Text style={[styles.title, { fontSize: 20 }]}>{metricDetail?.title}</Text>
                <Pressable onPress={() => setMetricDetail(null)}><Ionicons name="close" size={24} color={colors.onSurface} /></Pressable>
              </View>
              {metricDetail?.description ? <Text style={[styles.muted, { marginTop: 4, marginBottom: 10 }]}>{metricDetail.description}</Text> : null}
              {(metricDetail?.rows ?? []).length === 0 ? <Text style={styles.muted}>Belum ada rincian untuk periode ini.</Text> : (metricDetail?.rows ?? []).map((r, i) => (
                <View key={i} style={[styles.listRow]}>
                  <Text style={[styles.productName, { flex: 1 }]}>{r.label}</Text>
                  <Text style={styles.productName}>{r.value}</Text>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={!!operatorDetail} transparent animationType="slide" onRequestClose={() => setOperatorDetail(null)}>
        <View style={{ flex: 1, backgroundColor: "rgba(28,28,30,0.55)", justifyContent: "flex-end" }}>
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "85%" }}>
            <ScrollView contentContainerStyle={{ padding: 20 }}>
              <View style={styles.between}>
                <View>
                  <Text style={[styles.title, { fontSize: 20 }]}>{operatorDetail?.operator.name}</Text>
                  <Text style={styles.muted}>Barang terjual · {periodLabel}</Text>
                </View>
                <Pressable onPress={() => setOperatorDetail(null)}><Ionicons name="close" size={24} color={colors.onSurface} /></Pressable>
              </View>
              {(operatorDetail?.rows ?? []).length === 0 ? <Text style={[styles.muted, { marginTop: 10 }]}>Operator belum menjual barang di periode ini.</Text> : (operatorDetail?.rows ?? []).map((r, i) => (
                <View key={`${r.transaction_id}-${r.product_id}-${i}`} style={styles.listRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.productName}>{r.name}{r.unit ? ` · ${r.unit}` : ""}</Text>
                    <Text style={styles.muted}>{new Date(r.created_at).toLocaleString("id-ID")} · {r.invoice_no}</Text>
                    <Text style={styles.muted}>{r.customer_name}</Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={styles.productName}>{r.quantity} × {formatRupiah(r.price)}</Text>
                    <Text style={[styles.muted, { color: colors.success }]}>{formatRupiah(r.subtotal)}</Text>
                  </View>
                </View>
              ))}
              <Pressable
                testID="operator-pdf"
                onPress={async () => {
                  if (!operatorDetail) return;
                  await shareReportPdf({
                    title: `Barang Terjual · ${operatorDetail.operator.name}`,
                    subtitle: `${periodLabel} · ${user?.business_name ?? ""}`,
                    headers: ["Tanggal", "Invoice", "Pelanggan", "Produk", "Qty", "Subtotal"],
                    rows: operatorDetail.rows.map((r) => [
                      new Date(r.created_at).toLocaleString("id-ID"),
                      r.invoice_no, r.customer_name,
                      `${r.name}${r.unit ? ` (${r.unit})` : ""}`,
                      r.quantity, formatRupiah(r.subtotal),
                    ]),
                    summary: [
                      { label: "Total qty", value: String(operatorDetail.rows.reduce((s, r) => s + r.quantity, 0)) },
                      { label: "Total omzet", value: formatRupiah(operatorDetail.rows.reduce((s, r) => s + r.subtotal, 0)) },
                    ],
                  }, user?.business_name ?? "JTPOIN POS");
                }}
                style={[styles.primaryButton, { marginTop: 10 }]}
              >
                <Text style={styles.primaryButtonText}>Kirim detail PDF</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}
