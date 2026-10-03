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
type ExpItem = { id: string; amount: number; category: string; note: string; payment_method_label: string; created_at: string; created_by_name?: string };
type Data = { total: number; items: ExpItem[]; breakdown: { category: string; amount: number }[] };

export default function ExpenseReportScreen() {
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
      setData(await apiRequest<Data>(`/reports/expenses?period=${period}`));
      setSettings(await apiRequest<BusinessSettings>("/settings"));
    } catch (e) { toast.error("Gagal memuat", e instanceof Error ? e.message : undefined); }
  }, [period, toast]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const exportPdf = async () => {
    if (!data) return;
    setBusy("pdf");
    try {
      await shareReportPdf({
        title: "Laporan Biaya",
        subtitle: `Periode: ${period === "daily" ? "Hari ini" : period === "monthly" ? "Bulan ini" : "Tahun ini"} · Total ${formatRupiah(data.total)}`,
        headers: ["Tanggal", "Pos Biaya", "Keterangan", "Metode", "Jumlah"],
        rows: data.items.map((e) => [
          new Date(e.created_at).toLocaleDateString("id-ID"),
          e.category,
          e.note,
          e.payment_method_label,
          formatRupiah(e.amount),
        ]),
        summary: [
          ...data.breakdown.map((b) => ({ label: b.category, value: formatRupiah(b.amount) })),
          { label: "TOTAL", value: formatRupiah(data.total) },
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
        ["Tanggal", "Pos Biaya", "Keterangan", "Metode", "Jumlah"],
        ...data.items.map((e) => [
          new Date(e.created_at).toLocaleDateString("id-ID"),
          `"${e.category.replace(/"/g, '""')}"`,
          `"${(e.note || "").replace(/"/g, '""')}"`,
          `"${e.payment_method_label.replace(/"/g, '""')}"`,
          e.amount,
        ]),
      ];
      const csv = rows.map((r) => r.join(",")).join("\n");
      if (Platform.OS === "web") return toast.info("Export CSV", "Fitur ini jalan di aplikasi mobile.");
      const path = `${FileSystem.cacheDirectory ?? ""}laporan-biaya-${Date.now()}.csv`;
      await FileSystem.writeAsStringAsync(path, csv, { encoding: FileSystem.EncodingType.UTF8 });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(path, { mimeType: "text/csv", dialogTitle: "Bagikan Laporan Biaya" });
      else toast.success("File tersimpan", path);
    } catch (e) { toast.error("Gagal", e instanceof Error ? e.message : undefined); }
    finally { setBusy(null); }
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.between}>
          <Header title="Laporan Biaya" subtitle={`Total ${data ? formatRupiah(data.total) : "-"}`} />
          <Pressable onPress={() => router.back()}><Ionicons name="chevron-back" size={26} color={colors.onSurface} /></Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {(["daily", "monthly", "yearly"] as const).map((p) => (
            <Pressable key={p} onPress={() => setPeriod(p)} style={[styles.chip, period === p && styles.chipActive]}>
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

        {data && data.breakdown.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Per Pos Biaya</Text>
            {data.breakdown.map((b) => {
              const pct = data.total > 0 ? (b.amount / data.total) * 100 : 0;
              return (
                <View key={b.category} style={{ paddingVertical: 8 }}>
                  <View style={styles.between}>
                    <Text style={styles.productName}>{b.category}</Text>
                    <Text style={[styles.productName, { color: colors.error }]}>{formatRupiah(b.amount)}</Text>
                  </View>
                  <View style={{ height: 6, backgroundColor: colors.surfaceTertiary, borderRadius: 3, marginTop: 4, overflow: "hidden" }}>
                    <View style={{ height: 6, backgroundColor: colors.brandPrimary, width: `${pct}%` }} />
                  </View>
                </View>
              );
            })}
          </View>
        ) : null}

        {(data?.items ?? []).length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="receipt-outline" size={44} color={colors.muted} />
            <Text style={[styles.muted, { marginTop: 10 }]}>Belum ada biaya di periode ini.</Text>
          </View>
        ) : (data?.items ?? []).map((e) => (
          <View key={e.id} style={styles.listRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.productName}>{e.category}</Text>
              <Text style={styles.muted}>{new Date(e.created_at).toLocaleString("id-ID")} · {e.payment_method_label}</Text>
              {e.note ? <Text style={[styles.muted, { fontSize: 11 }]}>{e.note}</Text> : null}
            </View>
            <Text style={{ fontWeight: "800", color: colors.error }}>- {formatRupiah(e.amount)}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
