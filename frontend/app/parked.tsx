import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";
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
  const [confirmCancel, setConfirmCancel] = useState<ParkedTransaction | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setList(await apiRequest<ParkedTransaction[]>("/parked")); }
    catch (e) { toast.error("Gagal memuat", e instanceof Error ? e.message : undefined); }
  }, [toast]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const doCancel = async () => {
    if (!confirmCancel) return;
    const target = confirmCancel;
    setBusyId(target.id);
    try {
      await apiRequest(`/parked/${target.id}`, { method: "DELETE" });
      toast.info("Antrian dibatalkan", target.customer_name);
      setConfirmCancel(null);
      await load();
    } catch (e) {
      // Idempotent: if already deleted, treat as success
      const msg = e instanceof Error ? e.message : "";
      if (/not found|tidak ditemukan|404/i.test(msg)) {
        toast.info("Antrian sudah terhapus", target.customer_name);
        setConfirmCancel(null);
        await load();
      } else {
        toast.error("Gagal batalkan", msg);
      }
    } finally { setBusyId(null); }
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.between}>
          <Header title="Antrian transaksi" subtitle={`${list.length} transaksi diparkir`} />
          <Pressable onPress={() => router.back()}><Ionicons name="chevron-back" size={26} color={colors.onSurface} /></Pressable>
        </View>
        <Text style={[styles.muted, { marginBottom: 10 }]}>Antrian akan hilang hanya bila dilanjutkan hingga selesai atau dibatalkan.</Text>
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
              <Pressable
                testID={`cancel-parked-${p.id}`}
                onPress={() => setConfirmCancel(p)}
                disabled={busyId === p.id}
                style={[styles.dangerButton, { flex: 1 }, busyId === p.id && { opacity: 0.5 }]}
              >
                {busyId === p.id ? <ActivityIndicator color={colors.onError ?? "#fff"} /> : <Text style={styles.dangerText}>Batalkan</Text>}
              </Pressable>
            </View>
          </View>
        ))}
      </ScrollView>

      <Modal visible={!!confirmCancel} transparent animationType="fade" onRequestClose={() => setConfirmCancel(null)}>
        <View style={{ flex: 1, backgroundColor: "rgba(28,28,30,0.55)", justifyContent: "center", padding: 24 }}>
          <View style={{ backgroundColor: colors.surface, borderRadius: 20, padding: 20 }}>
            <Text style={styles.cardTitle}>Batalkan antrian?</Text>
            <Text style={[styles.muted, { marginTop: 6, marginBottom: 14 }]}>
              Antrian atas nama {confirmCancel?.customer_name} akan dihapus permanen. Stok produk tidak terpengaruh karena belum dijual.
            </Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable onPress={() => setConfirmCancel(null)} disabled={!!busyId} style={[styles.outlineButton, { flex: 1 }]}>
                <Text style={styles.outlineText}>Tidak</Text>
              </Pressable>
              <Pressable
                testID="confirm-cancel-parked"
                onPress={doCancel}
                disabled={!!busyId}
                style={[styles.dangerButton, { flex: 1 }, !!busyId && { opacity: 0.6 }]}
              >
                {busyId ? <ActivityIndicator color={colors.onError ?? "#fff"} /> : <Text style={styles.dangerText}>Ya, batalkan</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
