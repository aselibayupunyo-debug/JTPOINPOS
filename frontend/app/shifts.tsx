import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Share, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest, formatRupiah, Shift } from "@/src/api";
import { useAppStyles } from "@/src/app-styles";
import { useAuth } from "@/src/auth-context";
import { Header } from "@/src/components/header";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";

export default function ShiftsScreen() {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { user } = useAuth();
  const [current, setCurrent] = useState<Shift | null>(null);
  const [currentDetail, setCurrentDetail] = useState<Shift | null>(null);
  const [list, setList] = useState<Shift[]>([]);
  const [opening, setOpening] = useState("0");
  const [closing, setClosing] = useState("0");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [cur, rows] = await Promise.all([
        apiRequest<Shift | Record<string, never>>("/shifts/current"),
        apiRequest<Shift[]>("/shifts"),
      ]);
      const activeShift = (cur as Shift).id ? (cur as Shift) : null;
      setCurrent(activeShift);
      setList(rows);
      if (activeShift) {
        const detail = await apiRequest<Shift>(`/shifts/${activeShift.id}`);
        setCurrentDetail(detail);
        setClosing(String(detail.expected_cash ?? 0));
      } else {
        setCurrentDetail(null);
      }
    } catch (e) { toast.error("Gagal memuat shift", e instanceof Error ? e.message : undefined); }
  }, [toast]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openShift = async () => {
    setBusy(true);
    try {
      await apiRequest("/shifts/open", { method: "POST", body: JSON.stringify({ opening_cash: Number(opening.replace(/\D/g, "")) || 0, note }) });
      toast.success("Shift dibuka");
      setOpening("0"); setNote("");
      await load();
    } catch (e) { toast.error("Gagal", e instanceof Error ? e.message : undefined); }
    finally { setBusy(false); }
  };

  const closeShift = async () => {
    if (!current) return;
    setBusy(true);
    try {
      const result = await apiRequest<Shift>(`/shifts/${current.id}/close`, { method: "POST", body: JSON.stringify({ closing_cash: Number(closing.replace(/\D/g, "")) || 0, note }) });
      const summary = `Shift ${result.operator_name}\nSales: ${formatRupiah(result.sales_total)}\nKas awal: ${formatRupiah(result.opening_cash)}\nKas tunai: ${formatRupiah(result.cash_sales)}\nExpected: ${formatRupiah(result.expected_cash)}\nFisik: ${formatRupiah(result.closing_cash)}\nSelisih: ${formatRupiah(result.difference)}`;
      toast.success("Shift ditutup", result.difference === 0 ? "Saldo cocok" : `Selisih ${formatRupiah(result.difference)}`);
      await Share.share({ title: "Rekap Shift", message: summary });
      setClosing("0"); setNote("");
      await load();
    } catch (e) { toast.error("Gagal", e instanceof Error ? e.message : undefined); }
    finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 10 }]} keyboardShouldPersistTaps="handled">
        <View style={styles.between}>
          <Header title="Shift kasir" subtitle={current ? "Shift aktif berjalan" : "Belum buka shift"} />
          <Pressable onPress={() => router.back()}><Ionicons name="chevron-back" size={26} color={colors.onSurface} /></Pressable>
        </View>
        {current && currentDetail ? (
          <>
            <View style={styles.greenCard}>
              <Text style={styles.white}>Shift aktif · {current.operator_name}</Text>
              <Text style={styles.bigWhite}>{formatRupiah(currentDetail.expected_cash)}</Text>
              <Text style={[styles.white, { opacity: 0.78, marginTop: 7 }]}>Ekspektasi laci kas · Dibuka {new Date(current.opened_at).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}</Text>
            </View>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Ringkasan shift</Text>
              <RowStat label="Transaksi" value={String(currentDetail.transaction_count ?? 0)} />
              <RowStat label="Total penjualan" value={formatRupiah(currentDetail.sales_total)} />
              <RowStat label="Tunai masuk" value={formatRupiah(currentDetail.cash_sales)} />
              <RowStat label="Non-tunai" value={formatRupiah(currentDetail.non_cash_sales)} />
              <RowStat label="Kas awal" value={formatRupiah(currentDetail.opening_cash)} />
              <RowStat label="Kas lain-lain masuk" value={formatRupiah(currentDetail.cash_in ?? 0)} />
              <RowStat label="Kas keluar" value={formatRupiah(currentDetail.cash_out ?? 0)} />
              <RowStat label="Ekspektasi akhir" value={formatRupiah(currentDetail.expected_cash)} highlight />
            </View>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Tutup shift</Text>
              <Text style={styles.inputLabel}>Jumlah kas fisik dihitung</Text>
              <TextInput testID="closing-cash" keyboardType="number-pad" value={closing} onChangeText={setClosing} style={styles.input} placeholderTextColor={colors.muted} />
              <Text style={styles.inputLabel}>Catatan (opsional)</Text>
              <TextInput value={note} onChangeText={setNote} style={styles.input} placeholder="Mis: ada selisih kembalian" placeholderTextColor={colors.muted} />
              <Pressable testID="close-shift" disabled={busy} onPress={closeShift} style={[styles.primaryButton, busy && { opacity: 0.5 }]}>
                {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryButtonText}>Tutup shift & bagikan rekap</Text>}
              </Pressable>
            </View>
          </>
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Buka shift baru</Text>
            <Text style={[styles.muted, { marginVertical: 8 }]}>Setiap kasir memiliki shift sendiri untuk saldo kas yang akurat.</Text>
            <Text style={styles.inputLabel}>Kas awal (modal laci)</Text>
            <TextInput testID="opening-cash" keyboardType="number-pad" value={opening} onChangeText={setOpening} style={styles.input} placeholderTextColor={colors.muted} />
            <Text style={styles.inputLabel}>Catatan</Text>
            <TextInput value={note} onChangeText={setNote} style={styles.input} placeholder="Opsional" placeholderTextColor={colors.muted} />
            <Pressable testID="open-shift" disabled={busy} onPress={openShift} style={[styles.primaryButton, busy && { opacity: 0.5 }]}>
              {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryButtonText}>Buka shift</Text>}
            </Pressable>
          </View>
        )}
        <Text style={[styles.cardTitle, { marginTop: 10, marginBottom: 10 }]}>Riwayat shift</Text>
        {list.length === 0 ? <Text style={styles.muted}>Belum ada shift.</Text> : list.map((s) => (
          <View key={s.id} style={styles.card}>
            <View style={styles.between}>
              <View style={{ flex: 1 }}>
                <Text style={styles.productName}>{s.operator_name}</Text>
                <Text style={styles.muted}>{new Date(s.opened_at).toLocaleString("id-ID")} · {s.closed_at ? "Ditutup" : "Aktif"}</Text>
                <Text style={[styles.muted, { marginTop: 4 }]}>Sales {formatRupiah(s.sales_total)} · {s.transaction_count ?? 0} tx</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={[styles.cardTitle, { color: s.difference === 0 ? colors.success : colors.warning }]}>{s.difference === 0 ? "Cocok" : (s.difference > 0 ? "+" : "") + formatRupiah(s.difference)}</Text>
                {s.closed_at ? <Text style={styles.muted}>Fisik {formatRupiah(s.closing_cash)}</Text> : null}
              </View>
            </View>
          </View>
        ))}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function RowStat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  const styles = useAppStyles();
  const { colors } = useTheme();
  return (
    <View style={[styles.between, { paddingVertical: 6 }]}>
      <Text style={styles.muted}>{label}</Text>
      <Text style={[styles.productName, highlight && { color: colors.brandPrimary, fontSize: 16 }]}>{value}</Text>
    </View>
  );
}
