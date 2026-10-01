import Ionicons from "@expo/vector-icons/Ionicons";
import { CameraView, useCameraPermissions } from "expo-camera";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Image, Modal, Pressable, RefreshControl, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest, BusinessSettings, cachedGet, CartItem, Contact, formatRupiah, ParkedTransaction, PaymentMethodDoc, Product, ReportSummary, syncMutation } from "@/src/api";
import { useAppStyles } from "@/src/app-styles";
import { useAuth } from "@/src/auth-context";
import { Header } from "@/src/components/header";
import { SyncBanner } from "@/src/components/sync-banner";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";

const CASH_PICKS = [50000, 100000, 150000, 200000, 250000, 300000];

export default function KasirScreen() {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { user, can } = useAuth();
  const toast = useToast();
  const params = useLocalSearchParams<{ parked?: string }>();
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Contact[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodDoc[]>([]);
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [parkedCount, setParkedCount] = useState(0);
  const [report, setReport] = useState<ReportSummary | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("Semua");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [checkout, setCheckout] = useState(false);
  const [scanner, setScanner] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [customer, setCustomer] = useState<Contact | null>(null);
  const [priceLevel, setPriceLevel] = useState<string>("default");
  const [permission, requestPermission] = useCameraPermissions();

  const load = useCallback(async () => {
    try {
      const [p, c, pm, s, parked, r] = await Promise.all([
        cachedGet<Product[]>("/products"),
        cachedGet<Contact[]>("/customers"),
        cachedGet<PaymentMethodDoc[]>("/payment-methods"),
        cachedGet<BusinessSettings>("/settings"),
        cachedGet<ParkedTransaction[]>("/parked"),
        cachedGet<ReportSummary>("/reports/summary"),
      ]);
      setProducts(p.data); setCustomers(c.data); setPaymentMethods(pm.data.filter((m) => m.enabled));
      setSettings(s.data); setParkedCount(parked.data.length); setReport(r.data);
    } catch (e) {
      toast.error("Gagal memuat data", e instanceof Error ? e.message : undefined);
    }
  }, [toast]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Resume parked transaction from params
  useEffect(() => {
    if (!params.parked) return;
    (async () => {
      try {
        const list = await apiRequest<ParkedTransaction[]>("/parked");
        const match = list.find((p) => p.id === params.parked);
        if (!match) return;
        const resumed: CartItem[] = match.items.map((item) => {
          const prod = products.find((p) => p.id === item.product_id);
          return prod ? { ...prod, quantity: item.quantity, unit: item.unit, discount: item.discount, price: item.price } as CartItem : null;
        }).filter(Boolean) as CartItem[];
        setCart(resumed);
        setPriceLevel(match.price_level_id || "default");
        if (match.customer_id) setCustomer(customers.find((c) => c.id === match.customer_id) ?? null);
        await apiRequest(`/parked/${match.id}`, { method: "DELETE" });
        toast.info("Antrian dilanjutkan", match.label || match.customer_name);
        setParkedCount((n) => Math.max(0, n - 1));
      } catch { /* ignore */ }
    })();
  }, [params.parked, products, customers, toast]);

  // Apply customer's default price level
  useEffect(() => {
    if (customer?.price_level_id) setPriceLevel(customer.price_level_id);
  }, [customer]);

  if (!can("sales")) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top, alignItems: "center", justifyContent: "center", padding: 24 }]}>
        <Ionicons name="lock-closed-outline" size={44} color={colors.muted} />
        <Text style={[styles.title, { fontSize: 22, textAlign: "center", marginTop: 16 }]}>Akses Kasir dinonaktifkan</Text>
        <Text style={[styles.subtitle, { textAlign: "center" }]}>Hubungi pemilik untuk mengaktifkan kewenangan Penjualan.</Text>
      </View>
    );
  }

  const priceOf = (product: Product): number => {
    if (priceLevel !== "default" && product.prices?.[priceLevel]) return product.prices[priceLevel];
    return product.price;
  };

  const filteredCategories = ["Semua", ...Array.from(new Set(products.map((p) => p.category))).slice(0, 10)];
  const filtered = products.filter((p) => (category === "Semua" || p.category === category) && `${p.name} ${p.barcode} ${p.sku}`.toLowerCase().includes(search.toLowerCase()));
  const totalCart = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const addToCart = (product: Product) => {
    if (product.stock <= 0) return toast.error("Stok habis", product.name);
    const priceAtLevel = priceOf(product);
    setCart((current) => {
      const exists = current.find((item) => item.id === product.id);
      if (exists) return current.map((item) => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      return [...current, { ...product, quantity: 1, price: priceAtLevel }];
    });
  };
  const changeQty = (id: string, delta: number) => setCart((c) => c.map((i) => i.id === id ? { ...i, quantity: i.quantity + delta } : i).filter((i) => i.quantity > 0));
  const changePrice = (id: string, nextPrice: number) => setCart((c) => c.map((i) => i.id === id ? { ...i, price: nextPrice } : i));
  const removeFromCart = (id: string) => setCart((c) => c.filter((i) => i.id !== id));

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

  const parkTransaction = async () => {
    if (cart.length === 0) return;
    try {
      await apiRequest("/parked", {
        method: "POST",
        body: JSON.stringify({
          label: `Antrian ${new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}`,
          customer_name: customer?.name ?? "Umum",
          customer_id: customer?.id ?? null,
          price_level_id: priceLevel,
          items: cart.map((i) => ({ product_id: i.id, name: i.name, quantity: i.quantity, price: i.price, cost: i.cost, unit: i.unit ?? "", discount: i.discount ?? 0 })),
          note: "",
          discount_percent: 0, discount_amount: 0, tax_percent: 0, shipping: 0,
        }),
      });
      toast.success("Transaksi diparkir", "Buka menu Antrian untuk melanjutkan.");
      setCart([]); setCustomer(null);
      setParkedCount((n) => n + 1);
    } catch (e) {
      toast.error("Gagal park", e instanceof Error ? e.message : undefined);
    }
  };

  const cancelTransaction = () => {
    if (cart.length === 0) return;
    const doCancel = () => { setCart([]); setCustomer(null); toast.info("Transaksi dibatalkan"); setCheckout(false); };
    if (settings?.confirm_cancel) {
      Alert.alert("Batalkan transaksi?", "Semua item di keranjang akan dihapus.", [
        { text: "Tidak", style: "cancel" },
        { text: "Ya, batal", style: "destructive", onPress: doCancel },
      ]);
    } else { doCancel(); }
  };

  const activePriceLevels = settings?.price_levels ?? [{ id: "default", name: "Harga Jual" }];

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
          right={
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Pressable testID="parked-queue-button" onPress={() => router.push("/parked")} style={[styles.iconButton, { marginLeft: 0 }]}>
                <Ionicons name="layers-outline" size={20} color={colors.brandPrimary} />
                {parkedCount > 0 ? <View style={{ position: "absolute", top: -4, right: -4, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.error, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 }}><Text style={{ color: colors.onError, fontSize: 10, fontWeight: "800" }}>{parkedCount}</Text></View> : null}
              </Pressable>
              <View style={styles.avatar}><Text style={styles.avatarText}>{user?.name.slice(0, 1).toUpperCase()}</Text></View>
            </View>
          }
        />
        <SyncBanner />
        <View style={styles.row}>
          <TextInput testID="search-input" value={search} onChangeText={setSearch} placeholder="Cari nama / barcode / SKU" placeholderTextColor={colors.muted} style={styles.search} />
          <Pressable testID="scan-button" onPress={openScanner} style={({ pressed }) => [styles.iconButton, pressed && { opacity: 0.75 }]}>
            <Ionicons name="scan-outline" size={22} color={colors.brandPrimary} />
          </Pressable>
        </View>
        {activePriceLevels.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {activePriceLevels.map((lvl) => (
              <Pressable key={lvl.id} testID={`level-${lvl.id}`} onPress={() => setPriceLevel(lvl.id)} style={[styles.chip, priceLevel === lvl.id && styles.chipActive]}>
                <Text style={[styles.chipText, priceLevel === lvl.id && styles.chipTextActive]}>{lvl.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
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
                <Text style={styles.price}>{formatRupiah(priceOf(p))}</Text>
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
        <View style={{ position: "absolute", left: 20, right: 20, bottom: insets.bottom + 70, backgroundColor: colors.surfaceInverse, borderRadius: 20, padding: 16 }}>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.onSurfaceInverse, fontSize: 13, fontWeight: "700" }}>{cart.reduce((s, i) => s + i.quantity, 0)} item{customer ? ` · ${customer.name}` : ""}</Text>
              <Text style={{ color: colors.onSurfaceInverse, fontSize: 18, fontWeight: "800", marginTop: 3 }}>{formatRupiah(totalCart)}</Text>
            </View>
            <Pressable testID="checkout-button" onPress={() => setCheckout(true)} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>Bayar</Text>
            </Pressable>
          </View>
          <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
            <Pressable testID="park-button" onPress={parkTransaction} style={[styles.outlineButton, { flex: 1, borderColor: colors.onSurfaceInverse }]}>
              <Text style={{ color: colors.onSurfaceInverse, fontWeight: "800", fontSize: 13 }}>Park / Antri</Text>
            </Pressable>
            <Pressable testID="cancel-button" onPress={cancelTransaction} style={[styles.outlineButton, { flex: 1, borderColor: colors.error }]}>
              <Text style={{ color: colors.error, fontWeight: "800", fontSize: 13 }}>Batal</Text>
            </Pressable>
          </View>
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
        customers={customers}
        customer={customer}
        setCustomer={setCustomer}
        paymentMethods={paymentMethods}
        settings={settings}
        changeQty={changeQty}
        changePrice={changePrice}
        removeFromCart={removeFromCart}
        onCancel={cancelTransaction}
        onPark={parkTransaction}
        onComplete={async (method, paid, cName, cId, note, discountPct, discountAmt, taxPct, shipping) => {
          try {
            const result = await syncMutation("POST", "/transactions", {
              transaction_type: "sale",
              payment_method: method.id,
              payment_method_label: method.name,
              paid_amount: paid,
              customer_name: cName, customer_id: cId,
              price_level_id: priceLevel,
              discount_percent: discountPct, discount_amount: discountAmt,
              tax_percent: taxPct, shipping,
              note,
              items: cart.map((item) => ({ product_id: item.id, name: item.name, quantity: item.quantity, price: item.price, cost: item.cost, discount: item.discount ?? 0, unit: item.unit ?? "", kitchen_print: !!item.kitchen_print })),
            });
            if (result.queued) {
              toast.info("Transaksi disimpan offline", "Akan dikirim otomatis saat online.");
            } else {
              toast.success("Transaksi berhasil", "Stok & laporan diperbarui.");
            }
            setCart([]); setCustomer(null); setCheckout(false);
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
  visible, onClose, cart, customers, customer, setCustomer, paymentMethods, settings, changeQty, changePrice, removeFromCart, onCancel, onPark, onComplete,
}: {
  visible: boolean;
  onClose: () => void;
  cart: CartItem[];
  customers: Contact[];
  customer: Contact | null;
  setCustomer: (c: Contact | null) => void;
  paymentMethods: PaymentMethodDoc[];
  settings: BusinessSettings | null;
  changeQty: (id: string, delta: number) => void;
  changePrice: (id: string, next: number) => void;
  removeFromCart: (id: string) => void;
  onCancel: () => void;
  onPark: () => void;
  onComplete: (method: PaymentMethodDoc, paid: number, customerName: string, customerId: string | null, note: string, discountPct: number, discountAmt: number, taxPct: number, shipping: number) => Promise<void>;
}) {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const [method, setMethod] = useState<PaymentMethodDoc | null>(null);
  const [paidText, setPaidText] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [picker, setPicker] = useState(false);
  const [discountPct, setDiscountPct] = useState("0");
  const [discountAmt, setDiscountAmt] = useState("0");
  const [taxPct, setTaxPct] = useState("");
  const [shipping, setShipping] = useState("0");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setMethod(paymentMethods[0] ?? null);
      setCustomerName(customer?.name ?? "");
      setTaxPct(String(settings?.tax_percent ?? 0));
      setShipping(String(settings?.shipping_default ?? 0));
      setDiscountPct("0"); setDiscountAmt("0"); setPaidText(""); setNote("");
    }
  }, [visible, paymentMethods, customer, settings]);

  const subtotal = cart.reduce((s, i) => s + i.price * i.quantity, 0);
  const itemDiscount = cart.reduce((s, i) => s + (i.discount ?? 0), 0);
  const afterItemDisc = subtotal - itemDiscount;
  const dPct = Number(discountPct.replace(/\D/g, "")) || 0;
  const dAmt = Number(discountAmt.replace(/\D/g, "")) || 0;
  const globalDisc = dAmt + Math.round(afterItemDisc * dPct / 100);
  const afterDisc = Math.max(afterItemDisc - globalDisc, 0);
  const tPct = Number(taxPct.replace(/[^0-9.]/g, "")) || 0;
  const taxAmt = Math.round(afterDisc * tPct / 100);
  const shippingNum = Number(shipping.replace(/\D/g, "")) || 0;
  const grandTotal = afterDisc + taxAmt + shippingNum;
  const kind = method?.kind ?? "cash";

  // Default paid for cash = grand total
  useEffect(() => {
    if (kind === "cash" && !paidText) setPaidText(String(grandTotal));
  }, [kind, grandTotal, paidText]);

  const paidNumber = Number(paidText.replace(/\D/g, "")) || 0;
  const change = kind === "cash" ? Math.max(paidNumber - grandTotal, 0) : 0;
  const insufficient = kind === "cash" && paidNumber < grandTotal;

  const totals: { label: string; value: number }[] = [
    { label: "Subtotal", value: subtotal },
    ...(itemDiscount ? [{ label: "Diskon item", value: -itemDiscount }] : []),
    ...(globalDisc ? [{ label: `Diskon${dPct ? ` ${dPct}%` : ""}`, value: -globalDisc }] : []),
    ...(taxAmt ? [{ label: `${settings?.tax_label || "Pajak"} ${tPct}%`, value: taxAmt }] : []),
    ...(shippingNum ? [{ label: "Ongkir", value: shippingNum }] : []),
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(28,28,30,0.55)", justifyContent: "flex-end" }}>
        <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 26, borderTopRightRadius: 26, maxHeight: "92%" }}>
          <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
            <View style={styles.between}>
              <Text style={[styles.title, { fontSize: 22 }]}>Pembayaran</Text>
              <Pressable testID="close-checkout" onPress={onClose}><Ionicons name="close" size={24} color={colors.onSurface} /></Pressable>
            </View>
            {cart.map((item) => (
              <View key={item.id} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.divider }}>
                <View style={styles.between}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.productName}>{item.name}</Text>
                    {editing === item.id && (settings?.allow_price_edit ?? true) ? (
                      <View style={[styles.row, { marginTop: 6 }]}>
                        <TextInput
                          testID={`edit-price-${item.id}`}
                          keyboardType="number-pad"
                          autoFocus
                          defaultValue={String(item.price)}
                          onBlur={(e) => { changePrice(item.id, Number(e.nativeEvent.text.replace(/\D/g, "")) || item.price); setEditing(null); }}
                          onSubmitEditing={(e) => { changePrice(item.id, Number(e.nativeEvent.text.replace(/\D/g, "")) || item.price); setEditing(null); }}
                          style={[styles.input, { marginBottom: 0, flex: 1, minHeight: 36 }]}
                        />
                      </View>
                    ) : (
                      <Pressable onPress={() => (settings?.allow_price_edit ?? true) && setEditing(item.id)}>
                        <Text style={styles.muted}>{formatRupiah(item.price)} × {item.quantity}{(settings?.allow_price_edit ?? true) ? " · ketuk harga" : ""}</Text>
                      </Pressable>
                    )}
                  </View>
                  <View style={styles.row}>
                    <Pressable testID={`qty-minus-${item.id}`} onPress={() => changeQty(item.id, -1)} style={styles.iconButton}><Ionicons name="remove" size={18} color={colors.brandPrimary} /></Pressable>
                    <Text style={{ width: 28, textAlign: "center", color: colors.onSurface, fontWeight: "700" }}>{item.quantity}</Text>
                    <Pressable testID={`qty-plus-${item.id}`} onPress={() => changeQty(item.id, 1)} style={styles.iconButton}><Ionicons name="add" size={18} color={colors.brandPrimary} /></Pressable>
                    <Pressable testID={`remove-${item.id}`} onPress={() => removeFromCart(item.id)} style={{ marginLeft: 6 }}><Ionicons name="trash-outline" size={18} color={colors.error} /></Pressable>
                  </View>
                </View>
              </View>
            ))}

            <View style={{ marginTop: 14 }}>
              {totals.map((t) => (
                <View key={t.label} style={styles.between}>
                  <Text style={styles.muted}>{t.label}</Text>
                  <Text style={styles.muted}>{t.value < 0 ? "-" : ""}{formatRupiah(Math.abs(t.value))}</Text>
                </View>
              ))}
              <View style={[styles.between, { marginTop: 6 }]}>
                <Text style={styles.cardTitle}>Total</Text>
                <Text style={[styles.cardTitle, { color: colors.brandPrimary, fontSize: 20 }]}>{formatRupiah(grandTotal)}</Text>
              </View>
            </View>

            <Text style={[styles.inputLabel, { marginTop: 18 }]}>Metode pembayaran</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {paymentMethods.length === 0 ? <Text style={styles.muted}>Belum ada metode. Tambahkan di Pengaturan.</Text> : paymentMethods.map((m) => (
                <Pressable key={m.id} testID={`pay-${m.id}`} onPress={() => setMethod(m)} style={[{ paddingHorizontal: 14, minHeight: 44, borderRadius: 12, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" }, method?.id === m.id && { backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandPrimary }]}>
                  <Text style={{ color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "800" }}>{m.name}</Text>
                </Pressable>
              ))}
            </View>

            {kind === "qris_static" && method?.qris_image_base64 ? (
              <View style={{ alignItems: "center", marginVertical: 14 }}>
                <Image source={{ uri: `data:image/png;base64,${method.qris_image_base64}` }} style={{ width: 220, height: 220, borderRadius: 14 }} />
                <Text style={[styles.muted, { marginTop: 8 }]}>Scan untuk membayar {formatRupiah(grandTotal)}</Text>
              </View>
            ) : null}
            {kind === "qris_static" && !method?.qris_image_base64 ? (
              <Text style={{ color: colors.warning, fontSize: 13, marginTop: 12 }}>Belum ada gambar QRIS. Upload di Pengaturan Metode Pembayaran.</Text>
            ) : null}

            {kind === "cash" ? (
              <>
                <Text style={[styles.inputLabel, { marginTop: 15 }]}>Uang diterima</Text>
                <TextInput testID="paid-input" keyboardType="number-pad" value={paidText} onChangeText={setPaidText} placeholder={String(grandTotal)} placeholderTextColor={colors.muted} style={styles.input} />
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                  <Pressable testID="cash-exact" onPress={() => setPaidText(String(grandTotal))} style={[styles.chip, { backgroundColor: colors.brandTertiary }]}>
                    <Text style={[styles.chipText, { color: colors.brandPrimary }]}>Uang pas</Text>
                  </Pressable>
                  {CASH_PICKS.map((amount) => (
                    <Pressable key={amount} testID={`cash-${amount}`} onPress={() => setPaidText(String(amount))} style={styles.chip}>
                      <Text style={styles.chipText}>{formatRupiah(amount)}</Text>
                    </Pressable>
                  ))}
                </View>
                <View style={styles.between}>
                  <Text style={styles.muted}>Kembalian</Text>
                  <Text style={[styles.productName, { color: insufficient ? colors.error : colors.success }]}>{insufficient ? "Nominal kurang" : formatRupiah(change)}</Text>
                </View>
              </>
            ) : null}

            <Text style={[styles.inputLabel, { marginTop: 15 }]}>Pelanggan</Text>
            <View style={[styles.row, { gap: 10, marginBottom: 12 }]}>
              <TextInput testID="customer-input" value={customerName} onChangeText={(t) => { setCustomerName(t); setCustomer(null); }} placeholder={kind === "credit" ? "Wajib untuk kredit" : "Umum / nama pelanggan"} placeholderTextColor={colors.muted} style={[styles.input, { flex: 1, marginBottom: 0 }]} />
              <Pressable testID="pick-customer" onPress={() => setPicker(true)} style={styles.iconButton}><Ionicons name="people-outline" size={22} color={colors.brandPrimary} /></Pressable>
            </View>

            <Text style={styles.inputLabel}>Diskon</Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <TextInput testID="discount-pct" keyboardType="number-pad" value={discountPct} onChangeText={setDiscountPct} placeholder="% (0-100)" placeholderTextColor={colors.muted} style={styles.input} />
              </View>
              <View style={{ flex: 1 }}>
                <TextInput testID="discount-amt" keyboardType="number-pad" value={discountAmt} onChangeText={setDiscountAmt} placeholder="Rp" placeholderTextColor={colors.muted} style={styles.input} />
              </View>
            </View>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.inputLabel}>Pajak %</Text>
                <TextInput testID="tax-input" keyboardType="decimal-pad" value={taxPct} onChangeText={setTaxPct} placeholder="0" placeholderTextColor={colors.muted} style={styles.input} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.inputLabel}>Ongkir</Text>
                <TextInput testID="shipping-input" keyboardType="number-pad" value={shipping} onChangeText={setShipping} placeholder="0" placeholderTextColor={colors.muted} style={styles.input} />
              </View>
            </View>

            <Text style={styles.inputLabel}>Catatan (opsional)</Text>
            <TextInput value={note} onChangeText={setNote} placeholder="Misal: untuk acara ulang tahun" placeholderTextColor={colors.muted} style={styles.input} />

            <View style={{ flexDirection: "row", gap: 10, marginTop: 6 }}>
              <Pressable testID="checkout-park" onPress={onPark} style={[styles.outlineButton, { flex: 1 }]}>
                <Text style={styles.outlineText}>Park</Text>
              </Pressable>
              <Pressable testID="checkout-cancel" onPress={onCancel} style={[styles.dangerButton, { flex: 1 }]}>
                <Text style={styles.dangerText}>Batal</Text>
              </Pressable>
            </View>
            <Pressable
              testID="confirm-pay"
              disabled={busy || insufficient || !method || (kind === "credit" && !customerName.trim())}
              onPress={async () => {
                if (!method) return;
                setBusy(true);
                try {
                  await onComplete(method, kind === "cash" ? paidNumber : 0, customerName.trim() || "Umum", customer?.id ?? null, note, dPct, dAmt, tPct, shippingNum);
                } finally { setBusy(false); }
              }}
              style={[styles.primaryButton, { marginTop: 10 }, (busy || insufficient || !method || (kind === "credit" && !customerName.trim())) && { opacity: 0.5 }]}
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
                <Pressable key={c.id} testID={`pick-customer-${c.id}`} onPress={() => { setCustomer(c); setCustomerName(c.name); setPicker(false); }} style={styles.listRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.productName}>{c.name}</Text>
                    <Text style={styles.muted}>{c.phone || "Tanpa nomor"}{c.price_level_id && c.price_level_id !== "default" ? ` · lvl ${c.price_level_id}` : ""}</Text>
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
