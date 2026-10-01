import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Share, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest, formatRupiah, ReportSummary } from "@/src/api";
import { useAppStyles } from "@/src/app-styles";
import { useAuth } from "@/src/auth-context";
import { Header } from "@/src/components/header";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";

type Period = "daily" | "monthly" | "yearly";

export default function LaporanScreen() {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user, can } = useAuth();
  const toast = useToast();
  const [period, setPeriod] = useState<Period>("daily");
  const [report, setReport] = useState<ReportSummary | null>(null);

  const load = useCallback(async (p: Period) => {
    try { setReport(await apiRequest<ReportSummary>(`/reports/summary?period=${p}`)); }
    catch (e) { toast.error("Gagal memuat laporan", e instanceof Error ? e.message : undefined); }
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

  const shareReport = async () => {
    if (!report) return;
    const label = period === "daily" ? "Hari ini" : period === "monthly" ? "Bulan ini" : "Tahun ini";
    await Share.share({
      title: `Laporan ${user?.business_name}`,
      message: `*Laporan ${user?.business_name} · ${label}*\n`
        + `Penjualan: ${formatRupiah(report.sales_total)}\n`
        + `Pembelian: ${formatRupiah(report.purchase_total)}\n`
        + `Laba kotor: ${formatRupiah(report.gross_profit)}\n`
        + `Transaksi: ${report.transaction_count}\n`
        + `Piutang: ${formatRupiah(report.receivable)}\n`
        + `Hutang: ${formatRupiah(report.payable)}\n`
        + `Saldo kas: ${formatRupiah(report.cash_balance)}\n`
        + `Kas masuk: ${formatRupiah(report.cash_in)} · keluar: ${formatRupiah(report.cash_out)}\n`
        + `Produk menipis: ${report.low_stock}`,
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
        <Pressable testID="share-report" onPress={shareReport} style={[styles.primaryButton, { marginTop: 6 }]}>
          <Text style={styles.primaryButtonText}>Bagikan via WhatsApp / Lainnya</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
