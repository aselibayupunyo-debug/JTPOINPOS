import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Share, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest, BusinessSettings, CustomerReportRow, formatRupiah, OperatorReportRow, PAYMENT_LABELS, ProductReportRow, ReportSummary, SalesItemRow, TransactionDoc } from "@/src/api";
import { useAppStyles } from "@/src/app-styles";
import { useAuth } from "@/src/auth-context";
import { Header } from "@/src/components/header";
import { SyncBanner } from "@/src/components/sync-banner";
import { shareInvoicePdf, shareReportPdf } from "@/src/pdf";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";

type Period = "daily" | "monthly" | "yearly";
type Tab = "ringkasan" | "produk" | "pelanggan" | "operator" | "barang" | "transaksi";

export default function LaporanScreen() {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user, can } = useAuth();
  const toast = useToast();
  const [period, setPeriod] = useState<Period>("daily");
  const [tab, setTab] = useState<Tab>("ringkasan");
  const [report, setReport] = useState<ReportSummary | null>(null);
  const [products, setProducts] = useState<ProductReportRow[]>([]);
  const [customers, setCustomers] = useState<CustomerReportRow[]>([]);
  const [operators, setOperators] = useState<OperatorReportRow[]>([]);
  const [salesItems, setSalesItems] = useState<SalesItemRow[]>([]);
  const [transactions, setTransactions] = useState<TransactionDoc[]>([]);
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [pdfBusy, setPdfBusy] = useState<string | null>(null);
  const [metricDetail, setMetricDetail] = useState<null | { title: string; rows: { label: string; value: string }[]; description?: string }>(null);
  const [operatorDetail, setOperatorDetail] = useState<null | { operator: OperatorReportRow; rows: SalesItemRow[] }>(null);

  const load = useCallback(async (p: Period) => {
    try {
      const [s, pr, c, op, si, tx] = await Promise.all([
        apiRequest<ReportSummary>(`/reports/summary?period=${p}`),
        apiRequest<{ rows: ProductReportRow[] }>(`/reports/products?period=${p}`),
        apiRequest<{ rows: CustomerReportRow[] }>(`/reports/customers?period=${p}`),
        apiRequest<{ rows: OperatorReportRow[] }>(`/reports/operators?period=${p}`),
        apiRequest<{ rows: SalesItemRow[] }>(`/reports/sales-items?period=${p}`),
        apiRequest<TransactionDoc[]>(`/transactions?kind=sale&limit=500`),
      ]);
      setReport(s); setProducts(pr.rows); setCustomers(c.rows); setOperators(op.rows); setSalesItems(si.rows);
      // Filter transactions by period
      const start = p === "daily" ? new Date(new Date().setHours(0, 0, 0, 0)).toISOString()
        : p === "monthly" ? new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
        : new Date(new Date().getFullYear(), 0, 1).toISOString();
      setTransactions(tx.filter((t) => t.created_at >= start && t.status !== "cancelled"));
    } catch (e) { toast.error("Gagal memuat laporan", e instanceof Error ? e.message : undefined); }
  }, [toast]);

  useFocusEffect(useCallback(() => { load(period); }, [load, period]));
  useEffect(() => { load(period); apiRequest<BusinessSettings>("/settings").then(setSettings).catch(() => undefined); }, [period, load]);

  if (!can("reports")) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top, alignItems: "center", justifyContent: "center", padding: 24 }]}>
        <Ionicons name="lock-closed-outline" size={44} color={colors.muted} />
        <Text style={[styles.title, { fontSize: 22, textAlign: "center", marginTop: 16 }]}>Laporan terkunci</Text>
        <Text style={[styles.subtitle, { textAlign: "center" }]}>Pemilik belum mengaktifkan kewenangan Laporan.</Text>
      </View>
    );
  }

  const periodLabel = period === "daily" ? "Hari ini" : period === "monthly" ? "Bulan ini" : "Tahun ini";

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
      const res = await apiRequest<{ rows: SalesItemRow[] }>(`/reports/sales-items?period=${period}${operator.operator_id ? `&operator_id=${operator.operator_id}` : ""}`);
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
    const biz = user?.business_name ?? "KasirKu Pro";
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
              <View key={p.product_id} style={styles.listRow}>
                <View style={[styles.settingIcon, { backgroundColor: idx < 3 ? colors.brandPrimary : colors.brandTertiary }]}>
                  <Text style={{ color: idx < 3 ? colors.onBrandPrimary : colors.brandPrimary, fontWeight: "800" }}>{idx + 1}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.productName}>{p.name}</Text>
                  <Text style={styles.muted}>{p.quantity} unit · omzet {formatRupiah(p.revenue)}</Text>
                </View>
                <Text style={[styles.productName, { color: colors.success }]}>+{formatRupiah(p.profit)}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {tab === "pelanggan" ? (
          <View style={styles.card} testID="report-pelanggan-list">
            <Text style={styles.cardTitle}>Pelanggan · {periodLabel}</Text>
            {customers.length === 0 ? <Text style={[styles.muted, { marginTop: 10 }]}>Belum ada transaksi pelanggan.</Text> : customers.map((c, idx) => (
              <View key={`${c.customer_id ?? c.customer_name}-${idx}`} style={styles.listRow}>
                <View style={styles.avatar}><Text style={styles.avatarText}>{c.customer_name.slice(0, 1).toUpperCase()}</Text></View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.productName}>{c.customer_name}</Text>
                  <Text style={styles.muted}>{c.transaction_count} transaksi · laba {formatRupiah(c.profit)}</Text>
                  {c.outstanding > 0 ? <Text style={{ color: colors.warning, fontSize: 12, marginTop: 3, fontWeight: "700" }}>Piutang {formatRupiah(c.outstanding)}</Text> : null}
                </View>
                <Text style={[styles.productName, { color: colors.brandPrimary }]}>{formatRupiah(c.total_spent)}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {tab === "operator" ? (
          <View style={styles.card} testID="report-operator-list">
            <Text style={styles.cardTitle}>Operator / karyawan · {periodLabel}</Text>
            {operators.length === 0 ? <Text style={[styles.muted, { marginTop: 10 }]}>Belum ada transaksi operator.</Text> : operators.map((o, idx) => (
              <Pressable key={`${o.operator_id ?? o.name}-${idx}`} testID={`op-row-${o.operator_id ?? "none"}`} onPress={() => openOperator(o)} style={({ pressed }) => [styles.listRow, pressed && { opacity: 0.7 }]}>
                <View style={styles.avatar}><Text style={styles.avatarText}>{o.name.slice(0, 1).toUpperCase()}</Text></View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.productName}>{o.name}</Text>
                  <Text style={styles.muted}>{o.transaction_count} transaksi · laba {formatRupiah(o.profit)}</Text>
                  <Text style={[styles.muted, { fontSize: 10, marginTop: 2 }]}>Ketuk untuk lihat barang terjual</Text>
                </View>
                <Text style={[styles.productName, { color: colors.brandPrimary }]}>{formatRupiah(o.total_sales)}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {tab === "barang" ? (
          <View style={styles.card} testID="report-barang-list">
            <Text style={styles.cardTitle}>Detail barang terjual · {periodLabel}</Text>
            <Text style={[styles.muted, { marginTop: 4, marginBottom: 10 }]}>{salesItems.length} baris · total {formatRupiah(salesItems.reduce((s, r) => s + r.subtotal, 0))}</Text>
            {salesItems.length === 0 ? <Text style={styles.muted}>Belum ada barang terjual.</Text> : salesItems.map((r, i) => (
              <View key={`${r.transaction_id}-${r.product_id}-${i}`} style={styles.listRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.productName}>{r.name}{r.unit ? ` · ${r.unit}` : ""}</Text>
                  <Text style={styles.muted}>{new Date(r.created_at).toLocaleString("id-ID")} · {r.invoice_no}</Text>
                  <Text style={[styles.muted, { marginTop: 2 }]}>{r.customer_name} · oleh {r.operator_name}</Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={styles.productName}>{r.quantity} × {formatRupiah(r.price)}</Text>
                  <Text style={[styles.muted, { color: colors.success }]}>{formatRupiah(r.subtotal)}</Text>
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {tab === "transaksi" ? (
          <View style={styles.card} testID="report-transaksi-list">
            <Text style={styles.cardTitle}>Detail Transaksi Penjualan · {periodLabel}</Text>
            <Text style={[styles.muted, { marginTop: 4, marginBottom: 10 }]}>{transactions.length} transaksi · total omzet {formatRupiah(transactions.reduce((s, t) => s + t.total, 0))}</Text>
            {transactions.length === 0 ? <Text style={styles.muted}>Belum ada transaksi penjualan.</Text> : transactions.map((t) => (
              <View key={t.id} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.divider }}>
                <View style={styles.between}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.productName}>{t.invoice_no}</Text>
                    <Text style={styles.muted}>{new Date(t.created_at).toLocaleString("id-ID")}</Text>
                    <Text style={[styles.muted, { marginTop: 2 }]}>{t.customer_name} · oleh {t.created_by_name ?? "-"}</Text>
                    <Text style={[styles.muted, { marginTop: 2 }]}>{t.items.length} item · {t.payment_method_label || PAYMENT_LABELS[t.payment_method] || t.payment_method}</Text>
                  </View>
                  <Text style={[styles.productName, { color: colors.brandPrimary }]}>{formatRupiah(t.total)}</Text>
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
            ))}
          </View>
        ) : null}

        <Pressable testID="send-pdf" onPress={sendPdf} style={[styles.primaryButton, { marginTop: 10 }]}>
          <Text style={styles.primaryButtonText}>Kirim laporan sebagai PDF</Text>
        </Pressable>
        <Pressable testID="share-report" onPress={shareReport} style={[styles.outlineButton, { marginTop: 10 }]}>
          <Text style={styles.outlineText}>Bagikan via WhatsApp / Lainnya</Text>
        </Pressable>
      </ScrollView>

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
                  }, user?.business_name ?? "KasirKu Pro");
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
