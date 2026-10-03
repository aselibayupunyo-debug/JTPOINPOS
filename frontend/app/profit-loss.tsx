import Ionicons from "@expo/vector-icons/Ionicons";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest, BusinessSettings, formatRupiah } from "@/src/api";
import { useAppStyles } from "@/src/app-styles";
import { Header } from "@/src/components/header";
import { shareReportPdf } from "@/src/pdf";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";

type Period = "daily" | "monthly" | "yearly";
type PL = {
  gross_sales: number; returns_amount: number; net_sales: number;
  cogs: number; gross_profit: number;
  expenses_total: number; expenses_by_category: { category: string; amount: number }[];
  net_profit: number; margin: number; transaction_count: number;
};

export default function ProfitLossScreen() {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [period, setPeriod] = useState<Period>("monthly");
  const [data, setData] = useState<PL | null>(null);
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await apiRequest<PL>(`/reports/profit-loss?period=${period}`));
      setSettings(await apiRequest<BusinessSettings>("/settings"));
    } catch (e) { toast.error("Gagal memuat", e instanceof Error ? e.message : undefined); }
  }, [period, toast]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const exportPdf = async () => {
    if (!data) return;
    setBusy("pdf");
    try {
      const rows: (string | number)[][] = [
        ["Penjualan Kotor", formatRupiah(data.gross_sales)],
        ["Retur Penjualan", `- ${formatRupiah(data.returns_amount)}`],
        ["Penjualan Bersih", formatRupiah(data.net_sales)],
        ["Harga Pokok Penjualan (HPP)", `- ${formatRupiah(data.cogs)}`],
        ["LABA KOTOR", formatRupiah(data.gross_profit)],
      ];
      for (const e of data.expenses_by_category) rows.push([`Biaya: ${e.category}`, `- ${formatRupiah(e.amount)}`]);
      rows.push(["Total Biaya Operasional", `- ${formatRupiah(data.expenses_total)}`]);
      rows.push(["LABA / RUGI BERSIH", formatRupiah(data.net_profit)]);
      await shareReportPdf({
        title: "Laporan Laba Rugi",
        subtitle: `Periode: ${period === "daily" ? "Hari ini" : period === "monthly" ? "Bulan ini" : "Tahun ini"}`,
        headers: ["Keterangan", "Jumlah"],
        rows,
        summary: [
          { label: "Transaksi", value: `${data.transaction_count}` },
          { label: "Margin", value: `${data.margin.toFixed(2)}%` },
          { label: "Laba Bersih", value: formatRupiah(data.net_profit) },
        ],
      }, settings?.business_name ?? "JTPOIN POS");
      toast.success("PDF siap", "Pilih aplikasi untuk membuka/bagikan.");
    } catch (e) { toast.error("Gagal PDF", e instanceof Error ? e.message : undefined); }
    finally { setBusy(null); }
  };

  const exportCsv = async () => {
    if (!data) return;
    setBusy("csv");
    try {
      const rows = [
        ["Keterangan", "Jumlah"],
        ["Penjualan Kotor", data.gross_sales],
        ["Retur Penjualan", -data.returns_amount],
        ["Penjualan Bersih", data.net_sales],
        ["HPP", -data.cogs],
        ["Laba Kotor", data.gross_profit],
        ...data.expenses_by_category.map((e) => [`Biaya ${e.category}`, -e.amount]),
        ["Total Biaya", -data.expenses_total],
        ["Laba Bersih", data.net_profit],
      ];
      const csv = rows.map((r) => r.map((v) => typeof v === "string" ? `"${v.replace(/"/g, '""')}"` : v).join(",")).join("\n");
      if (Platform.OS === "web") return toast.info("Export CSV", "Fitur ini jalan di aplikasi mobile.");
      const path = `${FileSystem.cacheDirectory ?? ""}laba-rugi-${Date.now()}.csv`;
      await FileSystem.writeAsStringAsync(path, csv, { encoding: FileSystem.EncodingType.UTF8 });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(path, { mimeType: "text/csv", dialogTitle: "Bagikan Laba Rugi" });
      else toast.success("File tersimpan", path);
    } catch (e) { toast.error("Gagal CSV", e instanceof Error ? e.message : undefined); }
    finally { setBusy(null); }
  };

  const Row = ({ label, value, bold, color }: { label: string; value: string; bold?: boolean; color?: string }) => (
    <View style={[styles.listRow, { paddingVertical: 10 }]}>
      <Text style={bold ? styles.cardTitle : styles.productName}>{label}</Text>
      <Text style={[bold ? styles.cardTitle : styles.productName, color ? { color } : undefined]}>{value}</Text>
    </View>
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.between}>
          <Header title="Laporan Laba Rugi" subtitle="Pendapatan vs biaya periode berjalan" />
          <Pressable onPress={() => router.back()}><Ionicons name="chevron-back" size={26} color={colors.onSurface} /></Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {(["daily", "monthly", "yearly"] as const).map((p) => (
            <Pressable key={p} testID={`period-${p}`} onPress={() => setPeriod(p)} style={[styles.chip, period === p && styles.chipActive]}>
              <Text style={[styles.chipText, period === p && styles.chipTextActive]}>{p === "daily" ? "Hari ini" : p === "monthly" ? "Bulan ini" : "Tahun ini"}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <View style={{ flexDirection: "row", gap: 10, marginBottom: 10 }}>
          <Pressable onPress={exportPdf} disabled={busy === "pdf"} style={[styles.outlineButton, { flex: 1 }]}>
            {busy === "pdf" ? <ActivityIndicator /> : <Text style={styles.outlineText}>Bagikan PDF</Text>}
          </Pressable>
          <Pressable onPress={exportCsv} disabled={busy === "csv"} style={[styles.outlineButton, { flex: 1 }]}>
            {busy === "csv" ? <ActivityIndicator /> : <Text style={styles.outlineText}>Bagikan Excel/CSV</Text>}
          </Pressable>
        </View>

        {!data ? <ActivityIndicator color={colors.brandPrimary} /> : (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Pendapatan</Text>
            <Row label="Penjualan Kotor" value={formatRupiah(data.gross_sales)} />
            <Row label="Retur Penjualan" value={`- ${formatRupiah(data.returns_amount)}`} color={colors.error} />
            <Row label="Penjualan Bersih" value={formatRupiah(data.net_sales)} bold />
            <View style={{ height: 10 }} />
            <Text style={styles.cardTitle}>HPP & Laba Kotor</Text>
            <Row label="Harga Pokok" value={`- ${formatRupiah(data.cogs)}`} color={colors.error} />
            <Row label="Laba Kotor" value={formatRupiah(data.gross_profit)} bold />
            <View style={{ height: 10 }} />
            <Text style={styles.cardTitle}>Biaya Operasional</Text>
            {data.expenses_by_category.length === 0 ? (
              <Text style={styles.muted}>Tidak ada biaya di periode ini.</Text>
            ) : data.expenses_by_category.map((e) => (
              <Row key={e.category} label={e.category} value={`- ${formatRupiah(e.amount)}`} color={colors.error} />
            ))}
            <Row label="Total Biaya" value={`- ${formatRupiah(data.expenses_total)}`} bold color={colors.error} />
            <View style={{ height: 10 }} />
            <View style={[styles.listRow, { paddingVertical: 14, borderTopWidth: 2, borderTopColor: colors.brandPrimary }]}>
              <Text style={[styles.cardTitle, { fontSize: 18 }]}>LABA / RUGI BERSIH</Text>
              <Text style={[styles.cardTitle, { fontSize: 20, color: data.net_profit >= 0 ? colors.brandPrimary : colors.error }]}>{formatRupiah(data.net_profit)}</Text>
            </View>
            <Text style={[styles.muted, { textAlign: "right", marginTop: 2 }]}>Margin {data.margin.toFixed(2)}% · {data.transaction_count} transaksi</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
