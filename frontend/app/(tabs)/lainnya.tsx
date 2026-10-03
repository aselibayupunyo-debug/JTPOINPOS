import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { adminDeleteAllProducts, adminResetTransactions, apiRequest, IntegrationState } from "@/src/api";
import { useAppStyles } from "@/src/app-styles";
import { useAuth } from "@/src/auth-context";
import { AdminPasswordModal } from "@/src/components/admin-password-modal";
import { Header } from "@/src/components/header";
import { SyncBanner } from "@/src/components/sync-banner";
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
  const [resetOpen, setResetOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const load = useCallback(async () => {
    try { setIntegrations(await apiRequest<IntegrationState>("/integrations/status")); }
    catch { /* ignore */ }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const items: MenuItem[] = [
    { icon: "cart-outline", title: "Pembelian baru", detail: "Catat barang masuk dari supplier", path: "/purchase", permission: "purchases" },
    { icon: "cash-outline", title: "Transaksi biaya", detail: "Catat pengeluaran operasional (listrik, gaji, dsb.)", path: "/expenses", permission: "cashflow" },
    { icon: "return-up-back-outline", title: "Retur transaksi", detail: "Retur penjualan atau pembelian berbasis stok", path: "/returns", permission: "returns" },
    { icon: "layers-outline", title: "Antrian transaksi", detail: "Transaksi diparkir yang bisa dilanjutkan", path: "/parked", permission: "sales" },
    { icon: "time-outline", title: "Shift kasir", detail: "Buka/tutup shift, saldo kas per kasir", path: "/shifts", permission: "sales" },
    { icon: "gift-outline", title: "Promo & bundling", detail: "Beli 2 gratis 1, paket harga tetap, diskon", path: "/promos", permission: "settings" },
    { icon: "wallet-outline", title: "Arus kas", detail: "Kas masuk, keluar, saldo berjalan", path: "/cashflow", permission: "cashflow" },
    { icon: "alert-circle-outline", title: "Hutang & Piutang", detail: "Lunasi dan lacak kredit berjalan", path: "/debts", permission: "debts" },
    { icon: "people-outline", title: "Pelanggan", detail: "Database pelanggan & total transaksi", path: "/customers" },
    { icon: "briefcase-outline", title: "Supplier", detail: "Database supplier & total pembelian", path: "/suppliers" },
    { icon: "receipt-outline", title: "Riwayat transaksi", detail: "Semua transaksi · cetak ulang struk/invoice", path: "/history" },
    { icon: "trending-up-outline", title: "Laporan tracking stok", detail: "Pergerakan stok masuk/keluar · PDF & Excel", path: "/stock-tracking", permission: "reports" },
    { icon: "stats-chart-outline", title: "Laporan laba rugi", detail: "Pendapatan dikurangi HPP & biaya", path: "/profit-loss", permission: "reports" },
    { icon: "wallet-outline", title: "Laporan biaya", detail: "Rekap biaya per pos · PDF & Excel", path: "/expense-report", permission: "reports" },
    { icon: "document-text-outline", title: "Rekap pajak", detail: "DPP + PPN keluaran vs masukan", path: "/tax-report", permission: "reports" },
    { icon: "barcode-outline", title: "Cetak barcode label", detail: "Cetak stiker barcode produk", path: "/barcode-print", permission: "inventory" },
    { icon: "pricetags-outline", title: "Kategori barang", detail: "Atur kategori produk", path: "/categories", permission: "inventory" },
    { icon: "card-outline", title: "Metode pembayaran", detail: "Tunai, Kredit, QRIS statis, kustom", path: "/payment-methods", permission: "settings" },
    { icon: "options-outline", title: "Pengaturan transaksi", detail: "Pajak, ongkir, level harga, hardware", path: "/transaction-settings", permission: "settings" },
    { icon: "person-add-outline", title: "Operator & kewenangan", detail: "Atur akses tim kasir", path: "/operators", ownerOnly: true },
    { icon: "archive-outline", title: "Backup & Restore (ZIP)", detail: "Simpan dan pulihkan seluruh data", path: "/backup", ownerOnly: true },
    { icon: "print-outline", title: "Pengaturan toko & struk", detail: "Logo, printer 58/80mm, WhatsApp", path: "/settings", permission: "settings" },
    { icon: "book-outline", title: "Buku Panduan Manual", detail: "Cara pakai semua fitur JTPOIN POS", path: "/manual" },
    { icon: "person-circle-outline", title: "Profil & Password", detail: "Ubah nama tampilan & password admin", path: "/profile", ownerOnly: true },
  ];

  const canSee = (item: MenuItem) => {
    if (item.ownerOnly) return user?.role === "owner";
    if (item.permission) return can(item.permission);
    return true;
  };

  const resetTx = async (password: string) => {
    try {
      const res = await adminResetTransactions(password);
      setResetOpen(false);
      const d = res.deleted;
      toast.success("Transaksi direset", `Dihapus: ${d.transactions} transaksi · ${d.parked} antrian · ${d.cashflow} kas · ${d.shifts} shift`);
    } catch (e) { toast.error("Gagal reset", e instanceof Error ? e.message : undefined); }
  };

  const deleteProducts = async (password: string) => {
    try {
      const res = await adminDeleteAllProducts(password);
      setDeleteOpen(false);
      toast.success("Produk dihapus", `${res.deleted} produk telah dihapus permanen`);
    } catch (e) { toast.error("Gagal hapus produk", e instanceof Error ? e.message : undefined); }
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Header eyebrow={user?.business_name} title="Lainnya" subtitle="Operasional & pengaturan toko" />
        <SyncBanner />
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
          <Pressable testID="menu-bluetooth-printer" onPress={() => router.push("/bluetooth-printer")} style={styles.listRow}>
            <View style={styles.settingIcon}><Ionicons name="print-outline" size={20} color={colors.brandPrimary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.productName}>Printer Bluetooth {integrations?.bluetooth_printing.configured ? "" : "(Build Android)"}</Text>
              <Text style={styles.muted}>Pair thermal 58/80mm, cetak uji, atur laci kas</Text>
            </View>
            <Ionicons name="chevron-forward" size={19} color={colors.muted} />
          </Pressable>
        </View>

        {user?.role === "owner" ? (
          <View style={[styles.card, { borderWidth: 1, borderColor: colors.error }]}>
            <Text style={[styles.cardTitle, { color: colors.error }]}>Zona berbahaya</Text>
            <Text style={[styles.muted, { marginTop: 4, marginBottom: 10 }]}>Aksi di sini permanen dan harus dikonfirmasi dengan password pemilik.</Text>
            <Pressable testID="reset-transactions-button" onPress={() => setResetOpen(true)} style={styles.listRow}>
              <View style={[styles.settingIcon, { backgroundColor: colors.surfaceTertiary }]}>
                <Ionicons name="refresh-outline" size={20} color={colors.error} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.productName}>Reset semua transaksi</Text>
                <Text style={styles.muted}>Hapus riwayat jual/beli/retur, antrian, kas, dan shift</Text>
              </View>
              <Ionicons name="chevron-forward" size={19} color={colors.muted} />
            </Pressable>
            <Pressable testID="delete-all-products-button" onPress={() => setDeleteOpen(true)} style={styles.listRow}>
              <View style={[styles.settingIcon, { backgroundColor: colors.surfaceTertiary }]}>
                <Ionicons name="trash-outline" size={20} color={colors.error} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.productName}>Hapus semua produk</Text>
                <Text style={styles.muted}>Kosongkan katalog & stok secara permanen</Text>
              </View>
              <Ionicons name="chevron-forward" size={19} color={colors.muted} />
            </Pressable>
            <Pressable testID="audit-log-button" onPress={() => router.push("/audit-log")} style={styles.listRow}>
              <View style={[styles.settingIcon, { backgroundColor: colors.surfaceTertiary }]}>
                <Ionicons name="shield-checkmark-outline" size={20} color={colors.brandPrimary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.productName}>Log Audit Admin</Text>
                <Text style={styles.muted}>Lihat riwayat aksi sensitif (reset / hapus)</Text>
              </View>
              <Ionicons name="chevron-forward" size={19} color={colors.muted} />
            </Pressable>
          </View>
        ) : null}

        <Pressable testID="logout-button" onPress={signOut} style={[styles.dangerButton, { marginTop: 6 }]}>
          <Text style={styles.dangerText}>Keluar dari akun</Text>
        </Pressable>
        <Text style={[styles.muted, { textAlign: "center", marginTop: 20 }]}>JTPOIN POS · Semua modul tersinkron ke laporan</Text>
      </ScrollView>

      <AdminPasswordModal
        visible={resetOpen}
        title="Reset semua transaksi"
        description="Tindakan ini akan menghapus seluruh transaksi, antrian, arus kas, dan shift. Produk dan pelanggan tetap. Ketik password pemilik untuk melanjutkan."
        confirmLabel="Reset Transaksi"
        onCancel={() => setResetOpen(false)}
        onConfirm={resetTx}
      />
      <AdminPasswordModal
        visible={deleteOpen}
        title="Hapus semua produk"
        description="Semua produk & stok di katalog akan dihapus permanen. Ketik password pemilik untuk melanjutkan."
        confirmLabel="Hapus Semua Produk"
        onCancel={() => setDeleteOpen(false)}
        onConfirm={deleteProducts}
      />
    </View>
  );
}
