import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
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

  const load = async (k: Kind) => {
    try { setList(await apiRequest<TransactionDoc[]>(`/transactions?kind=${k}&limit=50`)); }
    catch (e) { toast.error("Gagal memuat", e instanceof Error ? e.message : undefined); }
  };
  useEffect(() => { load(kind); }, [kind]);

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
          items: tx.items.map((i) => ({ product_id: i.product_id, name: i.name, quantity: i.quantity, price: i.price, cost: i.cost })),
        }),
      });
      toast.success("Retur dicatat", `${tx.invoice_no} dikembalikan`);
      await load(kind);
    } catch (e) { toast.error("Retur gagal", e instanceof Error ? e.message : undefined); }
    finally { setBusyId(null); }
  };

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
        {list.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="return-up-back-outline" size={44} color={colors.muted} />
            <Text style={[styles.muted, { marginTop: 10 }]}>Belum ada transaksi untuk diretur.</Text>
          </View>
        ) : list.map((tx) => (
          <View key={tx.id} style={styles.card}>
            <View style={styles.between}>
              <View style={{ flex: 1 }}>
                <Text style={styles.productName}>{tx.invoice_no}</Text>
                <Text style={styles.muted}>{tx.customer_name} · {new Date(tx.created_at).toLocaleString("id-ID")}</Text>
              </View>
              <Text style={[styles.cardTitle, { color: colors.brandPrimary }]}>{formatRupiah(tx.total)}</Text>
            </View>
            {tx.items.map((i, idx) => (
              <Text key={idx} style={[styles.muted, { marginTop: 6 }]}>• {i.name} × {i.quantity} = {formatRupiah(i.price * i.quantity)}</Text>
            ))}
            <Pressable testID={`do-return-${tx.id}`} disabled={busyId === tx.id} onPress={() => doReturn(tx)} style={[styles.dangerButton, { marginTop: 12 }]}>
              {busyId === tx.id ? <ActivityIndicator color={colors.error} /> : <Text style={styles.dangerText}>Retur transaksi ini</Text>}
            </Pressable>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
