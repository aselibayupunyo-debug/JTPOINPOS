import Ionicons from "@expo/vector-icons/Ionicons";
import { CameraView, useCameraPermissions } from "expo-camera";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Image, Modal, Pressable, RefreshControl, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { cachedGet, CartItem, Contact, formatRupiah, IntegrationState, PAYMENT_LABELS, PaymentMethod, Product, ReportSummary, syncMutation } from "@/src/api";
import { useAppStyles } from "@/src/app-styles";
import { useAuth } from "@/src/auth-context";
import { Header } from "@/src/components/header";
import { SyncBanner } from "@/src/components/sync-banner";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";

export default function KasirScreen() {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { user, can } = useAuth();
  const toast = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Contact[]>([]);
  const [report, setReport] = useState<ReportSummary | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationState | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("Semua");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [checkout, setCheckout] = useState(false);
  const [scanner, setScanner] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  const load = useCallback(async () => {
    try {
      const [p, c, r, i] = await Promise.all([
        cachedGet<Product[]>("/products"),
        cachedGet<Contact[]>("/customers"),
        cachedGet<ReportSummary>("/reports/summary"),
        cachedGet<IntegrationState>("/integrations/status"),
      ]);
      setProducts(p.data); setCustomers(c.data); setReport(r.data); setIntegrations(i.data);
    } catch (e) {
      toast.error("Gagal memuat data", e instanceof Error ? e.message : undefined);
    }
  }, [toast]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!can("sales")) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top, alignItems: "center", justifyContent: "center", padding: 24 }]}>
        <Ionicons name="lock-closed-outline" size={44} color={colors.muted} />
        <Text style={[styles.title, { fontSize: 22, textAlign: "center", marginTop: 16 }]}>Akses Kasir dinonaktifkan</Text>
        <Text style={[styles.subtitle, { textAlign: "center" }]}>Hubungi pemilik untuk mengaktifkan kewenangan Penjualan.</Text>
      </View>
    );
  }

  const filteredCategories = ["Semua", ...Array.from(new Set(products.map((p) => p.category))).slice(0, 8)];
  const filtered = products.filter((p) => (category === "Semua" || p.category === category) && `${p.name} ${p.barcode} ${p.sku}`.toLowerCase().includes(search.toLowerCase()));
  const totalCart = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const addToCart = (product: Product) => {
    if (product.stock <= 0) return toast.error("Stok habis", product.name);
    setCart((current) => {
      const exists = current.find((item) => item.id === product.id);
      if (exists) return current.map((item) => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      return [...current, { ...product, quantity: 1 }];
    });
  };
  const changeQty = (id: string, delta: number) => setCart((c) => c.map((i) => i.id === id ? { ...i, quantity: i.quantity + delta } : i).filter((i) => i.quantity > 0));

  const openScanner = async () => {
    if (!permission?.granted) {
      const next = await requestPermission();
      if (!next.granted) return toast.error("Izin kamera ditolak", "Aktifkan di pengaturan sistem untuk scan barcode.");
    }
    setScanner(true);
  };

  const onBarcode = (data: string) => {
    setScanner(false);
    setSearch(data);
    const match = products.find((p) => p.barcode === data || p.sku === data);
    if (match) addToCart(match); else toast.info("Barcode belum terdaftar", data);
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={colors.brandPrimary} />}
      >
        <Header
          eyebrow={user?.business_name}
          title="Kasir"
          subtitle={report ? `${report.transaction_count} transaksi · Saldo kas ${formatRupiah(report.cash_balance)}` : "Memuat data…"}
          right={<View style={styles.avatar}><Text style={styles.avatarText}>{user?.name.slice(0, 1).toUpperCase()}</Text></View>}
        />
        <SyncBanner />
        <View style={styles.row}>
          <TextInput testID="search-input" value={search} onChangeText={setSearch} placeholder="Cari nama / barcode / SKU" placeholderTextColor={colors.muted} style={styles.search} />
          <Pressable testID="scan-button" onPress={openScanner} style={({ pressed }) => [styles.iconButton, pressed && { opacity: 0.75 }]}>
            <Ionicons name="scan-outline" size={22} color={colors.brandPrimary} />
          </Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {filteredCategories.map((c) => (
            <Pressable key={c} onPress={() => setCategory(c)} style={[styles.chip, category === c && styles.chipActive]}>
              <Text style={[styles.chipText, category === c && styles.chipTextActive]}>{c}</Text>
            </Pressable>
          ))}
        </ScrollView>
        {filtered.length ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 12 }}>
            {filtered.map((p) => (
              <Pressable
                key={p.id}
                testID={`product-${p.id}`}
                onPress={() => addToCart(p)}
                style={({ pressed }) => [
                  { width: (width - 52) / 2, backgroundColor: colors.surfaceSecondary, borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 12 },
                  pressed && { transform: [{ scale: 0.98 }] },
                ]}
              >
                {p.image_base64 ? (
                  <Image source={{ uri: `data:image/jpeg;base64,${p.image_base64}` }} style={{ width: "100%", height: 92, borderRadius: 13, marginBottom: 10 }} />
                ) : (
                  <View style={{ width: "100%", height: 92, borderRadius: 13, marginBottom: 10, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="cube-outline" size={30} color={colors.brandPrimary} />
                  </View>
                )}
                <Text style={styles.productName} numberOfLines={2}>{p.name}</Text>
                <Text style={styles.price}>{formatRupiah(p.price)}</Text>
                <Text style={[styles.stock, p.stock <= p.min_stock && { color: colors.warning }]}>{p.stock > 0 ? `Stok ${p.stock}` : "Stok habis"}</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <View style={styles.empty}>
            <Ionicons name="file-tray-outline" size={42} color={colors.muted} />
            <Text style={[styles.muted, { marginTop: 10 }]}>{products.length === 0 ? "Belum ada produk. Tambahkan di tab Stok." : "Belum ada produk yang cocok."}</Text>
          </View>
        )}
      </ScrollView>
      {cart.length ? (
        <View style={{ position: "absolute", left: 20, right: 20, bottom: insets.bottom + 70, backgroundColor: colors.surfaceInverse, borderRadius: 20, padding: 16, flexDirection: "row", alignItems: "center" }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.onSurfaceInverse, fontSize: 13, fontWeight: "700" }}>{cart.reduce((s, i) => s + i.quantity, 0)} item di keranjang</Text>
            <Text style={{ color: colors.onSurfaceInverse, fontSize: 18, fontWeight: "800", marginTop: 3 }}>{formatRupiah(totalCart)}</Text>
          </View>
          <Pressable testID="checkout-button" onPress={() => setCheckout(true)} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Bayar</Text>
          </Pressable>
        </View>
      ) : null}

      <Modal visible={scanner} animationType="slide" onRequestClose={() => setScanner(false)}>
        <View style={{ flex: 1, backgroundColor: colors.surface }}>
          <View style={{ paddingTop: insets.top + 10, paddingBottom: 14, paddingHorizontal: 20, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ color: colors.onSurface, fontSize: 20, fontWeight: "800" }}>Scan barcode</Text>
            <Pressable onPress={() => setScanner(false)}><Ionicons name="close-circle" size={28} color={colors.onSurface} /></Pressable>
          </View>
          {permission?.granted ? (
            <CameraView
              style={{ flex: 1 }}
              barcodeScannerSettings={{ barcodeTypes: ["ean13", "ean8", "code128", "upc_a", "qr"] }}
              onBarcodeScanned={({ data }) => onBarcode(data)}
            >
              <View style={{ flex: 1, margin: 38, borderWidth: 2, borderColor: colors.onBrandPrimary, borderRadius: 18 }} />
            </CameraView>
          ) : (
            <View style={styles.empty}>
              <Text style={styles.muted}>Izin kamera dibutuhkan untuk scan.</Text>
              <Pressable onPress={() => requestPermission()} style={[styles.primaryButton, { marginTop: 18 }]}>
                <Text style={styles.primaryButtonText}>Izinkan kamera</Text>
              </Pressable>
            </View>
          )}
        </View>
      </Modal>

      <CheckoutSheet
        visible={checkout}
        onClose={() => setCheckout(false)}
        cart={cart}
        total={totalCart}
        customers={customers}
        changeQty={changeQty}
        qrisEnabled={integrations?.qris.configured ?? false}
        onComplete={async (method, paid, customer, customer_id, note) => {
          try {
            const result = await syncMutation("POST", "/transactions", {
              transaction_type: "sale",
              payment_method: method,
              paid_amount: paid,
              customer_name: customer,
              customer_id,
              note,
              items: cart.map((item) => ({ product_id: item.id, name: item.name, quantity: item.quantity, price: item.price, cost: item.cost, kitchen_print: !!item.kitchen_print })),
            });
            if (result.queued) {
              toast.info("Transaksi disimpan offline", "Akan dikirim otomatis saat online.");
            } else {
              toast.success("Transaksi berhasil", "Stok & laporan diperbarui.");
            }
            setCart([]);
            setCheckout(false);
            await load();
            const txId = (result.data as { id?: string } | null)?.id;
            if (txId) router.push({ pathname: "/receipt", params: { id: txId } });
          } catch (e) {
            toast.error("Transaksi gagal", e instanceof Error ? e.message : undefined);
          }
        }}
      />
    </View>
  );
}

function CheckoutSheet({
  visible, onClose, cart, total, customers, changeQty, qrisEnabled, onComplete,
}: {
  visible: boolean;
  onClose: () => void;
  cart: CartItem[];
  total: number;
  customers: Contact[];
  changeQty: (id: string, delta: number) => void;
  qrisEnabled: boolean;
  onComplete: (method: PaymentMethod, paid: number, customer: string, customer_id: string | null, note: string) => Promise<void>;
}) {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [paidText, setPaidText] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const methods: PaymentMethod[] = ["cash", "credit", "bank", "wallet", "qris"];
  const paidNumber = Number(paidText.replace(/\D/g, "")) || 0;
  const change = method === "cash" ? Math.max(paidNumber - total, 0) : 0;
  const insufficient = method === "cash" && paidNumber < total;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(28,28,30,0.55)", justifyContent: "flex-end" }}>
        <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 26, borderTopRightRadius: 26, maxHeight: "90%" }}>
          <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
            <View style={styles.between}>
              <Text style={[styles.title, { fontSize: 22 }]}>Pembayaran</Text>
              <Pressable onPress={onClose}><Ionicons name="close" size={24} color={colors.onSurface} /></Pressable>
            </View>
            {cart.map((item) => (
              <View key={item.id} style={[styles.between, { paddingVertical: 10 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.productName}>{item.name}</Text>
                  <Text style={styles.muted}>{formatRupiah(item.price)} × {item.quantity}</Text>
                </View>
                <View style={styles.row}>
                  <Pressable testID={`qty-minus-${item.id}`} onPress={() => changeQty(item.id, -1)} style={styles.iconButton}><Ionicons name="remove" size={18} color={colors.brandPrimary} /></Pressable>
                  <Text style={{ width: 28, textAlign: "center", color: colors.onSurface, fontWeight: "700" }}>{item.quantity}</Text>
                  <Pressable testID={`qty-plus-${item.id}`} onPress={() => changeQty(item.id, 1)} style={styles.iconButton}><Ionicons name="add" size={18} color={colors.brandPrimary} /></Pressable>
                </View>
              </View>
            ))}
            <View style={[styles.between, { borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: 16, marginTop: 10 }]}>
              <Text style={styles.cardTitle}>Total</Text>
              <Text style={[styles.cardTitle, { color: colors.brandPrimary }]}>{formatRupiah(total)}</Text>
            </View>
            <Text style={[styles.inputLabel, { marginTop: 18 }]}>Metode pembayaran</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {methods.map((m) => {
                const disabled = m === "qris" && !qrisEnabled;
                const active = method === m;
                return (
                  <Pressable
                    key={m}
                    testID={`pay-${m}`}
                    disabled={disabled}
                    onPress={() => setMethod(m)}
                    style={[{ paddingHorizontal: 14, minHeight: 44, borderRadius: 12, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" }, active && { backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandPrimary }, disabled && { opacity: 0.45 }]}
                  >
                    <Text style={{ color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "800" }}>{PAYMENT_LABELS[m]}{disabled ? " · N/A" : ""}</Text>
                  </Pressable>
                );
              })}
            </View>
            {method === "qris" && !qrisEnabled ? (
              <Text style={{ color: colors.warning, fontSize: 13, marginTop: 12 }}>QRIS belum dikonfigurasi. Hubungkan provider QRIS lewat Pengaturan.</Text>
            ) : null}
            {method === "cash" ? (
              <>
                <Text style={[styles.inputLabel, { marginTop: 15 }]}>Uang diterima</Text>
                <TextInput testID="paid-input" keyboardType="number-pad" value={paidText} onChangeText={setPaidText} placeholder={String(total)} placeholderTextColor={colors.muted} style={styles.input} />
                <View style={styles.between}>
                  <Text style={styles.muted}>Kembalian</Text>
                  <Text style={[styles.productName, { color: insufficient ? colors.error : colors.success }]}>{insufficient ? "Nominal kurang" : formatRupiah(change)}</Text>
                </View>
              </>
            ) : null}
            <Text style={[styles.inputLabel, { marginTop: 15 }]}>Pelanggan</Text>
            <View style={[styles.row, { gap: 10, marginBottom: 12 }]}>
              <TextInput testID="customer-input" value={customerName} onChangeText={(t) => { setCustomerName(t); setCustomerId(null); }} placeholder={method === "credit" ? "Wajib untuk kredit" : "Umum / nama pelanggan"} placeholderTextColor={colors.muted} style={[styles.input, { flex: 1, marginBottom: 0 }]} />
              <Pressable testID="pick-customer" onPress={() => setPicker(true)} style={styles.iconButton}><Ionicons name="people-outline" size={22} color={colors.brandPrimary} /></Pressable>
            </View>
            <Text style={styles.inputLabel}>Catatan (opsional)</Text>
            <TextInput value={note} onChangeText={setNote} placeholder="Misal: diskon spesial" placeholderTextColor={colors.muted} style={styles.input} />
            <Pressable
              testID="confirm-pay"
              disabled={busy || insufficient || (method === "credit" && !customerName.trim())}
              onPress={async () => {
                setBusy(true);
                try {
                  await onComplete(method, method === "cash" ? paidNumber : 0, customerName.trim() || "Umum", customerId, note);
                  setPaidText(""); setCustomerName(""); setCustomerId(null); setNote(""); setMethod("cash");
                } finally { setBusy(false); }
              }}
              style={[styles.primaryButton, { marginTop: 8 }, (busy || insufficient || (method === "credit" && !customerName.trim())) && { opacity: 0.5 }]}
            >
              {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryButtonText}>Selesaikan transaksi</Text>}
            </Pressable>
          </ScrollView>
        </View>
      </View>
      <Modal visible={picker} transparent animationType="fade" onRequestClose={() => setPicker(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(28,28,30,0.55)", justifyContent: "center", padding: 24 }}>
          <View style={{ backgroundColor: colors.surface, borderRadius: 20, padding: 18, maxHeight: "80%" }}>
            <View style={styles.between}>
              <Text style={styles.cardTitle}>Pilih pelanggan</Text>
              <Pressable onPress={() => setPicker(false)}><Ionicons name="close" size={22} color={colors.onSurface} /></Pressable>
            </View>
            <ScrollView style={{ marginTop: 10 }}>
              {customers.length === 0 ? <Text style={[styles.muted, { marginTop: 10 }]}>Belum ada pelanggan. Tambahkan di menu Pelanggan.</Text> : customers.map((c) => (
                <Pressable key={c.id} testID={`pick-customer-${c.id}`} onPress={() => { setCustomerName(c.name); setCustomerId(c.id); setPicker(false); }} style={styles.listRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.productName}>{c.name}</Text>
                    <Text style={styles.muted}>{c.phone || "Tanpa nomor"}</Text>
                  </View>
                  <Text style={styles.muted}>{c.transaction_count ?? 0} tx</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </Modal>
  );
}
