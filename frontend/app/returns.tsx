import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest, formatRupiah, TransactionDoc } from "@/src/api";
import { useAppStyles } from "@/src/app-styles";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";

type Kind = "sale" | "purchase";

export default function ReturnsScreen() {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [kind, setKind] = useState<Kind>("sale");
  const [list, setList] = useState<TransactionDoc[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmTx, setConfirmTx] = useState<TransactionDoc | null>(null);

  const load = async (k: Kind) => {
    try { setList(await apiRequest<TransactionDoc[]>(`/transactions?kind=${k}&limit=50`)); }
    catch (e) { toast.error("Gagal memuat", e instanceof Error ? e.message : undefined); }
  };
  useEffect(() => { load(kind); }, [kind]);

  const fmtQty = (q: number) => Number(q).toLocaleString("id-ID", { maximumFractionDigits: 3 });

  const doReturn = async (tx: TransactionDoc) => {
    setBusyId(tx.id);
    try {
      await apiRequest("/transactions", {
        method: "POST",
        body: JSON.stringify({
          transaction_type: kind === "sale" ? "sale_return" : "purchase_return",
          payment_method: "cash",
          paid_amount: tx.total,
          customer_name: tx.customer_name,
          note: `Retur ${tx.invoice_no}`,
          original_transaction_id: tx.id,
          items: tx.items.map((i) => ({
            product_id: i.product_id,
            name: i.name,
            quantity: i.quantity,
            price: i.price,
            cost: i.cost,
            unit: i.unit ?? "",
            unit_factor: i.unit_factor ?? 1,
          })),
        }),
      });
      toast.success("Retur dicatat", `${tx.invoice_no} dikembalikan`);
      setConfirmTx(null);
      await load(kind);
    } catch (e) { toast.error("Retur gagal", e instanceof Error ? e.message : undefined); }
    finally { setBusyId(null); }
  };

  // Hanya tampilkan transaksi yang belum diretur & belum dibatalkan
  const eligible = list.filter((t) => !t.returned && t.status !== "cancelled");

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.between}>
          <Text style={[styles.title, { fontSize: 24 }]}>Retur transaksi</Text>
          <Pressable onPress={() => router.back()}><Ionicons name="close" size={26} color={colors.onSurface} /></Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {([{ key: "sale", label: "Retur Penjualan" }, { key: "purchase", label: "Retur Pembelian" }] as const).map((item) => (
            <Pressable key={item.key} testID={`return-tab-${item.key}`} onPress={() => setKind(item.key)} style={[styles.chip, kind === item.key && styles.chipActive]}>
              <Text style={[styles.chipText, kind === item.key && styles.chipTextActive]}>{item.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <Text style={[styles.muted, { marginBottom: 10, fontSize: 12 }]}>Transaksi yang sudah diretur / dibatalkan otomatis disembunyikan.</Text>
        {eligible.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="return-up-back-outline" size={44} color={colors.muted} />
            <Text style={[styles.muted, { marginTop: 10 }]}>Belum ada transaksi untuk diretur.</Text>
          </View>
        ) : eligible.map((tx) => (
          <View key={tx.id} style={styles.card}>
            <View style={styles.between}>
              <View style={{ flex: 1 }}>
                <Text style={styles.productName}>{tx.invoice_no}</Text>
                <Text style={styles.muted}>{tx.customer_name} · {new Date(tx.created_at).toLocaleString("id-ID")}</Text>
              </View>
              <Text style={[styles.cardTitle, { color: colors.brandPrimary }]}>{formatRupiah(tx.total)}</Text>
            </View>
            {tx.items.map((i, idx) => (
              <Text key={idx} style={[styles.muted, { marginTop: 6 }]}>• {i.name} × {fmtQty(i.quantity)} = {formatRupiah(i.price * i.quantity)}</Text>
            ))}
            <Pressable
              testID={`do-return-${tx.id}`}
              disabled={busyId === tx.id}
              onPress={() => setConfirmTx(tx)}
              style={[styles.dangerButton, { marginTop: 12 }]}
            >
              {busyId === tx.id ? <ActivityIndicator color={colors.error} /> : <Text style={styles.dangerText}>Retur transaksi ini</Text>}
            </Pressable>
          </View>
        ))}
      </ScrollView>

      <Modal visible={!!confirmTx} transparent animationType="fade" onRequestClose={() => setConfirmTx(null)}>
        <View style={{ flex: 1, backgroundColor: "rgba(28,28,30,0.55)", justifyContent: "center", padding: 24 }}>
          <View style={{ backgroundColor: colors.surface, borderRadius: 20, padding: 20 }}>
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 10 }}>
              <Ionicons name="alert-circle" size={28} color={colors.error} />
              <Text style={[styles.cardTitle, { marginLeft: 10, flex: 1, fontSize: 20 }]}>Apakah anda yakin??</Text>
            </View>
            <Text style={[styles.muted, { marginBottom: 10, lineHeight: 20 }]}>
              Transaksi <Text style={{ fontWeight: "700", color: colors.onSurface }}>{confirmTx?.invoice_no}</Text> senilai{" "}
              <Text style={{ fontWeight: "700", color: colors.onSurface }}>{confirmTx ? formatRupiah(confirmTx.total) : ""}</Text> akan diretur.
            </Text>
            <Text style={[styles.muted, { fontSize: 11, marginBottom: 14 }]}>
              ⚠️ Stok akan dikembalikan dan tercatat permanen. Transaksi tidak dapat diretur lebih dari satu kali.
            </Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable
                testID="cancel-return"
                onPress={() => setConfirmTx(null)}
                style={[styles.outlineButton, { flex: 1 }]}
              >
                <Text style={styles.outlineText}>Batal</Text>
              </Pressable>
              <Pressable
                testID="confirm-return"
                onPress={() => confirmTx && doReturn(confirmTx)}
                disabled={!!busyId}
                style={[styles.dangerButton, { flex: 1 }, busyId && { opacity: 0.5 }]}
              >
                {busyId ? <ActivityIndicator color={colors.error} /> : <Text style={styles.dangerText}>Ya, retur sekarang</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
