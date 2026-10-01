import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Share, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest, CustomerReportRow, formatRupiah, OperatorReportRow, ProductReportRow, ReportSummary } from "@/src/api";
import { useAppStyles } from "@/src/app-styles";
import { useAuth } from "@/src/auth-context";
import { Header } from "@/src/components/header";
import { SyncBanner } from "@/src/components/sync-banner";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";

type Period = "daily" | "monthly" | "yearly";
type Tab = "ringkasan" | "produk" | "pelanggan" | "operator";

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

  const load = useCallback(async (p: Period) => {
    try {
      const [s, pr, c, op] = await Promise.all([
        apiRequest<ReportSummary>(`/reports/summary?period=${p}`),
        apiRequest<{ rows: ProductReportRow[] }>(`/reports/products?period=${p}`),
        apiRequest<{ rows: CustomerReportRow[] }>(`/reports/customers?period=${p}`),
        apiRequest<{ rows: OperatorReportRow[] }>(`/reports/operators?period=${p}`),
      ]);
      setReport(s); setProducts(pr.rows); setCustomers(c.rows); setOperators(op.rows);
    } catch (e) { toast.error("Gagal memuat laporan", e instanceof Error ? e.message : undefined); }
  }, [toast]);

  useFocusEffect(useCallback(() => { load(period); }, [load, period]));
  useEffect(() => { load(period); }, [period, load]);

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

  const metrics = report ? [
    { label: "Penjualan", value: formatRupiah(report.sales_total), icon: "trending-up" as const, color: colors.brandPrimary },
    { label: "Laba kotor", value: formatRupiah(report.gross_profit), icon: "stats-chart" as const, color: colors.success },
    { label: "Pembelian", value: formatRupiah(report.purchase_total), icon: "cart-outline" as const, color: colors.info },
    { label: "Saldo kas", value: formatRupiah(report.cash_balance), icon: "wallet-outline" as const, color: colors.warning },
    { label: "Piutang", value: formatRupiah(report.receivable), icon: "time-outline" as const, color: colors.warning },
    { label: "Hutang", value: formatRupiah(report.payable), icon: "alert-circle-outline" as const, color: colors.error },
  ] : [];

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
                <View key={m.label} style={styles.metric}>
                  <Ionicons name={m.icon} size={22} color={m.color} />
                  <Text style={styles.metricLabel}>{m.label}</Text>
                  <Text style={styles.metricValue}>{m.value}</Text>
                </View>
              ))}
            </View>
            {report ? (
              <View style={styles.card}>
                <View style={styles.between}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>Aktivitas penjualan</Text>
                    <Text style={styles.muted}>{report.transaction_count} transaksi tercatat</Text>
                  </View>
                  <Ionicons name="bar-chart" size={25} color={colors.brandPrimary} />
                </View>
                <View style={{ height: 120, justifyContent: "flex-end", flexDirection: "row", alignItems: "flex-end", gap: 10, paddingHorizontal: 10, paddingTop: 24 }}>
                  {[0.34, 0.55, 0.42, 0.76, 0.62, 0.9, 0.7].map((h, i) => (
                    <View key={i} style={{ flex: 1, height: `${h * 100}%`, borderRadius: 8, backgroundColor: i === 5 ? colors.brandPrimary : colors.brandTertiary }} />
                  ))}
                </View>
                <Text style={[styles.muted, { textAlign: "center", marginTop: 10 }]}>Visualisasi ringkas · data periode terpilih</Text>
              </View>
            ) : null}
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
              <View key={`${o.operator_id ?? o.name}-${idx}`} style={styles.listRow}>
                <View style={styles.avatar}><Text style={styles.avatarText}>{o.name.slice(0, 1).toUpperCase()}</Text></View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.productName}>{o.name}</Text>
                  <Text style={styles.muted}>{o.transaction_count} transaksi · laba {formatRupiah(o.profit)}</Text>
                </View>
                <Text style={[styles.productName, { color: colors.brandPrimary }]}>{formatRupiah(o.total_sales)}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <Pressable testID="share-report" onPress={shareReport} style={[styles.primaryButton, { marginTop: 6 }]}>
          <Text style={styles.primaryButtonText}>Bagikan via WhatsApp / Lainnya</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
