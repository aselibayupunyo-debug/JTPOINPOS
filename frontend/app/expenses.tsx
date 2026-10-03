import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest, formatRupiah } from "@/src/api";
import { useAppStyles } from "@/src/app-styles";
import { Header } from "@/src/components/header";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";

type Expense = {
  id: string;
  amount: number;
  category: string;
  note: string;
  payment_method: string;
  payment_method_label: string;
  created_at: string;
  created_by_name?: string;
};

export default function ExpensesScreen() {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [list, setList] = useState<Expense[]>([]);
  const [total, setTotal] = useState(0);
  const [period, setPeriod] = useState<"daily" | "monthly" | "yearly">("monthly");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await apiRequest<{ total: number; items: Expense[] }>(`/expenses?period=${period}`);
      setList(data.items); setTotal(data.total);
    } catch (e) {
      toast.error("Gagal memuat", e instanceof Error ? e.message : undefined);
    }
  }, [period, toast]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const askDelete = (e: Expense) => {
    Alert.alert("Hapus transaksi biaya?", `${e.category} · ${formatRupiah(e.amount)}`, [
      { text: "Batal", style: "cancel" },
      { text: "Hapus", style: "destructive", onPress: async () => {
        try { await apiRequest(`/expenses/${e.id}`, { method: "DELETE" }); toast.success("Terhapus"); await load(); }
        catch (err) { toast.error("Gagal", err instanceof Error ? err.message : undefined); }
      } },
    ]);
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={colors.brandPrimary} />}
      >
        <View style={styles.between}>
          <Header title="Transaksi Biaya" subtitle={`Total ${period === "daily" ? "hari ini" : period === "monthly" ? "bulan ini" : "tahun ini"}: ${formatRupiah(total)}`} />
          <Pressable onPress={() => router.back()}><Ionicons name="chevron-back" size={26} color={colors.onSurface} /></Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {(["daily", "monthly", "yearly"] as const).map((p) => (
            <Pressable key={p} testID={`period-${p}`} onPress={() => setPeriod(p)} style={[styles.chip, period === p && styles.chipActive]}>
              <Text style={[styles.chipText, period === p && styles.chipTextActive]}>{p === "daily" ? "Hari ini" : p === "monthly" ? "Bulan ini" : "Tahun ini"}</Text>
            </Pressable>
          ))}
        </ScrollView>
        {list.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="receipt-outline" size={44} color={colors.muted} />
            <Text style={[styles.muted, { marginTop: 10 }]}>Belum ada transaksi biaya di periode ini.</Text>
          </View>
        ) : list.map((e) => (
          <Pressable key={e.id} onLongPress={() => askDelete(e)} style={styles.card}>
            <View style={styles.between}>
              <View style={{ flex: 1 }}>
                <Text style={styles.productName}>{e.category}</Text>
                <Text style={styles.muted}>{new Date(e.created_at).toLocaleString("id-ID")} · {e.payment_method_label}</Text>
                {e.note ? <Text style={[styles.muted, { marginTop: 4 }]}>{e.note}</Text> : null}
              </View>
              <Text style={[styles.cardTitle, { color: colors.error }]}>- {formatRupiah(e.amount)}</Text>
            </View>
          </Pressable>
        ))}
        <Text style={[styles.muted, { textAlign: "center", fontSize: 11, marginTop: 8 }]}>Tekan lama untuk hapus.</Text>
      </ScrollView>
      <Pressable testID="fab-add-expense" onPress={() => router.push("/expense-form")} style={[styles.fab, { bottom: insets.bottom + 24 }]}>
        <Ionicons name="add" size={28} color={colors.onBrandPrimary} />
      </Pressable>
    </View>
  );
}
