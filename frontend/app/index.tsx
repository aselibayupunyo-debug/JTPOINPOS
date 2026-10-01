import Ionicons from "@expo/vector-icons/Ionicons";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, Image, KeyboardAvoidingView, Modal, Platform, Pressable,
  RefreshControl, ScrollView, Share, StyleSheet, Text, TextInput, View, useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest, CartItem, clearToken, formatRupiah, login, Product, register, saveToken, uploadProducts, User } from "@/src/api";
import { makeStyles, useTheme } from "@/src/theme";
import { storage } from "@/src/utils/storage";

type Tab = "kasir" | "stok" | "laporan" | "lainnya";
type Report = { sales_total: number; purchase_total: number; transaction_count: number; gross_profit: number; receivable: number; payable: number; low_stock: number; cash_balance: number };
type IntegrationState = { qris: { configured: boolean }; whatsapp: { configured: boolean }; bluetooth_printing: { configured: boolean } };

const useStyles = makeStyles((colors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 30 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 22 },
  eyebrow: { color: colors.brandPrimary, fontSize: 13, fontWeight: "700", letterSpacing: 0.4 },
  title: { color: colors.onSurface, fontSize: 28, fontWeight: "800", marginTop: 4 },
  subtitle: { color: colors.muted, fontSize: 14, marginTop: 5 },
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.brandPrimary, fontSize: 18, fontWeight: "800" },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: 20, borderWidth: 1, borderColor: colors.border, padding: 16, marginBottom: 16 },
  greenCard: { backgroundColor: colors.brandPrimary, borderRadius: 22, padding: 20, marginBottom: 20 },
  cardTitle: { color: colors.onSurface, fontSize: 17, fontWeight: "800" },
  muted: { color: colors.muted, fontSize: 13 },
  white: { color: colors.onBrandPrimary },
  bigWhite: { color: colors.onBrandPrimary, fontSize: 28, fontWeight: "800", marginTop: 7 },
  row: { flexDirection: "row", alignItems: "center" },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  search: { flex: 1, minHeight: 48, borderRadius: 15, backgroundColor: colors.surfaceTertiary, paddingHorizontal: 15, color: colors.onSurface, fontSize: 15 },
  iconButton: { width: 48, height: 48, borderRadius: 15, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center", marginLeft: 10 },
  chips: { gap: 8, paddingVertical: 18 },
  chip: { paddingHorizontal: 15, minHeight: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceTertiary },
  chipActive: { backgroundColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceTertiary, fontSize: 13, fontWeight: "700" },
  chipTextActive: { color: colors.onBrandPrimary },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 12 },
  product: { backgroundColor: colors.surfaceSecondary, borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 12, marginBottom: 2 },
  productImage: { width: "100%", height: 92, borderRadius: 13, marginBottom: 10, backgroundColor: colors.brandTertiary },
  productIcon: { width: "100%", height: 92, borderRadius: 13, marginBottom: 10, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  productName: { color: colors.onSurface, fontSize: 14, fontWeight: "700", minHeight: 36 },
  price: { color: colors.brandPrimary, fontSize: 15, fontWeight: "800", marginTop: 5 },
  stock: { color: colors.muted, fontSize: 12, marginTop: 3 },
  cartBar: { backgroundColor: colors.surfaceInverse, borderRadius: 20, padding: 16, marginTop: 18, flexDirection: "row", alignItems: "center" },
  cartCount: { color: colors.onSurfaceInverse, fontSize: 13, fontWeight: "700" },
  cartTotal: { color: colors.onSurfaceInverse, fontSize: 18, fontWeight: "800", marginTop: 3 },
  primaryButton: { minHeight: 48, borderRadius: 15, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", paddingHorizontal: 18 },
  primaryButtonText: { color: colors.onBrandPrimary, fontSize: 15, fontWeight: "800" },
  outlineButton: { minHeight: 46, borderRadius: 14, borderWidth: 1, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  outlineText: { color: colors.onSurface, fontSize: 14, fontWeight: "700" },
  empty: { paddingVertical: 40, alignItems: "center" },
  metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 18 },
  metric: { flexBasis: "47%", flexGrow: 1, backgroundColor: colors.surfaceSecondary, borderRadius: 18, padding: 15, borderWidth: 1, borderColor: colors.border },
  metricLabel: { color: colors.muted, fontSize: 12, fontWeight: "600" },
  metricValue: { color: colors.onSurface, fontSize: 18, fontWeight: "800", marginTop: 8 },
  listRow: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.divider },
  modalBackdrop: { flex: 1, backgroundColor: colors.surfaceInverse, justifyContent: "flex-end" },
  modalSheet: { backgroundColor: colors.surface, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 20, maxHeight: "90%" },
  modalTitle: { color: colors.onSurface, fontSize: 22, fontWeight: "800", marginBottom: 18 },
  input: { minHeight: 50, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary, color: colors.onSurface, paddingHorizontal: 15, marginBottom: 12, fontSize: 15 },
  inputLabel: { color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: "700", marginBottom: 7 },
  paymentChip: { flex: 1, minHeight: 46, borderRadius: 13, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center", marginRight: 7 },
  paymentActive: { backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandPrimary },
  paymentText: { color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "800" },
  nav: { flexDirection: "row", backgroundColor: colors.surfaceSecondary, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8 },
  navItem: { flex: 1, alignItems: "center", minHeight: 58, justifyContent: "center" },
  navText: { color: colors.muted, fontSize: 11, fontWeight: "700", marginTop: 4 },
  navTextActive: { color: colors.brandPrimary },
  settingRow: { minHeight: 62, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: colors.divider },
  settingIcon: { width: 36, height: 36, borderRadius: 11, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center", marginRight: 12 },
  badge: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 9, backgroundColor: colors.brandTertiary },
  badgeText: { color: colors.brandPrimary, fontSize: 11, fontWeight: "800" },
}));

const navItems: { key: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "kasir", label: "Kasir", icon: "bag-handle-outline" },
  { key: "stok", label: "Stok", icon: "cube-outline" },
  { key: "laporan", label: "Laporan", icon: "bar-chart-outline" },
  { key: "lainnya", label: "Lainnya", icon: "grid-outline" },
];

function AuthScreen({ onAuthenticated }: { onAuthenticated: (result: { token: string; user: User }) => Promise<void> }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [isRegister, setIsRegister] = useState(false);
  const [business, setBusiness] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    setError("");
    if (!username || !password || (isRegister && (!business || !name))) return setError("Lengkapi semua data terlebih dahulu.");
    setBusy(true);
    try {
      const result = isRegister ? await register({ business_name: business, owner_name: name, username, password }) : await login(username, password);
      await onAuthenticated(result);
    } catch (e) { setError(e instanceof Error ? e.message : "Tidak dapat terhubung ke server."); } finally { setBusy(false); }
  };
  return <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : "height"}>
    <ScrollView contentContainerStyle={[styles.content, { flexGrow: 1, justifyContent: "center" }]} keyboardShouldPersistTaps="handled">
      <View style={{ alignItems: "center", marginBottom: 34 }}>
        <View style={[styles.avatar, { width: 76, height: 76, borderRadius: 24, backgroundColor: colors.brandPrimary }]}><Ionicons name="storefront" size={38} color={colors.onBrandPrimary} /></View>
        <Text style={[styles.title, { fontSize: 30, marginTop: 18 }]}>KasirKu Pro</Text>
        <Text style={[styles.subtitle, { textAlign: "center" }]}>Pusat kendali penjualan dan bisnis Anda.</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{isRegister ? "Buat bisnis baru" : "Selamat datang kembali"}</Text>
        <Text style={[styles.subtitle, { marginBottom: 20 }]}>{isRegister ? "Daftarkan akun pemilik untuk mulai berjualan." : "Masuk untuk melanjutkan operasional toko."}</Text>
        {isRegister ? <><Text style={styles.inputLabel}>Nama bisnis</Text><TextInput value={business} onChangeText={setBusiness} placeholder="Contoh: Toko Sejahtera" placeholderTextColor={colors.muted} style={styles.input} /><Text style={styles.inputLabel}>Nama pemilik</Text><TextInput value={name} onChangeText={setName} placeholder="Nama lengkap" placeholderTextColor={colors.muted} style={styles.input} /></> : null}
        <Text style={styles.inputLabel}>Username</Text><TextInput autoCapitalize="none" value={username} onChangeText={setUsername} placeholder="Masukkan username" placeholderTextColor={colors.muted} style={styles.input} />
        <Text style={styles.inputLabel}>Password</Text><TextInput secureTextEntry value={password} onChangeText={setPassword} placeholder="Minimal 6 karakter" placeholderTextColor={colors.muted} style={styles.input} />
        {error ? <Text style={{ color: colors.error, fontSize: 13, marginBottom: 12 }}>{error}</Text> : null}
        <Pressable accessibilityRole="button" onPress={submit} disabled={busy} style={({ pressed }) => [styles.primaryButton, pressed && { opacity: 0.82 }]}>{busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryButtonText}>{isRegister ? "Daftar dan mulai" : "Masuk ke kasir"}</Text>}</Pressable>
        <Pressable onPress={() => { setIsRegister((value) => !value); setError(""); }} style={{ minHeight: 48, alignItems: "center", justifyContent: "center" }}><Text style={{ color: colors.brandPrimary, fontSize: 14, fontWeight: "700" }}>{isRegister ? "Sudah punya akun? Masuk" : "Daftar bisnis baru"}</Text></Pressable>
      </View>
      <Text style={[styles.muted, { textAlign: "center", marginTop: 16 }]}>Data bisnis tersimpan aman di server Anda.</Text>
    </ScrollView>
  </KeyboardAvoidingView>;
}

function Header({ user, title, subtitle }: { user: User; title: string; subtitle?: string }) {
  const styles = useStyles();
  return <View style={styles.header}><View><Text style={styles.eyebrow}>{user.business_name}</Text><Text style={styles.title}>{title}</Text>{subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}</View><View style={styles.avatar}><Text style={styles.avatarText}>{user.name.slice(0, 1).toUpperCase()}</Text></View></View>;
}

function CashierScreen({ user, products, report, onReload, onTransaction, qrisEnabled }: { user: User; products: Product[]; report: Report; onReload: () => Promise<void>; onTransaction: (item: CartItem[], payment: string, paid: number) => Promise<void>; qrisEnabled: boolean }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("Semua");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [checkout, setCheckout] = useState(false);
  const [scanner, setScanner] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const categories = ["Semua", ...Array.from(new Set(products.map((item) => item.category))).slice(0, 5)];
  const filtered = products.filter((item) => (category === "Semua" || item.category === category) && `${item.name} ${item.barcode}`.toLowerCase().includes(search.toLowerCase()));
  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const addToCart = (product: Product) => setCart((current) => { const exists = current.find((item) => item.id === product.id); return exists ? current.map((item) => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item) : [...current, { ...product, quantity: 1 }]; });
  const changeQty = (id: string, delta: number) => setCart((current) => current.map((item) => item.id === id ? { ...item, quantity: item.quantity + delta } : item).filter((item) => item.quantity > 0));
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={false} onRefresh={onReload} tintColor={colors.brandPrimary} />}>
    <Header user={user} title="Kasir" subtitle={`${report.transaction_count} transaksi hari ini`} />
    <View style={styles.row}><TextInput value={search} onChangeText={setSearch} placeholder="Cari nama atau scan barcode" placeholderTextColor={colors.muted} style={styles.search} /><Pressable accessibilityLabel="Scan barcode" onPress={async () => { if (!permission?.granted) await requestPermission(); setScanner(true); }} style={({ pressed }) => [styles.iconButton, pressed && { opacity: 0.75 }]}><Ionicons name="scan-outline" size={22} color={colors.brandPrimary} /></Pressable></View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>{categories.map((item) => <Pressable key={item} onPress={() => setCategory(item)} style={[styles.chip, category === item && styles.chipActive]}><Text style={[styles.chipText, category === item && styles.chipTextActive]}>{item}</Text></Pressable>)}</ScrollView>
    {filtered.length ? <View style={styles.grid}>{filtered.map((product) => <Pressable key={product.id} onPress={() => product.stock > 0 && addToCart(product)} style={({ pressed }) => [styles.product, { width: (width - 52) / 2 }, pressed && { transform: [{ scale: 0.98 }] }]}><ProductVisual product={product} /><Text style={styles.productName} numberOfLines={2}>{product.name}</Text><Text style={styles.price}>{formatRupiah(product.price)}</Text><Text style={[styles.stock, product.stock <= product.min_stock && { color: colors.warning }]}>{product.stock > 0 ? `Stok ${product.stock}` : "Stok habis"}</Text></Pressable>)}</View> : <View style={styles.empty}><Ionicons name="file-tray-outline" size={42} color={colors.muted} /><Text style={[styles.muted, { marginTop: 10 }]}>Belum ada produk yang cocok.</Text></View>}
    {cart.length ? <View style={styles.cartBar}><View style={{ flex: 1 }}><Text style={styles.cartCount}>{cart.reduce((sum, item) => sum + item.quantity, 0)} item di keranjang</Text><Text style={styles.cartTotal}>{formatRupiah(total)}</Text></View><Pressable onPress={() => setCheckout(true)} style={styles.primaryButton}><Text style={styles.primaryButtonText}>Bayar</Text></Pressable></View> : null}
    <Modal visible={checkout} transparent animationType="slide" onRequestClose={() => setCheckout(false)}><View style={styles.modalBackdrop}><View style={styles.modalSheet}><ScrollView><View style={styles.between}><Text style={styles.modalTitle}>Pembayaran</Text><Pressable onPress={() => setCheckout(false)}><Ionicons name="close" size={24} color={colors.onSurface} /></Pressable></View>{cart.map((item) => <View key={item.id} style={[styles.between, { paddingVertical: 8 }]}><View style={{ flex: 1 }}><Text style={styles.productName}>{item.name}</Text><Text style={styles.muted}>{formatRupiah(item.price)} × {item.quantity}</Text></View><View style={styles.row}><Pressable onPress={() => changeQty(item.id, -1)} style={styles.iconButton}><Ionicons name="remove" size={18} color={colors.brandPrimary} /></Pressable><Text style={{ width: 28, textAlign: "center", color: colors.onSurface, fontWeight: "700" }}>{item.quantity}</Text><Pressable onPress={() => changeQty(item.id, 1)} style={styles.iconButton}><Ionicons name="add" size={18} color={colors.brandPrimary} /></Pressable></View></View>)}<View style={[styles.between, { borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: 16, marginTop: 10 }]}><Text style={styles.cardTitle}>Total</Text><Text style={[styles.cardTitle, { color: colors.brandPrimary }]}>{formatRupiah(total)}</Text></View><PaymentForm total={total} cart={cart} onComplete={async (method, paid) => { await onTransaction(cart, method, paid); setCart([]); setCheckout(false); await onReload(); }} qrisEnabled={qrisEnabled} /></ScrollView></View></View></Modal>
    <Modal visible={scanner} animationType="slide" onRequestClose={() => setScanner(false)}><View style={{ flex: 1, backgroundColor: colors.surface, paddingTop: 55 }}><View style={[styles.between, { paddingHorizontal: 20, paddingBottom: 18 }]}><Text style={styles.modalTitle}>Scan barcode</Text><Pressable onPress={() => setScanner(false)}><Ionicons name="close-circle" size={28} color={colors.onSurface} /></Pressable></View>{permission?.granted ? <CameraView style={{ flex: 1 }} barcodeScannerSettings={{ barcodeTypes: ["ean13", "ean8", "code128", "upc_a", "qr"] }} onBarcodeScanned={({ data }) => { setSearch(data); setScanner(false); }}><View style={{ flex: 1, margin: 38, borderWidth: 2, borderColor: colors.onBrandPrimary, borderRadius: 18 }} /></CameraView> : <View style={styles.empty}><Text style={styles.muted}>Izin kamera dibutuhkan untuk scan barcode.</Text><Pressable onPress={requestPermission} style={[styles.primaryButton, { marginTop: 18 }]}><Text style={styles.primaryButtonText}>Izinkan kamera</Text></Pressable></View>}</View></Modal>
  </ScrollView>;
}

function ProductVisual({ product }: { product: Product }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return product.image_base64 ? <Image source={{ uri: `data:image/jpeg;base64,${product.image_base64}` }} style={styles.productImage} resizeMode="cover" /> : <View style={styles.productIcon}><Ionicons name="cube-outline" size={30} color={colors.brandPrimary} /></View>;
}

function PaymentForm({ total, cart, onComplete, qrisEnabled }: { total: number; cart: CartItem[]; onComplete: (method: string, paid: number) => Promise<void>; qrisEnabled: boolean }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [method, setMethod] = useState("cash");
  const [paidText, setPaidText] = useState(String(total));
  const [busy, setBusy] = useState(false);
  const methods = [{ key: "cash", label: "Tunai" }, { key: "credit", label: "Kredit" }, { key: "bank", label: "Bank" }, { key: "wallet", label: "Wallet" }, { key: "qris", label: "QRIS" }];
  return <View style={{ marginTop: 20 }}><Text style={styles.inputLabel}>Metode pembayaran</Text><View style={styles.row}>{methods.map((item) => <Pressable key={item.key} disabled={item.key === "qris" && !qrisEnabled} onPress={() => setMethod(item.key)} style={[styles.paymentChip, method === item.key && styles.paymentActive, item.key === "qris" && !qrisEnabled && { opacity: 0.45 }]}><Text style={styles.paymentText}>{item.label}{item.key === "qris" && !qrisEnabled ? " · N/A" : ""}</Text></Pressable>)}</View>{method === "cash" ? <><Text style={[styles.inputLabel, { marginTop: 15 }]}>Uang diterima</Text><TextInput keyboardType="number-pad" value={paidText} onChangeText={setPaidText} style={styles.input} /></> : null}{method === "qris" && !qrisEnabled ? <Text style={{ color: colors.warning, fontSize: 13, marginTop: 12 }}>QRIS belum dikonfigurasi. Pilih metode lain agar tidak ada pembayaran palsu.</Text> : null}<Pressable disabled={busy || (method === "qris" && !qrisEnabled)} onPress={async () => { setBusy(true); try { await onComplete(method, method === "cash" ? Number(paidText.replace(/\D/g, "")) || 0 : 0); } finally { setBusy(false); } }} style={[styles.primaryButton, { marginTop: 18 }, (busy || (method === "qris" && !qrisEnabled)) && { opacity: 0.55 }]}>{busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryButtonText}>Selesaikan transaksi</Text>}</Pressable><Text style={[styles.muted, { textAlign: "center", marginTop: 10 }]}>{cart.length} produk akan dicatat dan stok diperbarui otomatis.</Text></View>;
}

function InventoryScreen({ products, onReload, onCreate, onImport }: { products: Product[]; onReload: () => Promise<void>; onCreate: () => void; onImport: () => Promise<void> }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("Semua");
  const shown = products.filter((product) => `${product.name} ${product.barcode}`.toLowerCase().includes(search.toLowerCase())).filter((product) => filter === "Semua" || (filter === "Menipis" ? product.stock <= product.min_stock : product.stock === 0));
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={false} onRefresh={onReload} tintColor={colors.brandPrimary} />}><Header user={{ name: "", business_name: "Inventori", id: "", business_id: "", username: "", role: "" }} title="Stok" subtitle={`${products.length} produk terdaftar`} /><View style={styles.row}><TextInput value={search} onChangeText={setSearch} placeholder="Cari produk atau barcode" placeholderTextColor={colors.muted} style={styles.search} /><Pressable testID="add-product-button" accessibilityRole="button" accessibilityLabel="Tambah produk" onPress={onCreate} style={styles.iconButton}><Ionicons name="add" size={24} color={colors.brandPrimary} /></Pressable></View><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>{["Semua", "Menipis", "Habis"].map((item) => <Pressable key={item} onPress={() => setFilter(item)} style={[styles.chip, filter === item && styles.chipActive]}><Text style={[styles.chipText, filter === item && styles.chipTextActive]}>{item}</Text></Pressable>)}</ScrollView><View style={styles.card}><View style={styles.between}><View><Text style={styles.cardTitle}>Kelola katalog</Text><Text style={styles.muted}>Tambah satuan atau import Excel.</Text></View><Pressable onPress={onImport} style={styles.outlineButton}><Text style={styles.outlineText}>Import</Text></Pressable></View>{shown.length ? shown.map((product) => <View key={product.id} style={styles.listRow}><View style={{ flex: 1 }}><Text style={styles.productName}>{product.name}</Text><Text style={styles.muted}>{product.category} · Jual {formatRupiah(product.price)}{product.cost ? ` · Pokok ${formatRupiah(product.cost)}` : ""}</Text></View><View style={{ alignItems: "flex-end" }}><View style={[styles.badge, { backgroundColor: product.stock <= product.min_stock ? colors.surfaceTertiary : colors.brandTertiary }]}><Text style={[styles.badgeText, product.stock <= product.min_stock && { color: colors.warning }]}>{product.stock} stok</Text></View><Text style={[styles.muted, { marginTop: 5 }]}>{product.barcode || product.sku || "Tanpa kode"}</Text></View></View>) : <View style={styles.empty}><Ionicons name="cube-outline" size={40} color={colors.muted} /><Text style={[styles.muted, { marginTop: 10 }]}>Belum ada produk.</Text></View>}</View></ScrollView>;
}

function ReportsScreen({ user, report, onShare }: { user: User; report: Report; onShare: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [period, setPeriod] = useState("daily");
  const [current, setCurrent] = useState(report);
  useEffect(() => { apiRequest<Report>(`/reports/summary?period=${period}`).then(setCurrent).catch(() => undefined); }, [period]); // report refresh is intentionally scoped to the selected period
  const metrics = [["Penjualan", formatRupiah(current.sales_total), "trending-up", colors.brandPrimary], ["Laba kotor", formatRupiah(current.gross_profit), "stats-chart", colors.success], ["Piutang", formatRupiah(current.receivable), "time-outline", colors.warning], ["Saldo kas", formatRupiah(current.cash_balance), "wallet-outline", colors.info]] as const;
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content}><Header user={user} title="Laporan" subtitle="Ringkasan performa bisnis" /><View style={styles.chips}>{["daily", "monthly", "yearly"].map((item) => <Pressable key={item} onPress={() => setPeriod(item)} style={[styles.chip, period === item && styles.chipActive]}><Text style={[styles.chipText, period === item && styles.chipTextActive]}>{item === "daily" ? "Hari ini" : item === "monthly" ? "Bulan ini" : "Tahun ini"}</Text></Pressable>)}</View><View style={styles.metricGrid}>{metrics.map(([label, value, icon, color]) => <View key={label} style={styles.metric}><Ionicons name={icon} size={21} color={color} /><Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricValue}>{value}</Text></View>)}</View><View style={styles.card}><View style={styles.between}><View><Text style={styles.cardTitle}>Aktivitas penjualan</Text><Text style={styles.muted}>{current.transaction_count} transaksi tercatat</Text></View><Ionicons name="bar-chart" size={25} color={colors.brandPrimary} /></View><View style={{ height: 120, justifyContent: "flex-end", flexDirection: "row", alignItems: "flex-end", gap: 16, paddingHorizontal: 18, paddingTop: 24 }}>{[0.34, 0.55, 0.42, 0.76, 0.62, 0.9, 0.7].map((height, index) => <View key={index} style={{ flex: 1, height: `${height * 100}%`, borderRadius: 8, backgroundColor: index === 5 ? colors.brandPrimary : colors.brandTertiary }} />)}</View><Text style={[styles.muted, { textAlign: "center", marginTop: 10 }]}>Visual ringkas • data periode terpilih</Text></View><Pressable onPress={onShare} style={styles.outlineButton}><Text style={styles.outlineText}>Bagikan laporan</Text></Pressable></ScrollView>;
}

function MoreScreen({ user, integrations, onBackup, onImport, onLogout }: { user: User; integrations: IntegrationState; onBackup: () => void; onImport: () => Promise<void>; onLogout: () => Promise<void> }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const rows = [{ icon: "people-outline", title: "Operator & kewenangan", detail: "Atur akses kasir dan tim" }, { icon: "print-outline", title: "Printer & struk", detail: "Ukuran 58mm / 80mm, dapur, logo" }, { icon: "card-outline", title: "QRIS", detail: integrations.qris.configured ? "Aktif" : "Belum dikonfigurasi" }, { icon: "logo-whatsapp", title: "WhatsApp", detail: integrations.whatsapp.configured ? "Terhubung" : "Gunakan share Android" }];
  return <ScrollView style={styles.screen} contentContainerStyle={styles.content}><Header user={user} title="Lainnya" subtitle="Pengaturan operasional toko" /><View style={styles.greenCard}><Text style={styles.white}>Pusat kendali</Text><Text style={styles.bigWhite}>{user.business_name}</Text><Text style={[styles.white, { opacity: 0.78, marginTop: 7 }]}>Pemilik · {user.name}</Text></View><View style={styles.card}>{rows.map((row) => <View key={row.title} style={styles.settingRow}><View style={styles.settingIcon}><Ionicons name={row.icon as keyof typeof Ionicons.glyphMap} size={20} color={colors.brandPrimary} /></View><View style={{ flex: 1 }}><Text style={styles.productName}>{row.title}</Text><Text style={styles.muted}>{row.detail}</Text></View><Ionicons name="chevron-forward" size={19} color={colors.muted} /></View>)}</View><View style={styles.card}><Text style={styles.cardTitle}>Data & keamanan</Text><Pressable onPress={onBackup} style={styles.settingRow}><View style={styles.settingIcon}><Ionicons name="cloud-download-outline" size={20} color={colors.brandPrimary} /></View><View style={{ flex: 1 }}><Text style={styles.productName}>Backup data</Text><Text style={styles.muted}>Bagikan salinan JSON bisnis</Text></View><Ionicons name="share-outline" size={19} color={colors.muted} /></Pressable><Pressable onPress={onImport} style={styles.settingRow}><View style={styles.settingIcon}><Ionicons name="document-attach-outline" size={20} color={colors.brandPrimary} /></View><View style={{ flex: 1 }}><Text style={styles.productName}>Import Excel</Text><Text style={styles.muted}>Masukkan katalog secara massal</Text></View><Ionicons name="chevron-forward" size={19} color={colors.muted} /></Pressable></View><Pressable onPress={onLogout} style={[styles.outlineButton, { borderColor: colors.error, marginTop: 2 }]}><Text style={{ color: colors.error, fontWeight: "800" }}>Keluar dari akun</Text></Pressable><Text style={[styles.muted, { textAlign: "center", marginTop: 24 }]}>KasirKu Pro · Data tersinkronkan dengan server</Text></ScrollView>;
}

function ProductModal({ visible, onClose, onSaved }: { visible: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [name, setName] = useState(""); const [price, setPrice] = useState(""); const [cost, setCost] = useState(""); const [stock, setStock] = useState(""); const [category, setCategory] = useState("Umum"); const [barcode, setBarcode] = useState(""); const [image, setImage] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const pickImage = async () => { const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7, base64: true }); if (!result.canceled) setImage(result.assets[0].base64 ?? null); };
  const save = async () => { if (!name || !price) return Alert.alert("Data belum lengkap", "Nama dan harga produk wajib diisi."); setBusy(true); try { await apiRequest("/products", { method: "POST", body: JSON.stringify({ name, price: Number(price.replace(/\D/g, "")), cost: Number(cost.replace(/\D/g, "")) || 0, stock: Number(stock.replace(/\D/g, "")) || 0, category, barcode, sku: barcode, min_stock: 5, image_base64: image }) }); setName(""); setPrice(""); setCost(""); setStock(""); setCategory("Umum"); setBarcode(""); setImage(null); onClose(); await onSaved(); } catch (e) { Alert.alert("Gagal menyimpan", e instanceof Error ? e.message : "Coba lagi."); } finally { setBusy(false); } };
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}><View style={styles.modalBackdrop}><KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.modalSheet}><ScrollView><View style={styles.between}><Text style={styles.modalTitle}>Tambah produk</Text><Pressable onPress={onClose}><Ionicons name="close" size={24} color={colors.onSurface} /></Pressable></View><Pressable testID="product-image-picker" onPress={pickImage} style={[styles.productIcon, { height: 110 }]}>{image ? <Image source={{ uri: `data:image/jpeg;base64,${image}` }} style={{ width: "100%", height: "100%", borderRadius: 13 }} /> : <><Ionicons name="camera-outline" size={28} color={colors.brandPrimary} /><Text style={[styles.muted, { marginTop: 5 }]}>Tambah foto produk</Text></>}</Pressable><Text style={styles.inputLabel}>Nama produk</Text><TextInput testID="product-name-input" value={name} onChangeText={setName} style={styles.input} placeholder="Contoh: Kopi susu" placeholderTextColor={colors.muted} /><Text style={styles.inputLabel}>Harga pokok (modal)</Text><TextInput testID="product-cost-input" value={cost} onChangeText={setCost} keyboardType="number-pad" style={styles.input} placeholder="10000" placeholderTextColor={colors.muted} /><Text style={styles.inputLabel}>Harga jual</Text><TextInput testID="product-price-input" value={price} onChangeText={setPrice} keyboardType="number-pad" style={styles.input} placeholder="15000" placeholderTextColor={colors.muted} /><Text style={styles.inputLabel}>Stok awal</Text><TextInput testID="product-stock-input" value={stock} onChangeText={setStock} keyboardType="number-pad" style={styles.input} placeholder="0" placeholderTextColor={colors.muted} /><Text style={styles.inputLabel}>Kategori</Text><TextInput testID="product-category-input" value={category} onChangeText={setCategory} style={styles.input} placeholder="Umum" placeholderTextColor={colors.muted} /><Text style={styles.inputLabel}>Barcode / SKU</Text><TextInput testID="product-barcode-input" value={barcode} onChangeText={setBarcode} style={styles.input} placeholder="Opsional" placeholderTextColor={colors.muted} /><Pressable testID="save-product-button" disabled={busy} onPress={save} style={[styles.primaryButton, busy && { opacity: 0.6 }]}>{busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryButtonText}>Simpan produk</Text>}</Pressable></ScrollView></KeyboardAvoidingView></View></Modal>;
}

export default function Index() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [user, setUser] = useState<User | null>(null); const [booting, setBooting] = useState(true); const [tab, setTab] = useState<Tab>("kasir"); const [products, setProducts] = useState<Product[]>([]); const [report, setReport] = useState<Report>({ sales_total: 0, purchase_total: 0, transaction_count: 0, gross_profit: 0, receivable: 0, payable: 0, low_stock: 0, cash_balance: 0 }); const [integrations, setIntegrations] = useState<IntegrationState>({ qris: { configured: false }, whatsapp: { configured: false }, bluetooth_printing: { configured: false } }); const [productModal, setProductModal] = useState(false);
  const loadData = async () => { if (!user) return; const [nextProducts, nextReport, nextIntegrations] = await Promise.all([apiRequest<Product[]>("/products"), apiRequest<Report>("/reports/summary"), apiRequest<IntegrationState>("/integrations/status")]); setProducts(nextProducts); setReport(nextReport); setIntegrations(nextIntegrations); };
  useEffect(() => { storage.secureGet<string | null>("kasirku_auth_token", null).then(async (token) => { if (token) { try { const current = await apiRequest<User>("/auth/me"); setUser(current); } catch { await clearToken(); } } setBooting(false); }); }, []);
  // The loader intentionally follows the authenticated user lifecycle.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (user) loadData().catch((e) => Alert.alert("Server belum siap", e instanceof Error ? e.message : "Coba lagi.")); }, [user]);
  const authenticate = async (result: { token: string; user: User }) => { await saveToken(result.token); setUser(result.user); };
  const createTransaction = async (items: CartItem[], method: string, paid: number) => { try { await apiRequest("/transactions", { method: "POST", body: JSON.stringify({ transaction_type: "sale", payment_method: method, paid_amount: paid, items: items.map((item) => ({ product_id: item.id, name: item.name, quantity: item.quantity, price: item.price, cost: item.cost })) }) }); Alert.alert("Transaksi berhasil", "Stok dan laporan sudah diperbarui."); } catch (e) { Alert.alert("Transaksi gagal", e instanceof Error ? e.message : "Coba lagi."); throw e; } };
  const importExcel = async () => { try { const result = await DocumentPicker.getDocumentAsync({ type: ["text/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel"], copyToCacheDirectory: true }); if (!result.canceled) { const file = result.assets[0]; const response = await uploadProducts({ uri: file.uri, name: file.name, mimeType: file.mimeType }); Alert.alert("Import selesai", `${response.imported} produk berhasil ditambahkan.`); await loadData(); } } catch (e) { Alert.alert("Import gagal", e instanceof Error ? e.message : "Periksa format file."); } };
  const backup = async () => { try { const data = await apiRequest<Record<string, unknown>>("/backup"); await Share.share({ title: "Backup KasirKu Pro", message: JSON.stringify(data, null, 2) }); } catch (e) { Alert.alert("Backup gagal", e instanceof Error ? e.message : "Coba lagi."); } };
  const shareReport = async () => { await Share.share({ title: "Laporan KasirKu Pro", message: `Laporan ${user?.business_name}\nPenjualan: ${formatRupiah(report.sales_total)}\nLaba kotor: ${formatRupiah(report.gross_profit)}\nTransaksi: ${report.transaction_count}\nSaldo kas: ${formatRupiah(report.cash_balance)}` }); };
  if (booting) return <View style={[styles.screen, { alignItems: "center", justifyContent: "center" }]}><ActivityIndicator size="large" color={colors.brandPrimary} /><Text style={[styles.muted, { marginTop: 12 }]}>Menyiapkan KasirKu Pro…</Text></View>;
  if (!user) return <AuthScreen onAuthenticated={authenticate} />;
  return <View style={[styles.screen, { paddingTop: insets.top }]}>{tab === "kasir" ? <CashierScreen user={user} products={products} report={report} onReload={loadData} onTransaction={createTransaction} qrisEnabled={integrations.qris.configured} /> : tab === "stok" ? <InventoryScreen products={products} onReload={loadData} onCreate={() => setProductModal(true)} onImport={importExcel} /> : tab === "laporan" ? <ReportsScreen user={user} report={report} onShare={shareReport} /> : <MoreScreen user={user} integrations={integrations} onBackup={backup} onImport={importExcel} onLogout={async () => { await clearToken(); setUser(null); }} />}<View style={[styles.nav, { paddingBottom: Math.max(insets.bottom, 8) }]}>{navItems.map((item) => <Pressable key={item.key} onPress={() => setTab(item.key)} style={styles.navItem}><Ionicons name={item.icon} size={23} color={tab === item.key ? colors.brandPrimary : colors.muted} /><Text style={[styles.navText, tab === item.key && styles.navTextActive]}>{item.label}</Text></Pressable>)}</View><ProductModal visible={productModal} onClose={() => setProductModal(false)} onSaved={loadData} /></View>;
}