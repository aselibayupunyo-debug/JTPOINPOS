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
type Tax = {
  tax_out: number; tax_in: number; dpp_out: number; dpp_in: number;
  net_tax: number; sales_count: number; purchase_count: number;
  details: { invoice_no: string; created_at: string; customer_name: string; total: number; tax_amount: number; dpp: number }[];
};

export default function TaxReportScreen() {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [period, setPeriod] = useState<Period>("monthly");
  const [data, setData] = useState<Tax | null>(null);
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await apiRequest<Tax>(`/reports/tax-summary?period=${period}`));
      setSettings(await apiRequest<BusinessSettings>("/settings"));
    } catch (e) { toast.error("Gagal memuat", e instanceof Error ? e.message : undefined); }
  }, [period, toast]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const exportPdf = async () => {
    if (!data) return;
    setBusy("pdf");
    try {
      await shareReportPdf({
        title: "Rekap Pajak",
        subtitle: `Periode: ${period === "daily" ? "Hari ini" : period === "monthly" ? "Bulan ini" : "Tahun ini"}`,
        headers: ["No. Invoice", "Tanggal", "Customer", "DPP", "Pajak", "Total"],
        rows: data.details.map((d) => [
          d.invoice_no,
          new Date(d.created_at).toLocaleDateString("id-ID"),
          d.customer_name,
          formatRupiah(d.dpp),
          formatRupiah(d.tax_amount),
          formatRupiah(d.total),
        ]),
        summary: [
          { label: "DPP Keluaran", value: formatRupiah(data.dpp_out) },
          { label: "Pajak Keluaran", value: formatRupiah(data.tax_out) },
          { label: "DPP Masukan", value: formatRupiah(data.dpp_in) },
          { label: "Pajak Masukan", value: formatRupiah(data.tax_in) },
          { label: "Pajak Netto Dibayar", value: formatRupiah(data.net_tax) },
        ],
      }, settings?.business_name ?? "JTPOIN POS");
      toast.success("PDF siap");
    } catch (e) { toast.error("Gagal", e instanceof Error ? e.message : undefined); }
    finally { setBusy(null); }
  };

  const exportCsv = async () => {
    if (!data) return;
    setBusy("csv");
    try {
      const rows = [
        ["No. Invoice", "Tanggal", "Customer", "DPP", "Pajak", "Total"],
        ...data.details.map((d) => [
          d.invoice_no,
          new Date(d.created_at).toLocaleDateString("id-ID"),
          `"${(d.customer_name || "").replace(/"/g, '""')}"`,
          d.dpp,
          d.tax_amount,
          d.total,
        ]),
      ];
      const csv = rows.map((r) => r.join(",")).join("\n");
      if (Platform.OS === "web") return toast.info("Export CSV", "Fitur ini jalan di aplikasi mobile.");
      const path = `${FileSystem.cacheDirectory ?? ""}rekap-pajak-${Date.now()}.csv`;
      await FileSystem.writeAsStringAsync(path, csv, { encoding: FileSystem.EncodingType.UTF8 });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(path, { mimeType: "text/csv", dialogTitle: "Bagikan Rekap Pajak" });
      else toast.success("File tersimpan", path);
    } catch (e) { toast.error("Gagal", e instanceof Error ? e.message : undefined); }
    finally { setBusy(null); }
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.between}>
          <Header title="Rekap Pajak" subtitle="Pajak keluaran vs masukan periode berjalan" />
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

        {!data ? <ActivityIndicator /> : (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Pajak Keluaran (Penjualan)</Text>
              <View style={styles.listRow}><Text style={styles.productName}>DPP</Text><Text style={styles.productName}>{formatRupiah(data.dpp_out)}</Text></View>
              <View style={styles.listRow}><Text style={styles.productName}>PPN</Text><Text style={[styles.productName, { color: colors.brandPrimary }]}>{formatRupiah(data.tax_out)}</Text></View>
              <Text style={styles.muted}>{data.sales_count} transaksi</Text>
            </View>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Pajak Masukan (Pembelian)</Text>
              <View style={styles.listRow}><Text style={styles.productName}>DPP</Text><Text style={styles.productName}>{formatRupiah(data.dpp_in)}</Text></View>
              <View style={styles.listRow}><Text style={styles.productName}>PPN</Text><Text style={[styles.productName, { color: colors.warning }]}>{formatRupiah(data.tax_in)}</Text></View>
              <Text style={styles.muted}>{data.purchase_count} transaksi</Text>
            </View>
            <View style={[styles.card, { backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandPrimary }]}>
              <Text style={[styles.cardTitle, { color: colors.brandPrimary }]}>Pajak Netto Terhutang</Text>
              <Text style={[styles.cardTitle, { fontSize: 24, color: colors.brandPrimary, marginTop: 6 }]}>{formatRupiah(data.net_tax)}</Text>
              <Text style={[styles.muted, { marginTop: 4 }]}>Pajak Keluaran − Pajak Masukan</Text>
            </View>

            <Text style={[styles.cardTitle, { marginTop: 6, marginBottom: 8 }]}>Rincian faktur bermasuk pajak</Text>
            {data.details.length === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="document-text-outline" size={40} color={colors.muted} />
                <Text style={[styles.muted, { marginTop: 8 }]}>Tidak ada faktur pajak di periode ini. Pastikan pajak diaktifkan di Pengaturan Transaksi.</Text>
              </View>
            ) : data.details.map((d, idx) => (
              <View key={idx} style={styles.listRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.productName}>{d.invoice_no}</Text>
                  <Text style={styles.muted}>{new Date(d.created_at).toLocaleDateString("id-ID")} · {d.customer_name}</Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={styles.productName}>{formatRupiah(d.total)}</Text>
                  <Text style={{ color: colors.brandPrimary, fontSize: 12, fontWeight: "800" }}>Pajak {formatRupiah(d.tax_amount)}</Text>
                </View>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}
