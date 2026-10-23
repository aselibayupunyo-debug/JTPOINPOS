import Ionicons from "@expo/vector-icons/Ionicons";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Print from "expo-print";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, Modal, Platform, Pressable, RefreshControl, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest, BusinessSettings, cachedGet, CartItem, Contact, formatRupiah, ParkedTransaction, PaymentMethodDoc, Product, Promo, ReportSummary, Shift, syncMutation, Technician, TransactionDoc } from "@/src/api";
import { useAppStyles } from "@/src/app-styles";
import { useAuth } from "@/src/auth-context";
import { Header } from "@/src/components/header";
import { LanModeBanner } from "@/src/components/lan-mode-banner";
import { SyncBanner } from "@/src/components/sync-banner";
import { LicenseBanner } from "@/src/components/license-banner";
import { getScannerEnabled, playScanError, playScanSuccess, setScannerEnabled } from "@/src/scanner-feedback";
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
  const [promos, setPromos] = useState<Promo[]>([]);
  const [shift, setShift] = useState<Shift | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("Semua");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [checkout, setCheckout] = useState(false);
  const [scanner, setScanner] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [customer, setCustomer] = useState<Contact | null>(null);
  const [priceLevel, setPriceLevel] = useState<string>("default");
  const [parkPromptOpen, setParkPromptOpen] = useState(false);
  const [parkName, setParkName] = useState("");
  const [unitPicker, setUnitPicker] = useState<null | { product: Product; options: { name: string; factor: number; price: number }[] }>(null);
  const [editingParkedId, setEditingParkedId] = useState<string | null>(null);
  const [techPicker, setTechPicker] = useState<null | { product: Product; unit: string; factor: number; price: number }>(null);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const consumedParkedRef = useRef<Set<string>>(new Set());
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [scannerEnabled, setScannerEnabledState] = useState(true);
  const [permission, requestPermission] = useCameraPermissions();
  const searchRef = useRef<TextInput>(null);

  useEffect(() => { getScannerEnabled().then(setScannerEnabledState); }, []);
  const toggleScanner = useCallback(() => {
    setScannerEnabledState((prev) => {
      const next = !prev;
      setScannerEnabled(next).catch(() => undefined);
      if (next) {
        playScanSuccess();
        toast.success("Scanner USB aktif", "Scan barang akan langsung masuk keranjang");
        setTimeout(() => searchRef.current?.focus(), 30);
      } else {
        toast.info("Scanner USB dimatikan", "Ketik manual di kolom pencarian");
        try { searchRef.current?.blur(); } catch { /* ignore */ }
      }
      return next;
    });
  }, [toast]);

  const load = useCallback(async () => {
    try {
      const [p, c, pm, s, parked, r, promoList, curShift] = await Promise.all([
        cachedGet<Product[]>("/products"),
        cachedGet<Contact[]>("/customers"),
        cachedGet<PaymentMethodDoc[]>("/payment-methods"),
        cachedGet<BusinessSettings>("/settings"),
        cachedGet<ParkedTransaction[]>("/parked"),
        cachedGet<ReportSummary>("/reports/summary"),
        cachedGet<Promo[]>("/promos"),
        cachedGet<Shift | Record<string, never>>("/shifts/current"),
      ]);
      setProducts(p.data); setCustomers(c.data); setPaymentMethods(pm.data.filter((m) => m.enabled));
      setSettings(s.data); setParkedCount(parked.data.length); setReport(r.data);
      setPromos(promoList.data.filter((pr) => pr.active));
      setShift((curShift.data as Shift).id ? (curShift.data as Shift) : null);
    } catch (e) {
      toast.error("Gagal memuat data", e instanceof Error ? e.message : undefined);
    }
  }, [toast]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Resume parked transaction from params — only once per parked id
  useEffect(() => {
    if (!params.parked) return;
    const parkedId = String(params.parked);
    if (consumedParkedRef.current.has(parkedId)) return;
    if (products.length === 0) return; // wait for products to load
    if (editingParkedId === parkedId) return; // already resumed
    (async () => {
      try {
        const list = await apiRequest<ParkedTransaction[]>("/parked");
        const match = list.find((p) => p.id === parkedId);
        consumedParkedRef.current.add(parkedId);
        if (!match) {
          router.replace("/(tabs)" as never);
          return;
        }
        const resumed: CartItem[] = match.items.map((item) => {
          const prod = products.find((p) => p.id === item.product_id);
          if (!prod) return null;
          const unit = item.unit || prod.base_unit || "Pcs";
          const t = item as { technician_id?: string; technician_name?: string };
          return { ...prod, line_id: `${prod.id}:${unit}${t.technician_id ? `:${t.technician_id}` : ""}`, product_id: prod.id, quantity: item.quantity, unit, unit_factor: item.unit_factor ?? 1, discount: item.discount, price: item.price, technician_id: t.technician_id, technician_name: t.technician_name } as CartItem;
        }).filter(Boolean) as CartItem[];
        if (resumed.length === 0 && match.items.length > 0) {
          toast.error("Produk antrian hilang", "Beberapa produk sudah dihapus dari katalog. Buat ulang transaksi.");
        }
        setCart(resumed);
        setPriceLevel(match.price_level_id || "default");
        if (match.customer_id) setCustomer(customers.find((c) => c.id === match.customer_id) ?? null);
        else if (match.customer_name) setCustomer({ id: "", name: match.customer_name, phone: "", address: "", note: "" } as Contact);
        setEditingParkedId(match.id);
        toast.info("Antrian dilanjutkan", `${match.customer_name} · dapat diedit`);
      } catch (e) {
        toast.error("Gagal buka antrian", e instanceof Error ? e.message : undefined);
      }
    })();
  }, [params.parked, products, customers, editingParkedId, toast]);

  // Apply customer's default price level
  useEffect(() => {
    if (customer?.price_level_id) setPriceLevel(customer.price_level_id);
  }, [customer]);

  const activePriceLevels = settings?.price_levels ?? [{ id: "default", name: "Harga Jual" }];

  // Auto-apply promos: for buy_x_get_y, mark Y units of free product as discount == price
  const appliedCart = useMemo<CartItem[]>(() => {
    const base = cart.map((i) => ({ ...i, discount: i.manual_discount ?? 0 }));
    if (promos.length === 0 || cart.length === 0) return base;
    const next = base;
    const appliedIds: string[] = [];
    for (const promo of promos) {
      if (promo.kind === "buy_x_get_y") {
        const cond = promo.conditions[0];
        if (!cond) continue;
        const buyLine = next.find((i) => i.id === cond.product_id);
        if (!buyLine || buyLine.quantity < cond.quantity) continue;
        const freeProductId = promo.reward.product_id || cond.product_id;
        const freeLine = next.find((i) => i.id === freeProductId);
        if (!freeLine) continue;
        const bundles = Math.floor(buyLine.quantity / cond.quantity);
        const freeUnits = Math.min(freeLine.quantity, bundles * promo.reward.quantity);
        if (freeUnits > 0) {
          freeLine.discount = (freeLine.discount ?? 0) + freeLine.price * freeUnits;
          appliedIds.push(promo.id);
        }
      } else if (promo.kind === "percent") {
        const cond = promo.conditions[0];
        const line = next.find((i) => i.id === cond?.product_id);
        if (line && line.quantity >= (cond?.quantity ?? 1)) {
          line.discount = (line.discount ?? 0) + Math.round(line.price * line.quantity * (promo.reward.percent / 100));
          appliedIds.push(promo.id);
        }
      }
    }
    return next.map((item) => ({ ...item, _appliedPromos: appliedIds } as CartItem));
  }, [cart, promos]);
  const appliedPromoIds = Array.from(new Set((appliedCart[0] as unknown as { _appliedPromos?: string[] })?._appliedPromos ?? []));
  const appliedPromoNames = promos.filter((p) => appliedPromoIds.includes(p.id)).map((p) => p.name);

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
    // Hanya pakai level harga kalau produk mengaktifkan toggle `use_price_levels`.
    if (product.use_price_levels !== false && priceLevel !== "default" && product.prices?.[priceLevel]) {
      return product.prices[priceLevel];
    }
    return product.price;
  };

  const filteredCategories = ["Semua", ...Array.from(new Set(products.map((p) => p.category))).slice(0, 10)];
  const filtered = products.filter((p) => (category === "Semua" || p.category === category) && `${p.name} ${p.barcode} ${p.sku}`.toLowerCase().includes(search.toLowerCase()));
  const totalCart = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const addLineToCart = (product: Product, unit: string, factor: number, unitPrice: number, tech?: Technician) => {
    // Jasa yang terhubung ke karyawan teknis → wajib pilih karyawan dulu.
    if (product.product_type === "service" && product.requires_technician && !tech) {
      setTechPicker({ product, unit, factor, price: unitPrice });
      apiRequest<Technician[]>("/technicians").then(setTechnicians).catch(() => setTechnicians([]));
      return;
    }
    setCart((current) => {
      const lineId = `${product.id}:${unit}${tech ? `:${tech.id}` : ""}`;
      const exists = current.find((item) => item.line_id === lineId);
      if (exists) return current.map((item) => item.line_id === lineId ? { ...item, quantity: item.quantity + 1 } : item);
      return [...current, { ...product, line_id: lineId, product_id: product.id, quantity: 1, price: unitPrice, unit, unit_factor: factor, technician_id: tech?.id, technician_name: tech?.name } as CartItem];
    });
  };

  const addToCart = (product: Product) => {
    if (product.product_type !== "service" && product.stock <= 0) return toast.error("Stok habis", product.name);
    const priceAtLevel = priceOf(product);
    const hasUnits = (product.units ?? []).length > 0;
    if (hasUnits) {
      const unitValues: { name: string; factor: number; price: number }[] = [
        { name: product.base_unit ?? "Pcs", factor: 1, price: priceAtLevel },
        ...(product.units ?? []).map((u) => ({ name: u.name, factor: u.factor, price: u.price || priceAtLevel * u.factor })),
      ];
      setUnitPicker({ product, options: unitValues });
      return;
    }
    addLineToCart(product, product.base_unit ?? "Pcs", 1, priceAtLevel);
  };
  const changeQty = (lineId: string, delta: number) => setCart((c) => c.map((i) => i.line_id === lineId ? { ...i, quantity: Math.max(0, Math.round((Number(i.quantity || 0) + delta) * 100) / 100) } : i).filter((i) => i.quantity > 0));
  const setQty = (lineId: string, next: number) => {
    const safe = Number(next);
    if (!Number.isFinite(safe)) return;
    const rounded = Math.max(0, Math.round(safe * 100) / 100);
    setCart((c) => c.map((i) => i.line_id === lineId ? { ...i, quantity: rounded } : i).filter((i) => i.quantity > 0));
  };
  const changePrice = (lineId: string, nextPrice: number) => {
    const safe = Number(nextPrice);
    if (!Number.isFinite(safe) || safe < 0) return;
    setCart((c) => c.map((i) => i.line_id === lineId ? { ...i, price: Math.round(safe) } : i));
  };
  const changeDiscount = (lineId: string, nextDisc: number) => setCart((c) => c.map((i) => i.line_id === lineId ? { ...i, manual_discount: Math.max(0, nextDisc) } : i));
  const removeFromCart = (lineId: string) => setCart((c) => c.filter((i) => i.line_id !== lineId));

  const openScanner = async () => {
    if (!permission?.granted) {
      const next = await requestPermission();
      if (!next.granted) return toast.error("Izin kamera ditolak", "Aktifkan di pengaturan sistem untuk scan barcode.");
    }
    setScanner(true);
  };

  const onBarcode = (data: string) => {
    setScanner(false);
    const code = String(data || "").trim();
    if (!code) return;
    const match = products.find((p) => p.barcode === code || p.sku === code);
    if (match) {
      playScanSuccess();
      addToCart(match);
      setSearch(""); // bersihkan kotak pencarian supaya scan berikutnya siap
      toast.success("Barcode terdeteksi", match.name);
    } else {
      playScanError();
      setSearch(code);
      toast.info("Barcode belum terdaftar", code);
    }
  };

  const parkTransaction = async () => {
    if (cart.length === 0) return;
    if (customer?.name) return doPark(customer.name);
    setParkName("");
    setParkPromptOpen(true);
  };

  const doPark = async (name: string) => {
    try {
      const totalPark = cart.reduce((s, i) => s + i.price * i.quantity, 0);
      const payload = {
        label: `Antrian ${new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}`,
        customer_name: name,
        customer_id: customer?.id ?? null,
        price_level_id: priceLevel,
        items: cart.map((i) => ({ product_id: i.product_id ?? i.id, name: i.name, quantity: i.quantity, price: i.price, cost: i.cost, unit: i.unit ?? "", unit_factor: i.unit_factor ?? 1, discount: i.discount ?? 0, technician_id: i.technician_id, technician_name: i.technician_name })),
        note: "",
        discount_percent: 0, discount_amount: 0, tax_percent: 0, shipping: 0,
      };
      const parked = await apiRequest<ParkedTransaction>("/parked", { method: "POST", body: JSON.stringify(payload) });
      // delete old parked silently if editing (and we got a different id back)
      if (editingParkedId && editingParkedId !== parked.id) {
        try { await apiRequest(`/parked/${editingParkedId}`, { method: "DELETE" }); } catch { /* already deleted */ }
        consumedParkedRef.current.add(editingParkedId);
      }
      setEditingParkedId(null);
      setCart([]); setCustomer(null);
      setParkedCount((n) => n + (editingParkedId ? 0 : 1));
      setParkPromptOpen(false);
      toast.success("Transaksi diparkir", `${name} · ${formatRupiah(totalPark)}`);
    } catch (e) {
      toast.error("Gagal park", e instanceof Error ? e.message : undefined);
    }
  };

  const cancelTransaction = () => {
    if (cart.length === 0) return toast.info("Keranjang sudah kosong");
    const doCancel = () => {
      setCart([]); setCustomer(null); setEditingParkedId(null); setCheckout(false); setCancelConfirmOpen(false);
      toast.info("Transaksi dibatalkan");
    };
    if (settings?.confirm_cancel === false) return doCancel();
    setCancelConfirmOpen(true);
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
          right={
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Pressable
                testID="usb-scanner-toggle"
                onPress={toggleScanner}
                style={[styles.iconButton, { marginLeft: 0 }, scannerEnabled && { backgroundColor: colors.brandTertiary }]}
                hitSlop={6}
              >
                <Ionicons
                  name={scannerEnabled ? "barcode-outline" : "barcode"}
                  size={20}
                  color={scannerEnabled ? colors.brandPrimary : colors.muted}
                />
                {!scannerEnabled ? (
                  <View style={{ position: "absolute", top: 10, left: 10, right: 10, height: 2, backgroundColor: colors.error, transform: [{ rotate: "-15deg" }], borderRadius: 1 }} />
                ) : null}
              </Pressable>
              <Pressable testID="parked-queue-button" onPress={() => router.push("/parked")} style={[styles.iconButton, { marginLeft: 0 }]}>
                <Ionicons name="layers-outline" size={20} color={colors.brandPrimary} />
                {parkedCount > 0 ? <View style={{ position: "absolute", top: -4, right: -4, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.error, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 }}><Text style={{ color: colors.onError, fontSize: 10, fontWeight: "800" }}>{parkedCount}</Text></View> : null}
              </Pressable>
              <View style={styles.avatar}><Text style={styles.avatarText}>{user?.name.slice(0, 1).toUpperCase()}</Text></View>
            </View>
          }
        />
        <SyncBanner />
        <LicenseBanner />
        <LanModeBanner />
        {editingParkedId ? (
          <View style={[styles.card, { backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandPrimary }]} testID="editing-parked-banner">
            <View style={styles.between}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.productName, { color: colors.brandPrimary }]}>Mengedit antrian · {customer?.name ?? "Pelanggan"}</Text>
                <Text style={styles.muted}>Simpan kembali ke antrian atau selesaikan di checkout.</Text>
              </View>
              <Pressable testID="exit-edit-parked" onPress={() => setEditingParkedId(null)} style={{ padding: 6 }}>
                <Ionicons name="close" size={20} color={colors.brandPrimary} />
              </Pressable>
            </View>
          </View>
        ) : null}
        <View style={styles.row}>
          <TextInput
            ref={searchRef}
            testID="search-input"
            value={search}
            onChangeText={setSearch}
            autoFocus={scannerEnabled}
            blurOnSubmit={false}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
            spellCheck={false}
            selectTextOnFocus
            clearButtonMode="while-editing"
            onSubmitEditing={(e) => {
              // CRITICAL: Scanner USB mengetik lebih cepat dari update state.
              // Pakai `e.nativeEvent.text` yang selalu berisi value asli
              // di native TextInput saat Enter ditekan — bukan state `search`
              // yang mungkin belum ter-update penuh (race condition React).
              const rawText = String(e?.nativeEvent?.text ?? search ?? "").trim();
              if (!rawText) return;
              const code = rawText;

              // Clear kotak pencarian lebih dulu agar scan berikutnya
              // tidak di-append ke teks lama. Toast tetap tampilkan isi code.
              setSearch("");
              try { searchRef.current?.clear(); } catch { /* ignore */ }

              // 1) Match pada barcode/SKU produk utama
              const mainMatch = products.find((p) => p.barcode === code || p.sku === code);
              if (mainMatch) {
                playScanSuccess();
                addToCart(mainMatch);
                toast.success("Barcode terdeteksi", mainMatch.name);
                setTimeout(() => searchRef.current?.focus(), 30);
                return;
              }

              // 2) Match pada barcode satuan (unit-level) — langsung add tanpa unit picker
              for (const p of products) {
                const u = (p.units || []).find((x) => x.barcode === code);
                if (u) {
                  if (p.product_type !== "service" && p.stock <= 0) {
                    playScanError();
                    toast.error("Stok habis", p.name);
                    setTimeout(() => searchRef.current?.focus(), 30);
                    return;
                  }
                  const unitPrice = u.price || priceOf(p) * u.factor;
                  addLineToCart(p, u.name, u.factor, unitPrice);
                  playScanSuccess();
                  toast.success("Barcode terdeteksi", `${p.name} · ${u.name}`);
                  setTimeout(() => searchRef.current?.focus(), 30);
                  return;
                }
              }

              // 3) Tidak ditemukan — beep error, toast tampilkan code yg di-scan.
              // Kotak pencarian tetap bersih supaya scan berikutnya langsung
              // bisa diproses (tidak appended ke sisa teks sebelumnya).
              playScanError();
              toast.info("Barcode tidak ditemukan", code);
              setTimeout(() => searchRef.current?.focus(), 30);
            }}
            onBlur={() => {
              // Kalau scanner enabled, re-focus kecuali ada TextInput lain yang aktif
              if (!scannerEnabled) return;
              setTimeout(() => {
                try {
                  const current = (TextInput as any).State?.currentlyFocusedInput?.();
                  if (current && current !== searchRef.current) return; // input lain aktif
                  searchRef.current?.focus();
                } catch { /* ignore */ }
              }, 300);
            }}
            placeholder="Scan / cari nama / barcode / SKU"
            placeholderTextColor={colors.muted}
            style={styles.search}
          />
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
                {p.product_type === "service" ? (
                  <Text style={styles.stock}>Jasa</Text>
                ) : (
                  <Text style={[styles.stock, p.stock <= p.min_stock && { color: colors.warning }]}>{p.stock > 0 ? `Stok ${p.stock}` : "Stok habis"}</Text>
                )}
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
              <Text style={{ color: colors.onSurfaceInverse, fontSize: 13, fontWeight: "700" }}>{cart.reduce((s, i) => s + i.quantity, 0)} item{customer ? ` · ${customer.name}` : ""}{shift ? ` · Shift aktif` : ""}</Text>
              <Text style={{ color: colors.onSurfaceInverse, fontSize: 18, fontWeight: "800", marginTop: 3 }}>{formatRupiah(totalCart)}</Text>
              {appliedPromoNames.length > 0 ? <Text style={{ color: colors.onBrandPrimary, fontSize: 11, fontWeight: "800", marginTop: 2 }}>🎁 {appliedPromoNames.join(" · ")}</Text> : null}
            </View>
            <Pressable testID="cart-scan-button" onPress={openScanner} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.onSurfaceInverse, alignItems: "center", justifyContent: "center", marginRight: 8 }}>
              <Ionicons name="scan-outline" size={22} color={colors.surfaceInverse} />
            </Pressable>
            <Pressable testID="checkout-button" onPress={() => setCheckout(true)} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>Bayar</Text>
            </Pressable>
          </View>
          <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
            <Pressable testID="park-button" onPress={parkTransaction} style={[styles.outlineButton, { flex: 1, borderColor: colors.onSurfaceInverse }]}>
              <Text style={{ color: colors.onSurfaceInverse, fontWeight: "800", fontSize: 13 }}>{editingParkedId ? "Simpan ke antrian" : "Park / Antri"}</Text>
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

      <Modal visible={parkPromptOpen} transparent animationType="fade" onRequestClose={() => setParkPromptOpen(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(28,28,30,0.55)", justifyContent: "center", padding: 24 }}>
          <View style={{ backgroundColor: colors.surface, borderRadius: 20, padding: 20 }}>
            <Text style={styles.cardTitle}>Nama pelanggan antrian</Text>
            <Text style={[styles.muted, { marginTop: 6, marginBottom: 10 }]}>Antrian wajib memiliki nama agar tidak tertukar.</Text>
            <TextInput
              testID="park-name-input"
              autoFocus
              value={parkName}
              onChangeText={setParkName}
              placeholder="Contoh: Pak Budi / Meja 3"
              placeholderTextColor={colors.muted}
              style={styles.input}
            />
            <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
              <Pressable onPress={() => setParkPromptOpen(false)} style={[styles.outlineButton, { flex: 1 }]}>
                <Text style={styles.outlineText}>Batal</Text>
              </Pressable>
              <Pressable
                testID="park-name-save"
                onPress={() => {
                  const n = parkName.trim();
                  if (!n) return toast.error("Nama wajib diisi");
                  doPark(n);
                }}
                style={[styles.primaryButton, { flex: 1 }]}
              >
                <Text style={styles.primaryButtonText}>Simpan antrian</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={!!unitPicker} transparent animationType="fade" onRequestClose={() => setUnitPicker(null)}>
        <View style={{ flex: 1, backgroundColor: "rgba(28,28,30,0.55)", justifyContent: "flex-end" }}>
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: insets.bottom + 20 }}>
            <View style={styles.between}>
              <Text style={styles.cardTitle} testID="unit-picker-title">{unitPicker?.product.name}</Text>
              <Pressable onPress={() => setUnitPicker(null)}><Ionicons name="close" size={24} color={colors.onSurface} /></Pressable>
            </View>
            <Text style={[styles.muted, { marginTop: 4, marginBottom: 10 }]}>Pilih satuan yang akan dijual.</Text>
            {(unitPicker?.options ?? []).map((u, idx) => (
              <Pressable
                key={`${u.name}-${idx}`}
                testID={`unit-option-${u.name}`}
                onPress={() => {
                  if (!unitPicker) return;
                  addLineToCart(unitPicker.product, u.name, u.factor, u.price);
                  setUnitPicker(null);
                }}
                style={styles.listRow}
              >
                <View style={styles.settingIcon}><Ionicons name="cube-outline" size={20} color={colors.brandPrimary} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.productName}>{u.name}</Text>
                  <Text style={styles.muted}>×{u.factor} satuan dasar</Text>
                </View>
                <Text style={[styles.productName, { color: colors.brandPrimary }]}>{formatRupiah(u.price)}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </Modal>

      <Modal visible={!!techPicker} transparent animationType="fade" onRequestClose={() => setTechPicker(null)}>
        <View style={{ flex: 1, backgroundColor: "rgba(28,28,30,0.55)", justifyContent: "flex-end" }}>
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: insets.bottom + 20, maxHeight: "80%" }}>
            <View style={styles.between}>
              <Text style={styles.cardTitle} testID="tech-picker-title">{techPicker?.product.name}</Text>
              <Pressable onPress={() => setTechPicker(null)} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}><Ionicons name="close" size={24} color={colors.onSurface} /></Pressable>
            </View>
            <Text style={[styles.muted, { marginBottom: 10 }]}>Pilih karyawan teknis yang mengerjakan jasa ini.</Text>
            <ScrollView>
              {technicians.length === 0 ? (
                <View style={{ paddingVertical: 16 }}>
                  <Text style={styles.muted}>Belum ada karyawan teknis. Tambahkan di Lainnya → Karyawan teknis.</Text>
                  <Pressable onPress={() => { setTechPicker(null); router.push("/technicians"); }} style={[styles.outlineButton, { marginTop: 12 }]}>
                    <Text style={styles.outlineText}>Kelola karyawan teknis</Text>
                  </Pressable>
                </View>
              ) : technicians.map((t) => (
                <Pressable
                  key={t.id}
                  testID={`tech-option-${t.id}`}
                  onPress={() => {
                    if (!techPicker) return;
                    addLineToCart(techPicker.product, techPicker.unit, techPicker.factor, techPicker.price, t);
                    setTechPicker(null);
                    toast.success("Ditambahkan", `${techPicker.product.name} · ${t.name}`);
                  }}
                  style={styles.listRow}
                >
                  <View style={styles.settingIcon}><Ionicons name="construct-outline" size={20} color={colors.brandPrimary} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.productName}>{t.name}</Text>
                    {t.position ? <Text style={styles.muted}>{t.position}</Text> : null}
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={cancelConfirmOpen} transparent animationType="fade" onRequestClose={() => setCancelConfirmOpen(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(28,28,30,0.55)", justifyContent: "center", padding: 24 }}>
          <View style={{ backgroundColor: colors.surface, borderRadius: 20, padding: 20 }}>
            <Text style={styles.cardTitle}>Batalkan transaksi?</Text>
            <Text style={[styles.muted, { marginTop: 6, marginBottom: 14 }]}>Semua item di keranjang akan dihapus.</Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable onPress={() => setCancelConfirmOpen(false)} style={[styles.outlineButton, { flex: 1 }]}>
                <Text style={styles.outlineText}>Tidak</Text>
              </Pressable>
              <Pressable
                testID="confirm-cancel-cart"
                onPress={() => {
                  setCart([]); setCustomer(null); setEditingParkedId(null); setCheckout(false); setCancelConfirmOpen(false);
                  toast.info("Transaksi dibatalkan");
                }}
                style={[styles.dangerButton, { flex: 1 }]}
              >
                <Text style={styles.dangerText}>Ya, batalkan</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <CheckoutSheet
        visible={checkout}
        onClose={() => setCheckout(false)}
        cart={appliedCart}
        customers={customers}
        customer={customer}
        setCustomer={setCustomer}
        paymentMethods={paymentMethods}
        settings={settings}
        changeQty={changeQty}
        setQty={setQty}
        changePrice={changePrice}
        changeDiscount={changeDiscount}
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
              shift_id: shift?.id ?? null,
              promo_ids: appliedPromoIds,
              note,
              items: appliedCart.map((item) => ({ product_id: item.product_id ?? item.id, name: item.name, quantity: item.quantity, price: item.price, cost: item.cost, discount: item.discount ?? 0, unit: item.unit ?? "", unit_factor: item.unit_factor ?? 1, product_type: item.product_type ?? "goods", kitchen_print: !!item.kitchen_print, ...(item.technician_id ? { technician_id: item.technician_id, technician_name: item.technician_name, commission_type: item.commission_type ?? "percent", commission_value: Number(item.commission_value || 0) } : {}) })),
            });
            if (result.queued) {
              toast.info("Transaksi disimpan offline", "Akan dikirim otomatis saat online.");
            } else {
              toast.success("Transaksi berhasil", "Stok & laporan diperbarui.");
            }
            setCart([]); setCustomer(null); setCheckout(false);
            if (editingParkedId) {
              try { await apiRequest(`/parked/${editingParkedId}`, { method: "DELETE" }); } catch { /* already deleted */ }
              // mark consumed so the resume effect doesn't retrigger when the URL param lingers
              consumedParkedRef.current.add(editingParkedId);
              setEditingParkedId(null);
              setParkedCount((n) => Math.max(0, n - 1));
            }
            await load();
            const txId = (result.data as { id?: string } | null)?.id;

            // Auto-cetak order dapur (kitchen printer) kalau ada item tag dapur
            // Skip kalau pengaturan: cetak bersamaan preview (sudah dicetak di preview button)
            try {
              const kitchenItems = appliedCart.filter((i) => i.kitchen_print);
              const kitchenTiming = settings?.kitchen_print_timing || "after";
              if (kitchenItems.length && settings && !result.queued && kitchenTiming !== "with_preview") {
                const { printKitchenOrder, getKitchenPrinter } = await import("@/src/bt-printer");
                const kitchenPrinter = await getKitchenPrinter();
                if (kitchenPrinter) {
                  const fakeTx = (result.data as TransactionDoc | null) ?? {
                    id: txId ?? "tmp", invoice_no: "AUTO", transaction_type: "sale" as const,
                    payment_method: method.id, payment_method_label: method.name,
                    items: appliedCart.map((i) => ({ product_id: i.product_id ?? i.id, name: i.name, quantity: i.quantity, price: i.price, cost: i.cost, discount: i.discount ?? 0, unit: i.unit ?? "", unit_factor: i.unit_factor ?? 1, kitchen_print: !!i.kitchen_print })),
                    total: 0, subtotal: 0, paid_amount: 0, outstanding: 0,
                    customer_name: cName, created_at: new Date().toISOString(),
                    note,
                  } as TransactionDoc;
                  await printKitchenOrder(fakeTx, settings);
                  toast.success("Order dapur dicetak", `${kitchenItems.length} item ke ${kitchenPrinter.name}`);
                }
              }
            } catch (kerr) {
              toast.info("Order dapur tidak tercetak", kerr instanceof Error ? kerr.message : "cek printer dapur");
            }

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
  visible, onClose, cart, customers, customer, setCustomer, paymentMethods, settings, changeQty, setQty, changePrice, changeDiscount, removeFromCart, onCancel, onPark, onComplete,
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
  setQty: (id: string, next: number) => void;
  changePrice: (id: string, next: number) => void;
  changeDiscount: (id: string, next: number) => void;
  removeFromCart: (id: string) => void;
  onCancel: () => void;
  onPark: () => void;
  onComplete: (method: PaymentMethodDoc, paid: number, customerName: string, customerId: string | null, note: string, discountPct: number, discountAmt: number, taxPct: number, shipping: number) => Promise<void>;
}) {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const toast = useToast();
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
  const [priceText, setPriceText] = useState("");
  const [qtyEditing, setQtyEditing] = useState<string | null>(null);
  const [qtyDraft, setQtyDraft] = useState<string>("");
  const [discEditor, setDiscEditor] = useState<null | { lineId: string; item: CartItem }>(null);

  const fmtQty = (q: number): string => {
    const n = Number(q);
    if (!Number.isFinite(n)) return "0";
    // Show up to 2 decimals, strip trailing zeros
    return n.toLocaleString("id-ID", { maximumFractionDigits: 2 });
  };

  // Normalisasi input kuantitas: terima koma/titik, maks 2 desimal,
  // simpan dalam state draft agar user bebas mengetik "0,", "2,5" dsb.
  const normalizeQtyInput = (raw: string): { display: string; value: number | null } => {
    // Buang karakter selain digit/koma/titik, pakai separator pertama saja
    let s = String(raw ?? "").replace(/[^\d.,]/g, "");
    // Gabungkan multi-separator (hanya ambil yang pertama)
    const firstSep = s.search(/[.,]/);
    if (firstSep >= 0) {
      const head = s.slice(0, firstSep).replace(/[.,]/g, "");
      const sep = s[firstSep] === "," ? "," : ",";
      const tail = s.slice(firstSep + 1).replace(/[.,]/g, "").slice(0, 2);
      s = tail.length > 0 ? `${head}${sep}${tail}` : `${head}${sep}`;
    }
    // Cegah leading zero berlebih tapi izinkan "0" dan "0,"
    if (/^0\d/.test(s)) s = s.replace(/^0+/, "");
    if (s === "") return { display: "", value: null };
    const numeric = Number(s.replace(",", "."));
    return { display: s, value: Number.isFinite(numeric) ? numeric : null };
  };
  const [discType, setDiscType] = useState<"amount" | "percent">("amount");
  const [discValue, setDiscValue] = useState("");

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

  // Uang diterima default kosong; fokuskan kursor saat sheet pembayaran tunai dibuka.
  const paidRef = useRef<TextInput>(null);
  useEffect(() => {
    if (!visible || kind !== "cash") return;
    const t = setTimeout(() => paidRef.current?.focus(), 350);
    return () => clearTimeout(t);
  }, [visible, kind]);

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
            {cart.map((item) => {
              const key = item.line_id ?? item.id;
              const itemDisc = item.discount ?? 0;
              return (
              <View key={key} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.divider }}>
                <View style={styles.between}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.productName}>{item.name}{item.unit ? ` · ${item.unit}` : ""}</Text>
                    {item.technician_name ? <Text testID={`cart-tech-${key}`} style={[styles.muted, { color: colors.brandPrimary, fontWeight: "700" }]}>🔧 {item.technician_name}</Text> : null}
                    {editing === key ? (
                      <View style={[styles.row, { marginTop: 6 }]}>
                        <TextInput
                          testID={`edit-price-${key}`}
                          keyboardType="number-pad"
                          autoFocus
                          value={priceText}
                          onChangeText={(t) => {
                            const digits = String(t).replace(/\D/g, "");
                            setPriceText(digits);
                            const num = Number(digits);
                            if (Number.isFinite(num) && num >= 0) changePrice(key, num);
                          }}
                          onBlur={() => setEditing(null)}
                          onSubmitEditing={() => setEditing(null)}
                          placeholder="Harga manual"
                          placeholderTextColor={colors.muted}
                          style={[styles.input, { marginBottom: 0, flex: 1, minHeight: 36 }]}
                        />
                        <Pressable onPress={() => setEditing(null)} style={styles.iconButton}>
                          <Ionicons name="checkmark" size={18} color={colors.success} />
                        </Pressable>
                      </View>
                    ) : (
                      (settings?.allow_price_edit ?? true) ? (
                        <Pressable
                          testID={`price-tap-${key}`}
                          onPress={() => { setPriceText(String(Math.round(Number(item.price) || 0))); setEditing(key); }}
                          hitSlop={8}
                        >
                          <Text style={styles.muted}>{formatRupiah(item.price)} × {fmtQty(item.quantity)} · ketuk harga</Text>
                        </Pressable>
                      ) : (
                        <Text style={styles.muted}>{formatRupiah(item.price)} × {fmtQty(item.quantity)}</Text>
                      )
                    )}
                    <Pressable
                      testID={`edit-discount-${key}`}
                      onPress={() => {
                        setDiscEditor({ lineId: key, item });
                        setDiscType("amount");
                        setDiscValue(String(item.manual_discount ?? ""));
                      }}
                      style={{ marginTop: 6, alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 4 }}
                    >
                      <Ionicons name="pricetag-outline" size={13} color={itemDisc > 0 ? colors.success : colors.muted} />
                      <Text style={{ color: itemDisc > 0 ? colors.success : colors.muted, fontSize: 12, fontWeight: "700" }}>
                        {itemDisc > 0 ? `Diskon -${formatRupiah(itemDisc)}` : "+ Tambah diskon"}
                      </Text>
                    </Pressable>
                  </View>
                  <View style={styles.row}>
                    <Pressable testID={`qty-minus-${key}`} onPress={() => changeQty(key, -1)} style={styles.iconButton}><Ionicons name="remove" size={18} color={colors.brandPrimary} /></Pressable>
                    {qtyEditing === key ? (
                      <TextInput
                        testID={`qty-input-${key}`}
                        keyboardType="decimal-pad"
                        autoFocus
                        value={qtyDraft}
                        selectTextOnFocus
                        onChangeText={(t) => {
                          const { display, value } = normalizeQtyInput(t);
                          setQtyDraft(display);
                          if (value !== null && value > 0) setQty(key, value);
                        }}
                        onBlur={() => {
                          // Commit nilai draft terakhir (kalau user hapus semua, biarkan jumlah terakhir)
                          const { value } = normalizeQtyInput(qtyDraft);
                          if (value !== null && value > 0) setQty(key, value);
                          setQtyEditing(null);
                          setQtyDraft("");
                        }}
                        onSubmitEditing={() => {
                          const { value } = normalizeQtyInput(qtyDraft);
                          if (value !== null && value > 0) setQty(key, value);
                          setQtyEditing(null);
                          setQtyDraft("");
                        }}
                        placeholder="Qty"
                        placeholderTextColor={colors.muted}
                        style={{ minWidth: 56, maxWidth: 86, textAlign: "center", color: colors.onSurface, fontWeight: "700", borderBottomWidth: 1, borderBottomColor: colors.brandPrimary, paddingVertical: 2 }}
                      />
                    ) : (
                      <Pressable
                        testID={`qty-edit-${key}`}
                        onPress={() => {
                          setQtyDraft(fmtQty(item.quantity));
                          setQtyEditing(key);
                        }}
                      >
                        <Text style={{ minWidth: 36, paddingHorizontal: 2, textAlign: "center", color: colors.onSurface, fontWeight: "700" }}>{fmtQty(item.quantity)}</Text>
                      </Pressable>
                    )}
                    <Pressable testID={`qty-plus-${key}`} onPress={() => changeQty(key, 1)} style={styles.iconButton}><Ionicons name="add" size={18} color={colors.brandPrimary} /></Pressable>
                    <Pressable testID={`remove-${key}`} onPress={() => removeFromCart(key)} style={{ marginLeft: 6 }}><Ionicons name="trash-outline" size={18} color={colors.error} /></Pressable>
                  </View>
                </View>
              </View>
            );})}

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
                <TextInput ref={paidRef} testID="paid-input" keyboardType="number-pad" value={paidText} onChangeText={setPaidText} placeholder="Ketik nominal uang diterima" placeholderTextColor={colors.muted} style={styles.input} />
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
            {(settings?.allow_preview_print ?? true) ? (
              <Pressable
                testID="preview-print-receipt"
                disabled={busy}
                onPress={async () => {
                try {
                  if (Platform.OS === "web") {
                    toast.error("Preview struk hanya di aplikasi mobile", "Buka di Expo Go / build Android untuk mencetak.");
                    return;
                  }
                  if (cart.length === 0) { toast.error("Keranjang kosong"); return; }

                  // 1) Coba cetak langsung ke printer thermal paired (jika tersedia)
                  try {
                    const { getPairedPrinter, printReceipt, isPrinterAvailable } = await import("@/src/bt-printer");
                    const [paired, available] = await Promise.all([getPairedPrinter(), isPrinterAvailable()]);
                    if (available && paired && settings) {
                      const nowIso = new Date().toISOString();
                      const items = cart.map((it) => ({
                        product_id: it.product_id ?? it.id,
                        name: it.name,
                        quantity: it.quantity,
                        price: it.price,
                        cost: it.cost ?? 0,
                        discount: it.discount ?? 0,
                        unit: it.unit ?? "",
                        unit_factor: it.unit_factor ?? 1,
                        product_type: it.product_type ?? "goods",
                        kitchen_print: !!it.kitchen_print,
                      }));
                      const subtotalCalc = items.reduce((s, i) => s + i.price * i.quantity - (i.discount ?? 0), 0);
                      const fakeTx = {
                        id: "preview",
                        invoice_no: `DRAFT-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`,
                        transaction_type: "sale" as const,
                        payment_method: method?.kind || "cash",
                        payment_method_label: method?.label || "Tunai",
                        items,
                        total: grandTotal,
                        subtotal: subtotalCalc,
                        global_discount: globalDisc,
                        discount_percent: dPct,
                        tax_percent: tPct,
                        tax_amount: taxAmt,
                        shipping: shippingNum,
                        paid_amount: kind === "cash" ? paidNumber : 0,
                        outstanding: 0,
                        customer_name: customerName.trim() || "Umum",
                        created_at: nowIso,
                        created_by_name: "",
                        status: "active" as const,
                      };
                      await printReceipt(fakeTx, settings, {
                        openCashDrawer: settings.cashdrawer_enabled,
                        preview: true,
                        // Saat preview + print dapur barengan → sembunyikan logo
                        // di struk preview supaya tidak dicetak ganda (dapur
                        // sudah pakai header kecil, preview hanya butuh teks).
                        omitLogo: settings.kitchen_print_timing === "with_preview",
                      });
                      toast.success("Struk tercetak", `${paired.name} · ${settings.receipt_width}`);
                      // Jika pengaturan: cetak dapur BERSAMA preview → cetak sekarang juga.
                      if (settings.kitchen_print_timing === "with_preview") {
                        try {
                          const kitchenItems = items.filter((i) => i.kitchen_print);
                          if (kitchenItems.length) {
                            const { printKitchenOrder, getKitchenPrinter } = await import("@/src/bt-printer");
                            const kp = await getKitchenPrinter();
                            if (kp) {
                              await printKitchenOrder(fakeTx as TransactionDoc, settings);
                              toast.success("Order dapur dicetak", `${kitchenItems.length} item ke ${kp.name}`);
                            }
                          }
                        } catch (kerr) {
                          toast.info("Dapur tidak tercetak", kerr instanceof Error ? kerr.message : "cek printer dapur");
                        }
                      }
                      return;
                    }
                  } catch (printErr) {
                    const msg = printErr instanceof Error ? printErr.message : "";
                    if (msg) toast.info("Printer thermal belum siap", `Jatuh ke preview PDF. ${msg}`);
                  }

                  // 2) Fallback: preview HTML via expo-print
                  const biz = settings?.business_name || "Toko";
                  const header = (settings?.header_lines ?? []).slice(0, 4).map((l) => `<div>${l.replace(/</g, "&lt;")}</div>`).join("");
                  const footer = (settings?.footer_lines ?? []).slice(0, 4).map((l) => `<div>${l.replace(/</g, "&lt;")}</div>`).join("");
                  const rows = cart.map((it) => `<tr><td>${it.name}${it.unit ? ` (${it.unit})` : ""}<br/><span style="font-size:9px;color:#555">${fmtQty(it.quantity)} × ${formatRupiah(it.price)}</span></td><td style="text-align:right">${formatRupiah(it.price * it.quantity)}</td></tr>`).join("");
                  const html = `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><style>
                    body { font-family: -apple-system, Arial, sans-serif; width: 58mm; padding: 6px; margin: 0; }
                    .center { text-align:center; }
                    .biz { font-size: 14px; font-weight: 800; }
                    .meta { font-size: 10px; color: #333; }
                    .sep { border-top: 1px dashed #000; margin: 6px 0; }
                    table { width: 100%; } td { font-size: 10px; padding: 2px 0; }
                    .row { display: flex; justify-content: space-between; font-size: 10px; margin: 2px 0; }
                    .total { font-size: 13px; font-weight: 900; margin-top: 4px; }
                    .draft { color: #b00; font-weight: 900; letter-spacing: 2px; }
                  </style></head><body>
                    <div class="center biz">${biz}</div>
                    <div class="center meta">${header}</div>
                    <div class="center draft">** PREVIEW **</div>
                    <div class="center meta">${new Date().toLocaleString("id-ID")}</div>
                    <div class="center meta">Pelanggan: ${customerName.trim() || "Umum"}</div>
                    <div class="sep"></div>
                    <table><tbody>${rows}</tbody></table>
                    <div class="sep"></div>
                    ${globalDisc ? `<div class="row"><span>Diskon</span><span>-${formatRupiah(globalDisc)}</span></div>` : ""}
                    ${taxAmt ? `<div class="row"><span>Pajak ${tPct}%</span><span>${formatRupiah(taxAmt)}</span></div>` : ""}
                    ${shippingNum ? `<div class="row"><span>Ongkir</span><span>${formatRupiah(shippingNum)}</span></div>` : ""}
                    <div class="row total"><span>TOTAL</span><span>${formatRupiah(grandTotal)}</span></div>
                    <div class="row"><span>Metode</span><span>${method?.label || "-"}</span></div>
                    <div class="sep"></div>
                    <div class="center meta">${footer || "Terima kasih"}</div>
                    <div class="center meta" style="margin-top:6px">* Struk preview, transaksi belum disimpan *</div>
                  </body></html>`;
                  await Print.printAsync({ html });
                } catch (e) {
                  const err = e instanceof Error ? e.message : "";
                  if (err && !/cancel|dismiss|did not complete/i.test(err)) toast.error("Preview gagal", err);
                }
              }}
              style={[styles.outlineButton, { marginTop: 10 }, busy && { opacity: 0.5 }]}
            >
              <Text style={styles.outlineText}>Cetak struk sekarang</Text>
            </Pressable>
            ) : null}
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

      <Modal visible={!!discEditor} transparent animationType="fade" onRequestClose={() => setDiscEditor(null)}>
        <View style={{ flex: 1, backgroundColor: "rgba(28,28,30,0.55)", justifyContent: "center", padding: 24 }}>
          <View style={{ backgroundColor: colors.surface, borderRadius: 20, padding: 20 }}>
            <Text style={styles.cardTitle}>Diskon item</Text>
            <Text style={[styles.muted, { marginTop: 4 }]}>{discEditor?.item.name}</Text>
            <Text style={[styles.muted, { marginBottom: 10 }]}>
              {discEditor ? `${formatRupiah(discEditor.item.price)} × ${discEditor.item.quantity} = ${formatRupiah(discEditor.item.price * discEditor.item.quantity)}` : ""}
            </Text>
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 10 }}>
              <Pressable testID="disc-type-amount" onPress={() => setDiscType("amount")} style={[styles.chip, discType === "amount" && styles.chipActive, { flex: 1 }]}>
                <Text style={[styles.chipText, discType === "amount" && styles.chipTextActive]}>Nominal (Rp)</Text>
              </Pressable>
              <Pressable testID="disc-type-percent" onPress={() => setDiscType("percent")} style={[styles.chip, discType === "percent" && styles.chipActive, { flex: 1 }]}>
                <Text style={[styles.chipText, discType === "percent" && styles.chipTextActive]}>Persen (%)</Text>
              </Pressable>
            </View>
            <TextInput
              testID="disc-value-input"
              autoFocus
              keyboardType="number-pad"
              value={discValue}
              onChangeText={setDiscValue}
              placeholder={discType === "amount" ? "0" : "0 - 100"}
              placeholderTextColor={colors.muted}
              style={styles.input}
            />
            <Text style={[styles.muted, { marginBottom: 10 }]}>
              {(() => {
                if (!discEditor) return "";
                const v = Number(discValue.replace(/\D/g, "")) || 0;
                const lineTotal = discEditor.item.price * discEditor.item.quantity;
                const amt = discType === "amount" ? v : Math.round(lineTotal * Math.min(v, 100) / 100);
                return `Diskon aktual: ${formatRupiah(Math.min(amt, lineTotal))}`;
              })()}
            </Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable testID="disc-clear" onPress={() => {
                if (!discEditor) return;
                changeDiscount(discEditor.lineId, 0);
                setDiscEditor(null);
              }} style={[styles.outlineButton, { flex: 1 }]}>
                <Text style={styles.outlineText}>Hapus</Text>
              </Pressable>
              <Pressable testID="disc-apply" onPress={() => {
                if (!discEditor) return;
                const v = Number(discValue.replace(/\D/g, "")) || 0;
                const lineTotal = discEditor.item.price * discEditor.item.quantity;
                let amt = discType === "amount" ? v : Math.round(lineTotal * Math.min(v, 100) / 100);
                amt = Math.min(amt, lineTotal);
                changeDiscount(discEditor.lineId, amt);
                setDiscEditor(null);
              }} style={[styles.primaryButton, { flex: 1 }]}>
                <Text style={styles.primaryButtonText}>Terapkan</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </Modal>
  );
}
