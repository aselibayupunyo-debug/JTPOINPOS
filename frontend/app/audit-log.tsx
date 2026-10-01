import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AuditLog, listAuditLogs } from "@/src/api";
import { useAppStyles } from "@/src/app-styles";
import { Header } from "@/src/components/header";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";

const ACTION_LABEL: Record<string, { title: string; icon: keyof typeof Ionicons.glyphMap; color: "error" | "warning" | "info" }> = {
  reset_transactions: { title: "Reset semua transaksi", icon: "refresh-outline", color: "error" },
  delete_all_products: { title: "Hapus semua produk", icon: "trash-outline", color: "error" },
};

function summarizeDetails(action: string, details: Record<string, unknown>): string {
  if (action === "reset_transactions") {
    const d = details as Record<string, number>;
    return `${d.transactions ?? 0} transaksi · ${d.parked ?? 0} antrian · ${d.cashflow ?? 0} kas · ${d.shifts ?? 0} shift`;
  }
  if (action === "delete_all_products") {
    const d = details as Record<string, number>;
    return `${d.deleted ?? 0} produk dihapus`;
  }
  try { return JSON.stringify(details); } catch { return ""; }
}

export default function AuditLogScreen() {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [logs, setLogs] = useState<AuditLog[] | null>(null);

  const load = useCallback(async () => {
    try { setLogs(await listAuditLogs(200)); }
    catch (e) { toast.error("Gagal memuat log", e instanceof Error ? e.message : undefined); }
  }, [toast]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.between}>
          <Header title="Log Audit Admin" subtitle="Riwayat aksi reset / hapus / perubahan hak akses" />
          <Pressable onPress={() => router.back()}><Ionicons name="chevron-back" size={26} color={colors.onSurface} /></Pressable>
        </View>
        <Text style={[styles.muted, { marginBottom: 10 }]}>Catatan setiap tindakan sensitif oleh pemilik. Hanya untuk pemilik bisnis.</Text>
        {!logs ? (
          <View style={[styles.empty, { paddingVertical: 40 }]}><ActivityIndicator color={colors.brandPrimary} /></View>
        ) : logs.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="shield-checkmark-outline" size={44} color={colors.muted} />
            <Text style={[styles.muted, { marginTop: 10 }]}>Belum ada aksi admin tercatat. Setiap reset/hapus akan muncul di sini.</Text>
          </View>
        ) : logs.map((log) => {
          const meta = ACTION_LABEL[log.action] ?? { title: log.action, icon: "document-text-outline" as const, color: "info" as const };
          const iconColor = meta.color === "error" ? colors.error : meta.color === "warning" ? colors.warning : colors.brandPrimary;
          return (
            <View key={log.id} style={styles.card}>
              <View style={styles.between}>
                <View style={[styles.settingIcon, { backgroundColor: colors.surfaceTertiary }]}>
                  <Ionicons name={meta.icon} size={20} color={iconColor} />
                </View>
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={styles.productName}>{meta.title}</Text>
                  <Text style={styles.muted}>{log.actor_name} · {new Date(log.created_at).toLocaleString("id-ID")}</Text>
                  <Text style={[styles.muted, { marginTop: 4, fontSize: 12 }]}>{summarizeDetails(log.action, log.details)}</Text>
                </View>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}
