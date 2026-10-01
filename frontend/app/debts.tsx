import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest, formatRupiah, TransactionDoc } from "@/src/api";
import { useAppStyles } from "@/src/app-styles";
import { Header } from "@/src/components/header";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";

type Kind = "receivable" | "payable";

export default function DebtsScreen() {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [kind, setKind] = useState<Kind>("receivable");
  const [data, setData] = useState<{ total: number; items: TransactionDoc[] }>({ total: 0, items: [] });
  const [active, setActive] = useState<TransactionDoc | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async (k: Kind) => {
    try { setData(await apiRequest<{ total: number; items: TransactionDoc[] }>(`/debts?kind=${k}`)); }
    catch (e) { toast.error("Gagal memuat", e instanceof Error ? e.message : undefined); }
  };
  useEffect(() => { load(kind); }, [kind]);

  const pay = async () => {
    if (!active) return;
    const num = Number(amount.replace(/\D/g, ""));
    if (!num) return toast.error("Nominal tidak valid");
    setBusy(true);
    try {
      await apiRequest(`/transactions/${active.id}/pay`, { method: "POST", body: JSON.stringify({ amount: num, note }) });
      toast.success("Pembayaran dicatat", `${formatRupiah(num)} untuk ${active.invoice_no}`);
      setActive(null); setAmount(""); setNote("");
      await load(kind);
    } catch (e) { toast.error("Gagal", e instanceof Error ? e.message : undefined); }
    finally { setBusy(false); }
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.between}>
          <Header title="Hutang & Piutang" subtitle="Lunasi transaksi kredit yang masih berjalan" />
          <Pressable onPress={() => router.back()}><Ionicons name="chevron-back" size={26} color={colors.onSurface} /></Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {([{ key: "receivable", label: "Piutang" }, { key: "payable", label: "Hutang" }] as { key: Kind; label: string }[]).map((item) => (
            <Pressable key={item.key} testID={`debt-${item.key}`} onPress={() => setKind(item.key)} style={[styles.chip, kind === item.key && styles.chipActive]}>
              <Text style={[styles.chipText, kind === item.key && styles.chipTextActive]}>{item.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <View style={styles.greenCard}>
          <Text style={styles.white}>Total {kind === "receivable" ? "piutang" : "hutang"}</Text>
          <Text style={styles.bigWhite}>{formatRupiah(data.total)}</Text>
          <Text style={[styles.white, { opacity: 0.78, marginTop: 6 }]}>{data.items.length} transaksi aktif</Text>
        </View>
        {data.items.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="checkmark-done-circle-outline" size={44} color={colors.success} />
            <Text style={[styles.muted, { marginTop: 10 }]}>Semua lunas! Tidak ada {kind === "receivable" ? "piutang" : "hutang"}.</Text>
          </View>
        ) : data.items.map((tx) => (
          <View key={tx.id} style={styles.card}>
            <View style={styles.between}>
              <View style={{ flex: 1 }}>
                <Text style={styles.productName}>{tx.customer_name}</Text>
                <Text style={styles.muted}>{tx.invoice_no} · {new Date(tx.created_at).toLocaleDateString("id-ID")}</Text>
              </View>
              <Text style={[styles.cardTitle, { color: colors.warning }]}>{formatRupiah(tx.outstanding)}</Text>
            </View>
            <Pressable testID={`pay-${tx.id}`} onPress={() => { setActive(tx); setAmount(String(tx.outstanding)); }} style={[styles.primaryButton, { marginTop: 10 }]}>
              <Text style={styles.primaryButtonText}>Catat pembayaran</Text>
            </Pressable>
          </View>
        ))}
      </ScrollView>
      <Modal visible={!!active} transparent animationType="slide" onRequestClose={() => setActive(null)}>
        <View style={{ flex: 1, backgroundColor: "rgba(28,28,30,0.55)", justifyContent: "flex-end" }}>
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 20 }}>
            <View style={styles.between}>
              <Text style={[styles.title, { fontSize: 20 }]}>Pembayaran {kind === "receivable" ? "Piutang" : "Hutang"}</Text>
              <Pressable onPress={() => setActive(null)}><Ionicons name="close" size={24} color={colors.onSurface} /></Pressable>
            </View>
            {active ? (
              <>
                <Text style={[styles.muted, { marginVertical: 8 }]}>{active.customer_name} · {active.invoice_no}</Text>
                <Text style={[styles.cardTitle, { color: colors.warning, marginBottom: 14 }]}>Sisa {formatRupiah(active.outstanding)}</Text>
                <Text style={styles.inputLabel}>Nominal</Text>
                <TextInput value={amount} onChangeText={setAmount} keyboardType="number-pad" style={styles.input} placeholderTextColor={colors.muted} />
                <Text style={styles.inputLabel}>Catatan</Text>
                <TextInput value={note} onChangeText={setNote} style={styles.input} placeholder="Opsional" placeholderTextColor={colors.muted} />
                <Pressable disabled={busy} onPress={pay} style={[styles.primaryButton, busy && { opacity: 0.5 }]}>
                  {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryButtonText}>Simpan</Text>}
                </Pressable>
              </>
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}
