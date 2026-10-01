import Ionicons from "@expo/vector-icons/Ionicons";
import * as Print from "expo-print";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest, BusinessSettings, formatRupiah, ParkedTransaction } from "@/src/api";
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
  const [settings, setSettings] = useState<BusinessSettings | null>(null);

  const load = useCallback(async () => {
    try { setList(await apiRequest<ParkedTransaction[]>("/parked")); }
    catch (e) { toast.error("Gagal memuat", e instanceof Error ? e.message : undefined); }
  }, [toast]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => { apiRequest<BusinessSettings>("/settings").then(setSettings).catch(() => undefined); }, []);

  const printTicket = async (p: ParkedTransaction) => {
    try {
      const header = (settings?.header_lines ?? []).slice(0, 4).map((l) => `<div>${l.replace(/</g, "&lt;")}</div>`).join("");
      const biz = settings?.business_name ?? "Toko";
      const items = p.items.map((i) => `<tr><td>${i.name}${i.unit ? ` (${i.unit})` : ""}</td><td style="text-align:right">${i.quantity}</td></tr>`).join("");
      const total = p.items.reduce((a, b) => a + b.price * b.quantity, 0);
      const html = `<!doctype html><html><head><meta charset="utf-8" /><style>
        body { font-family: -apple-system, Arial, sans-serif; width: 58mm; padding: 6px; }
        .center { text-align:center; }
        .big { font-size: 44px; font-weight: 900; letter-spacing: 2px; margin: 10px 0; }
        .biz { font-size: 14px; font-weight: 800; }
        .meta { font-size: 10px; color: #333; }
        table { width: 100%; border-top: 1px dashed #000; border-bottom: 1px dashed #000; margin-top: 6px; }
        td { font-size: 10px; padding: 1px 0; }
      </style></head><body>
        <div class="center biz">${biz}</div>
        <div class="center meta">${header}</div>
        <div class="center meta">${new Date(p.created_at).toLocaleString("id-ID")}</div>
        <div class="center" style="font-size:11px;margin-top:8px">NOMOR ANTRIAN</div>
        <div class="center big">${(p.label || p.customer_name).slice(0, 20)}</div>
        <div class="center meta">Atas nama: <b>${p.customer_name}</b></div>
        <table><tbody>${items}</tbody></table>
        <div class="meta" style="text-align:right;margin-top:4px">Perkiraan: ${formatRupiah(total)}</div>
      </body></html>`;
      await Print.printAsync({ html });
    } catch (e) { toast.error("Cetak gagal", e instanceof Error ? e.message : undefined); }
  };

  const askCancel = (p: ParkedTransaction) => {
    Alert.alert("Batalkan antrian?", `Antrian ${p.customer_name} akan dihapus permanen.`, [
      { text: "Tidak", style: "cancel" },
      { text: "Ya, batalkan", style: "destructive", onPress: async () => {
        try { await apiRequest(`/parked/${p.id}`, { method: "DELETE" }); toast.info("Antrian dibatalkan"); await load(); }
        catch (e) { toast.error("Gagal", e instanceof Error ? e.message : undefined); }
      } },
    ]);
  };

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
            <View style={{ flexDirection: "row", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              <Pressable testID={`resume-${p.id}`} onPress={() => router.replace({ pathname: "/(tabs)", params: { parked: p.id } })} style={[styles.primaryButton, { flex: 1, minWidth: 110 }]}>
                <Text style={styles.primaryButtonText}>Lanjutkan</Text>
              </Pressable>
              <Pressable testID={`print-${p.id}`} onPress={() => printTicket(p)} style={[styles.outlineButton, { flex: 1, minWidth: 110 }]}>
                <Text style={styles.outlineText}>Cetak Struk</Text>
              </Pressable>
              <Pressable testID={`cancel-parked-${p.id}`} onPress={() => askCancel(p)} style={[styles.dangerButton, { flex: 1, minWidth: 110 }]}>
                <Text style={styles.dangerText}>Batalkan</Text>
              </Pressable>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
