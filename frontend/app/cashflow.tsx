import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest, CashEntry, formatRupiah, ReportSummary } from "@/src/api";
import { useAppStyles } from "@/src/app-styles";
import { Header } from "@/src/components/header";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";

export default function CashflowScreen() {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [entries, setEntries] = useState<CashEntry[]>([]);
  const [report, setReport] = useState<ReportSummary | null>(null);
  const [kind, setKind] = useState<"income" | "expense">("income");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("Lainnya");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const [e, r] = await Promise.all([apiRequest<CashEntry[]>("/cash-entries?limit=50"), apiRequest<ReportSummary>("/reports/summary?period=daily")]);
      setEntries(e); setReport(r);
    } catch (err) { toast.error("Gagal memuat kas", err instanceof Error ? err.message : undefined); }
  };
  useEffect(() => { load(); }, []);

  const submit = async () => {
    const num = Number(amount.replace(/\D/g, ""));
    if (!num) return toast.error("Nominal tidak valid");
    setBusy(true);
    try {
      await apiRequest("/cash-entries", {
        method: "POST",
        body: JSON.stringify({ entry_type: kind, amount: num, category: category.trim() || "Lainnya", note }),
      });
      toast.success(kind === "income" ? "Kas masuk tercatat" : "Kas keluar tercatat");
      setAmount(""); setNote("");
      await load();
    } catch (e) { toast.error("Gagal menyimpan", e instanceof Error ? e.message : undefined); }
    finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 10 }]} keyboardShouldPersistTaps="handled">
        <View style={styles.between}>
          <Header title="Arus kas" subtitle="Catat kas masuk, keluar, dan saldo harian" />
          <Pressable onPress={() => router.back()}><Ionicons name="chevron-back" size={26} color={colors.onSurface} /></Pressable>
        </View>
        {report ? (
          <View style={styles.greenCard}>
            <Text style={styles.white}>Saldo kas hari ini</Text>
            <Text style={styles.bigWhite}>{formatRupiah(report.cash_balance)}</Text>
            <Text style={[styles.white, { opacity: 0.78, marginTop: 7 }]}>Masuk {formatRupiah(report.cash_in)} · Keluar {formatRupiah(report.cash_out)}</Text>
          </View>
        ) : null}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Tambah entri</Text>
          <View style={{ flexDirection: "row", gap: 8, marginVertical: 12 }}>
            {(["income", "expense"] as const).map((k) => (
              <Pressable key={k} testID={`cash-kind-${k}`} onPress={() => setKind(k)} style={[{ flex: 1, minHeight: 44, borderRadius: 12, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" }, kind === k && { backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandPrimary }]}>
                <Text style={{ color: colors.onSurfaceTertiary, fontSize: 13, fontWeight: "800" }}>{k === "income" ? "Kas masuk" : "Kas keluar"}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.inputLabel}>Nominal</Text>
          <TextInput testID="cash-amount" value={amount} onChangeText={setAmount} keyboardType="number-pad" style={styles.input} placeholder="50000" placeholderTextColor={colors.muted} />
          <Text style={styles.inputLabel}>Kategori</Text>
          <TextInput value={category} onChangeText={setCategory} style={styles.input} placeholder="Mis: Gaji, Listrik, Modal" placeholderTextColor={colors.muted} />
          <Text style={styles.inputLabel}>Catatan</Text>
          <TextInput value={note} onChangeText={setNote} style={styles.input} placeholder="Opsional" placeholderTextColor={colors.muted} />
          <Pressable testID="cash-submit" disabled={busy} onPress={submit} style={[styles.primaryButton, busy && { opacity: 0.5 }]}>
            {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryButtonText}>Simpan entri</Text>}
          </Pressable>
        </View>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Riwayat</Text>
          {entries.length === 0 ? <Text style={[styles.muted, { marginTop: 10 }]}>Belum ada entri.</Text> : entries.map((e) => (
            <View key={e.id} style={styles.listRow}>
              <View style={styles.settingIcon}>
                <Ionicons name={e.entry_type === "income" ? "arrow-up-circle" : "arrow-down-circle"} size={22} color={e.entry_type === "income" ? colors.success : colors.error} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.productName}>{e.category}</Text>
                <Text style={styles.muted}>{e.note || new Date(e.created_at).toLocaleString("id-ID")}</Text>
              </View>
              <Text style={{ color: e.entry_type === "income" ? colors.success : colors.error, fontWeight: "800" }}>{e.entry_type === "income" ? "+" : "-"}{formatRupiah(e.amount)}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
