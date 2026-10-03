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
type Row = { created_at: string; product_name: string; kind: string; reference: string; delta: number; actor: string };
type Data = { rows: Row[]; stock_in: number; stock_out: number; movement_count: number; products: any[] };

const KIND_LABEL: Record<string, string> = {
  sale: "Penjualan", purchase: "Pembelian",
  sale_return: "Retur Jual", purchase_return: "Retur Beli",
  adjustment: "Penyesuaian",
};

export default function StockTrackingScreen() {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [period, setPeriod] = useState<Period>("monthly");
  const [data, setData] = useState<Data | null>(null);
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await apiRequest<Data>(`/reports/stock-tracking?period=${period}`));
      setSettings(await apiRequest<BusinessSettings>("/settings"));
    } catch (e) { toast.error("Gagal memuat", e instanceof Error ? e.message : undefined); }
  }, [period, toast]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const exportPdf = async () => {
    if (!data) return;
    setBusy("pdf");
    try {
      await shareReportPdf({
        title: "Laporan Tracking Stok",
        subtitle: `Periode: ${period === "daily" ? "Hari ini" : period === "monthly" ? "Bulan ini" : "Tahun ini"} · ${data.movement_count} pergerakan`,
        headers: ["Tanggal", "Produk", "Jenis", "Referensi", "Perubahan", "Operator"],
        rows: data.rows.map((r) => [
          new Date(r.created_at).toLocaleString("id-ID"),
          r.product_name,
          KIND_LABEL[r.kind] || r.kind,
          r.reference,
          (r.delta > 0 ? "+" : "") + r.delta,
          r.actor,
        ]),
        summary: [
          { label: "Total Masuk", value: `+${data.stock_in}` },
          { label: "Total Keluar", value: `-${data.stock_out}` },
          { label: "Netto", value: String(data.stock_in - data.stock_out) },
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
      const header = ["Tanggal", "Produk", "Jenis", "Referensi", "Perubahan", "Operator"];
      const rows = data.rows.map((r) => [
        new Date(r.created_at).toLocaleString("id-ID"),
        `"${(r.product_name || "").replace(/"/g, '""')}"`,
        KIND_LABEL[r.kind] || r.kind,
        `"${(r.reference || "").replace(/"/g, '""')}"`,
        String(r.delta),
        `"${(r.actor || "").replace(/"/g, '""')}"`,
      ].join(","));
      const csv = [header.join(","), ...rows].join("\n");
      if (Platform.OS === "web") return toast.info("Export CSV", "Fitur ini jalan di aplikasi mobile.");
      const path = `${FileSystem.cacheDirectory ?? ""}tracking-stok-${Date.now()}.csv`;
      await FileSystem.writeAsStringAsync(path, csv, { encoding: FileSystem.EncodingType.UTF8 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path, { mimeType: "text/csv", dialogTitle: "Bagikan Laporan Tracking Stok" });
      } else { toast.success("File tersimpan", path); }
    } catch (e) { toast.error("Gagal CSV", e instanceof Error ? e.message : undefined); }
    finally { setBusy(null); }
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.between}>
          <Header title="Tracking Stok" subtitle={`${data?.movement_count ?? 0} pergerakan periode`} />
          <Pressable onPress={() => router.back()}><Ionicons name="chevron-back" size={26} color={colors.onSurface} /></Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {(["daily", "monthly", "yearly"] as const).map((p) => (
            <Pressable key={p} testID={`period-${p}`} onPress={() => setPeriod(p)} style={[styles.chip, period === p && styles.chipActive]}>
              <Text style={[styles.chipText, period === p && styles.chipTextActive]}>{p === "daily" ? "Hari ini" : p === "monthly" ? "Bulan ini" : "Tahun ini"}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <View style={[styles.card, { flexDirection: "row", gap: 10 }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.muted}>Masuk</Text>
            <Text style={[styles.cardTitle, { color: colors.brandPrimary }]}>+ {data?.stock_in ?? 0}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.muted}>Keluar</Text>
            <Text style={[styles.cardTitle, { color: colors.error }]}>- {data?.stock_out ?? 0}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.muted}>Netto</Text>
            <Text style={styles.cardTitle}>{(data?.stock_in ?? 0) - (data?.stock_out ?? 0)}</Text>
          </View>
        </View>

        <View style={{ flexDirection: "row", gap: 10, marginBottom: 10 }}>
          <Pressable testID="exp-pdf" onPress={exportPdf} disabled={busy === "pdf"} style={[styles.outlineButton, { flex: 1 }]}>
            {busy === "pdf" ? <ActivityIndicator /> : <Text style={styles.outlineText}>Bagikan PDF</Text>}
          </Pressable>
          <Pressable testID="exp-csv" onPress={exportCsv} disabled={busy === "csv"} style={[styles.outlineButton, { flex: 1 }]}>
            {busy === "csv" ? <ActivityIndicator /> : <Text style={styles.outlineText}>Bagikan Excel/CSV</Text>}
          </Pressable>
        </View>

        {(data?.rows ?? []).length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="trending-up-outline" size={44} color={colors.muted} />
            <Text style={[styles.muted, { marginTop: 10 }]}>Belum ada pergerakan stok.</Text>
          </View>
        ) : (data?.rows ?? []).slice(0, 300).map((r, idx) => (
          <View key={idx} style={styles.listRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.productName}>{r.product_name}</Text>
              <Text style={styles.muted}>{new Date(r.created_at).toLocaleString("id-ID")} · {KIND_LABEL[r.kind] || r.kind}</Text>
              <Text style={[styles.muted, { fontSize: 11 }]}>{r.reference}{r.actor ? ` · ${r.actor}` : ""}</Text>
            </View>
            <Text style={{ fontWeight: "800", color: r.delta > 0 ? colors.brandPrimary : colors.error }}>{r.delta > 0 ? "+" : ""}{r.delta}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
