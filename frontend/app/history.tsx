import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest, formatRupiah, PAYMENT_LABELS, TransactionDoc } from "@/src/api";
import { useAppStyles } from "@/src/app-styles";
import { Header } from "@/src/components/header";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";

const KIND_LABEL: Record<TransactionDoc["transaction_type"], string> = {
  sale: "Penjualan", purchase: "Pembelian", sale_return: "Retur Jual", purchase_return: "Retur Beli",
};

export default function HistoryScreen() {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [list, setList] = useState<TransactionDoc[]>([]);
  const [filter, setFilter] = useState<"all" | TransactionDoc["transaction_type"]>("all");

  useEffect(() => {
    const path = filter === "all" ? "/transactions?limit=100" : `/transactions?kind=${filter}&limit=100`;
    apiRequest<TransactionDoc[]>(path).then(setList).catch((e) => toast.error("Gagal memuat", e instanceof Error ? e.message : undefined));
  }, [filter, toast]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.between}>
          <Header title="Riwayat transaksi" subtitle={`${list.length} transaksi`} />
          <Pressable onPress={() => router.back()}><Ionicons name="chevron-back" size={26} color={colors.onSurface} /></Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {([
            { key: "all", label: "Semua" },
            { key: "sale", label: "Penjualan" },
            { key: "purchase", label: "Pembelian" },
            { key: "sale_return", label: "Retur Jual" },
            { key: "purchase_return", label: "Retur Beli" },
          ] as { key: typeof filter; label: string }[]).map((item) => (
            <Pressable key={item.key} testID={`history-${item.key}`} onPress={() => setFilter(item.key)} style={[styles.chip, filter === item.key && styles.chipActive]}>
              <Text style={[styles.chipText, filter === item.key && styles.chipTextActive]}>{item.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
        {list.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="document-text-outline" size={44} color={colors.muted} />
            <Text style={[styles.muted, { marginTop: 10 }]}>Belum ada transaksi.</Text>
          </View>
        ) : list.map((tx) => (
          <View key={tx.id} style={styles.card}>
            <View style={styles.between}>
              <View style={{ flex: 1 }}>
                <Text style={styles.productName}>{KIND_LABEL[tx.transaction_type]} · {tx.invoice_no}</Text>
                <Text style={styles.muted}>{tx.customer_name} · {new Date(tx.created_at).toLocaleString("id-ID")}</Text>
                <Text style={[styles.muted, { marginTop: 4 }]}>{tx.payment_method_label || PAYMENT_LABELS[tx.payment_method] || tx.payment_method}{tx.outstanding > 0 ? ` · Sisa ${formatRupiah(tx.outstanding)}` : ""}</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={[styles.cardTitle, { color: colors.brandPrimary }]}>{formatRupiah(tx.total)}</Text>
                <Text style={styles.muted}>{tx.items.length} item</Text>
              </View>
            </View>
            <Pressable testID={`reprint-${tx.id}`} onPress={() => router.push({ pathname: "/receipt", params: { id: tx.id } })} style={[styles.outlineButton, { marginTop: 10 }]}>
              <Text style={styles.outlineText}>Cetak ulang / Lihat struk</Text>
            </Pressable>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
