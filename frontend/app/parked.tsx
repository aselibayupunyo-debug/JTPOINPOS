import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest, formatRupiah, ParkedTransaction } from "@/src/api";
import { useAppStyles } from "@/src/app-styles";
import { Header } from "@/src/components/header";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";

export default function ParkedScreen() {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [list, setList] = useState<ParkedTransaction[]>([]);

  const load = useCallback(async () => {
    try { setList(await apiRequest<ParkedTransaction[]>("/parked")); }
    catch (e) { toast.error("Gagal memuat", e instanceof Error ? e.message : undefined); }
  }, [toast]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.between}>
          <Header title="Antrian transaksi" subtitle={`${list.length} transaksi diparkir`} />
          <Pressable onPress={() => router.back()}><Ionicons name="chevron-back" size={26} color={colors.onSurface} /></Pressable>
        </View>
        <Text style={[styles.muted, { marginBottom: 10 }]}>Antrian akan hilang hanya bila dilanjutkan atau dibatalkan.</Text>
        {list.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="layers-outline" size={44} color={colors.muted} />
            <Text style={[styles.muted, { marginTop: 10 }]}>Belum ada antrian. Tekan tombol Park di kasir untuk menyimpan sementara.</Text>
          </View>
        ) : list.map((p) => (
          <View key={p.id} style={styles.card}>
            <View style={styles.between}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{p.customer_name}</Text>
                <Text style={styles.muted}>{p.label} · {new Date(p.created_at).toLocaleString("id-ID")}</Text>
                <Text style={[styles.muted, { marginTop: 4 }]}>{p.items.length} item · total {formatRupiah(p.items.reduce((s, i) => s + i.price * i.quantity, 0))}</Text>
              </View>
            </View>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
              <Pressable testID={`resume-${p.id}`} onPress={() => router.replace({ pathname: "/(tabs)", params: { parked: p.id } })} style={[styles.primaryButton, { flex: 1 }]}>
                <Text style={styles.primaryButtonText}>Lanjutkan transaksi</Text>
              </Pressable>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
