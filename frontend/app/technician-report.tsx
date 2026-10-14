import Ionicons from "@expo/vector-icons/Ionicons";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest, BusinessSettings, formatRupiah } from "@/src/api";
import { useAppStyles } from "@/src/app-styles";
import { Header } from "@/src/components/header";
import { shareReportPdf } from "@/src/pdf";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";

type Period = "daily" | "monthly" | "yearly" | "custom";
type Service = { name: string; quantity: number; total: number; commission: number };
type Row = { technician_id: string; name: string; position: string; count: number; quantity: number; total: number; commission: number; services: Service[] };
type Detail = { created_at: string; invoice_no: string; technician_name: string; service: string; quantity: number; total: number; commission: number };
type Data = { summary: Row[]; details: Detail[]; total: number; commission: number; count: number };

const LABEL: Record<Period, string> = { daily: "Hari ini", monthly: "Bulan ini", yearly: "Tahun ini", custom: "Kustom" };
const csvCell = (v: string | number) => (typeof v === "number" ? String(v) : `"${v.replace(/"/g, '""')}"`);

export default function TechnicianReportScreen() {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const [period, setPeriod] = useState<Period>("monthly");
  const [start, setStart] = useState(today.slice(0, 8) + "01");
  const [end, setEnd] = useState(today);
  const [data, setData] = useState<Data | null>(null);
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const query = period === "custom" ? `period=custom&start=${start}&end=${end}` : `period=${period}`;
  const periodText = period === "custom" ? `${start} s/d ${end}` : LABEL[period];

  const load = useCallback(async () => {
    try {
      setData(await apiRequest<Data>(`/reports/technicians?${query}`));
      setSettings(await apiRequest<BusinessSettings>("/settings"));
    } catch (e) { toast.error("Gagal memuat", e instanceof Error ? e.message : undefined); }
  }, [query, toast]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const exportPdf = async () => {
    if (!data) return;
    setBusy("pdf");
    try {
      await shareReportPdf({
        title: "Laporan Pencapaian Karyawan Teknis",
        subtitle: `Periode: ${periodText} · Total jasa ${formatRupiah(data.total)} · Komisi ${formatRupiah(data.commission)}`,
        headers: ["Karyawan", "Jasa", "Qty", "Nilai Jasa", "Komisi"],
        rows: data.summary.flatMap((r) => [
          [`${r.name}${r.position ? ` (${r.position})` : ""}`, "TOTAL", String(r.quantity), formatRupiah(r.total), formatRupiah(r.commission)],
          ...r.services.map((s) => ["", s.name, String(s.quantity), formatRupiah(s.total), formatRupiah(s.commission)]),
        ]),
        summary: [
          ...data.summary.map((r) => ({ label: r.name, value: `${formatRupiah(r.total)} · komisi ${formatRupiah(r.commission)}` })),
          { label: "TOTAL KOMISI", value: formatRupiah(data.commission) },
        ],
      }, settings?.business_name ?? "JTPOIN POS");
      toast.success("PDF siap");
    } catch (e) { toast.error("Gagal", e instanceof Error ? e.message : undefined); }
    finally { setBusy(null); }
  };

  const exportCsv = async () => {
    if (!data) return;
    if (Platform.OS === "web") return toast.info("Export Excel", "Fitur ini jalan di aplikasi mobile.");
    setBusy("csv");
    try {
      const rows: (string | number)[][] = [
        ["RINGKASAN", periodText],
        ["Karyawan", "Jabatan", "Jumlah Jasa", "Nilai Jasa", "Komisi"],
        ...data.summary.map((r) => [r.name, r.position, r.quantity, r.total, r.commission]),
        [],
        ["RINCIAN PER JASA"],
        ["Karyawan", "Jasa", "Qty", "Nilai Jasa", "Komisi"],
        ...data.summary.flatMap((r) => r.services.map((s) => [r.name, s.name, s.quantity, s.total, s.commission])),
        [],
        ["RINCIAN TRANSAKSI"],
        ["Tanggal", "Invoice", "Karyawan", "Jasa", "Qty", "Nilai Jasa", "Komisi"],
        ...data.details.map((d) => [new Date(d.created_at).toLocaleString("id-ID"), d.invoice_no, d.technician_name, d.service, d.quantity, d.total, d.commission]),
      ];
      const csv = rows.map((r) => r.map(csvCell).join(",")).join("\n");
      const path = `${FileSystem.cacheDirectory ?? ""}laporan-karyawan-teknis-${Date.now()}.csv`;
      await FileSystem.writeAsStringAsync(path, csv, { encoding: FileSystem.EncodingType.UTF8 });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(path, { mimeType: "text/csv", dialogTitle: "Bagikan Laporan Karyawan Teknis" });
      else toast.success("File tersimpan", path);
    } catch (e) { toast.error("Gagal", e instanceof Error ? e.message : undefined); }
    finally { setBusy(null); }
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.between}>
          <Header title="Pencapaian Teknisi" subtitle={`Periode: ${periodText}`} />
          <Pressable onPress={() => router.back()} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}><Ionicons name="chevron-back" size={26} color={colors.onSurface} /></Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {(Object.keys(LABEL) as Period[]).map((p) => (
            <Pressable key={p} testID={`period-${p}`} onPress={() => setPeriod(p)} style={[styles.chip, period === p && styles.chipActive]}>
              <Text style={[styles.chipText, period === p && styles.chipTextActive]}>{LABEL[p]}</Text>
            </Pressable>
          ))}
        </ScrollView>
        {period === "custom" ? (
          <View style={{ flexDirection: "row", gap: 10 }}>
            <TextInput testID="custom-start" value={start} onChangeText={setStart} placeholder="YYYY-MM-DD" placeholderTextColor={colors.muted} style={[styles.input, { flex: 1 }]} />
            <TextInput testID="custom-end" value={end} onChangeText={setEnd} placeholder="YYYY-MM-DD" placeholderTextColor={colors.muted} style={[styles.input, { flex: 1 }]} />
          </View>
        ) : null}

        <View style={styles.metricGrid}>
          <View style={styles.metric}><Text style={styles.metricLabel}>Total nilai jasa</Text><Text style={styles.metricValue}>{formatRupiah(data?.total ?? 0)}</Text></View>
          <View style={styles.metric}><Text style={styles.metricLabel}>Total komisi</Text><Text style={[styles.metricValue, { color: colors.brandPrimary }]}>{formatRupiah(data?.commission ?? 0)}</Text></View>
        </View>

        <View style={{ flexDirection: "row", gap: 10, marginBottom: 14 }}>
          <Pressable testID="export-pdf" onPress={exportPdf} disabled={busy === "pdf"} style={[styles.outlineButton, { flex: 1 }]}>
            {busy === "pdf" ? <ActivityIndicator /> : <Text style={styles.outlineText}>Bagikan PDF</Text>}
          </Pressable>
          <Pressable testID="export-csv" onPress={exportCsv} disabled={busy === "csv"} style={[styles.outlineButton, { flex: 1 }]}>
            {busy === "csv" ? <ActivityIndicator /> : <Text style={styles.outlineText}>Bagikan Excel/CSV</Text>}
          </Pressable>
        </View>

        {(data?.summary ?? []).length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="construct-outline" size={44} color={colors.muted} />
            <Text style={[styles.muted, { marginTop: 10, textAlign: "center" }]}>Belum ada jasa yang dikerjakan karyawan teknis di periode ini.</Text>
          </View>
        ) : data!.summary.map((r) => (
          <Pressable key={r.technician_id} testID={`tech-row-${r.technician_id}`} onPress={() => setExpanded(expanded === r.technician_id ? null : r.technician_id)} style={styles.card}>
            <View style={styles.between}>
              <View style={{ flex: 1 }}>
                <Text style={styles.productName}>{r.name}</Text>
                <Text style={styles.muted}>{r.position ? `${r.position} · ` : ""}{r.quantity} jasa</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={styles.productName}>{formatRupiah(r.total)}</Text>
                <Text style={[styles.muted, { color: colors.brandPrimary, fontWeight: "700" }]}>Komisi {formatRupiah(r.commission)}</Text>
              </View>
              <Ionicons name={expanded === r.technician_id ? "chevron-up" : "chevron-down"} size={18} color={colors.muted} style={{ marginLeft: 8 }} />
            </View>
            {expanded === r.technician_id ? r.services.map((s) => (
              <View key={s.name} style={[styles.between, { paddingTop: 10, marginTop: 10, borderTopWidth: 1, borderTopColor: colors.divider }]}>
                <Text style={[styles.muted, { flex: 1, color: colors.onSurface }]}>{s.name} × {s.quantity}</Text>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={styles.muted}>{formatRupiah(s.total)}</Text>
                  <Text style={[styles.muted, { color: colors.brandPrimary }]}>{formatRupiah(s.commission)}</Text>
                </View>
              </View>
            )) : null}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
