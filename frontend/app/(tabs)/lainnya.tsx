import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, Share, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest, IntegrationState } from "@/src/api";
import { useAppStyles } from "@/src/app-styles";
import { useAuth } from "@/src/auth-context";
import { Header } from "@/src/components/header";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";

type MenuItem = { icon: keyof typeof Ionicons.glyphMap; title: string; detail: string; path: string; permission?: "sales" | "purchases" | "returns" | "inventory" | "reports" | "cashflow" | "debts" | "operators" | "settings"; ownerOnly?: boolean };

export default function LainnyaScreen() {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user, can, signOut } = useAuth();
  const toast = useToast();
  const [integrations, setIntegrations] = useState<IntegrationState | null>(null);

  const load = useCallback(async () => {
    try { setIntegrations(await apiRequest<IntegrationState>("/integrations/status")); }
    catch { /* ignore */ }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const items: MenuItem[] = [
    { icon: "cart-outline", title: "Pembelian baru", detail: "Catat barang masuk dari supplier", path: "/purchase", permission: "purchases" },
    { icon: "return-up-back-outline", title: "Retur transaksi", detail: "Retur penjualan atau pembelian", path: "/returns", permission: "returns" },
    { icon: "wallet-outline", title: "Arus kas", detail: "Kas masuk, keluar, saldo berjalan", path: "/cashflow", permission: "cashflow" },
    { icon: "alert-circle-outline", title: "Hutang & Piutang", detail: "Lunasi dan lacak kredit berjalan", path: "/debts", permission: "debts" },
    { icon: "receipt-outline", title: "Riwayat transaksi", detail: "Semua penjualan & pembelian", path: "/history" },
    { icon: "people-outline", title: "Operator & kewenangan", detail: "Atur akses tim kasir", path: "/operators", ownerOnly: true },
    { icon: "print-outline", title: "Pengaturan toko & struk", detail: "Logo, printer 58/80mm, WhatsApp", path: "/settings", permission: "settings" },
  ];

  const canSee = (item: MenuItem) => {
    if (item.ownerOnly) return user?.role === "owner";
    if (item.permission) return can(item.permission);
    return true;
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Header eyebrow={user?.business_name} title="Lainnya" subtitle="Operasional & pengaturan toko" />
        <View style={styles.greenCard}>
          <Text style={styles.white}>Pusat kendali</Text>
          <Text style={styles.bigWhite}>{user?.business_name}</Text>
          <Text style={[styles.white, { opacity: 0.78, marginTop: 7 }]}>{user?.role === "owner" ? "Pemilik" : "Operator"} · {user?.name}</Text>
        </View>
        <View style={styles.card}>
          {items.filter(canSee).map((row) => (
            <Pressable key={row.path} testID={`menu-${row.path.replace("/", "")}`} onPress={() => router.push(row.path as never)} style={styles.listRow}>
              <View style={styles.settingIcon}><Ionicons name={row.icon} size={20} color={colors.brandPrimary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.productName}>{row.title}</Text>
                <Text style={styles.muted}>{row.detail}</Text>
              </View>
              <Ionicons name="chevron-forward" size={19} color={colors.muted} />
            </Pressable>
          ))}
        </View>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Data & keamanan</Text>
          <Pressable testID="backup-button" onPress={async () => {
            try {
              const data = await apiRequest<Record<string, unknown>>("/backup");
              await Share.share({ title: "Backup KasirKu Pro", message: JSON.stringify(data, null, 2) });
            } catch (e) { toast.error("Backup gagal", e instanceof Error ? e.message : undefined); }
          }} style={styles.listRow}>
            <View style={styles.settingIcon}><Ionicons name="cloud-download-outline" size={20} color={colors.brandPrimary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.productName}>Backup data</Text>
              <Text style={styles.muted}>Bagikan salinan JSON seluruh bisnis</Text>
            </View>
            <Ionicons name="share-outline" size={19} color={colors.muted} />
          </Pressable>
          <View style={styles.listRow}>
            <View style={styles.settingIcon}><Ionicons name="hardware-chip-outline" size={20} color={colors.brandPrimary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.productName}>Printer Bluetooth {integrations?.bluetooth_printing.configured ? "" : "(Build Android)"}</Text>
              <Text style={styles.muted}>{integrations?.bluetooth_printing.note ?? "Cetak langsung aktif pada build produksi"}</Text>
            </View>
          </View>
        </View>
        <Pressable testID="logout-button" onPress={signOut} style={[styles.dangerButton, { marginTop: 6 }]}>
          <Text style={styles.dangerText}>Keluar dari akun</Text>
        </Pressable>
        <Text style={[styles.muted, { textAlign: "center", marginTop: 20 }]}>KasirKu Pro · Semua modul tersinkron ke laporan</Text>
      </ScrollView>
    </View>
  );
}
