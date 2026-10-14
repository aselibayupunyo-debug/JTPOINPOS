import Ionicons from "@expo/vector-icons/Ionicons";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest, BusinessSettings, Category, PriceLevel, Product } from "@/src/api";
import { useAppStyles } from "@/src/app-styles";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";

type UnitRow = { name: string; factor: string; price: string };

export default function ProductFormScreen() {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [name, setName] = useState("");
  const [productType, setProductType] = useState<"goods" | "service">("goods");
  const [baseUnit, setBaseUnit] = useState("Pcs");
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");
  const [stock, setStock] = useState("");
  const [minStock, setMinStock] = useState("5");
  const [category, setCategory] = useState("Umum");
  const [barcode, setBarcode] = useState("");
  const [kitchenPrint, setKitchenPrint] = useState(false);
  const [usePriceLevels, setUsePriceLevels] = useState(false);
  const [requiresTech, setRequiresTech] = useState(false);
  const [commissionType, setCommissionType] = useState<"percent" | "fixed">("percent");
  const [commissionValue, setCommissionValue] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!!id);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryPicker, setCategoryPicker] = useState(false);
  const [newCategoryInput, setNewCategoryInput] = useState("");
  const [priceLevels, setPriceLevels] = useState<PriceLevel[]>([]);
  const [levelPrices, setLevelPrices] = useState<Record<string, string>>({});

  useEffect(() => {
    apiRequest<Category[]>("/categories").then(setCategories).catch(() => setCategories([]));
    apiRequest<BusinessSettings>("/settings").then((s) => {
      setPriceLevels((s.price_levels ?? []).filter((lv) => lv.id !== "default"));
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!id) return;
    apiRequest<Product[]>(`/products`).then((list) => {
      const match = list.find((p) => p.id === id);
      if (match) {
        setName(match.name); setPrice(String(match.price)); setCost(String(match.cost));
        setStock(String(match.stock)); setMinStock(String(match.min_stock));
        setCategory(match.category); setBarcode(match.barcode); setKitchenPrint(!!match.kitchen_print);
        setUsePriceLevels(!!match.use_price_levels);
        setRequiresTech(!!match.requires_technician);
        setCommissionType(match.commission_type ?? "percent");
        setCommissionValue(match.commission_value ? String(match.commission_value) : "");
        setImage(match.image_base64 ?? null);
        setProductType(match.product_type ?? "goods");
        setBaseUnit(match.base_unit ?? "Pcs");
        setUnits((match.units ?? []).map((u) => ({ name: u.name, factor: String(u.factor), price: u.price ? String(u.price) : "" })));
        // Load existing level prices as strings
        const lp: Record<string, string> = {};
        Object.entries(match.prices ?? {}).forEach(([k, v]) => { if (k !== "default") lp[k] = String(v); });
        setLevelPrices(lp);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [id]);

  const pickImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return toast.error("Izin galeri ditolak");
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.6, base64: true });
    if (!result.canceled) setImage(result.assets[0].base64 ?? null);
  };

  const addUnitRow = () => setUnits((u) => [...u, { name: "", factor: "", price: "" }]);
  const updateUnit = (idx: number, patch: Partial<UnitRow>) => setUnits((u) => u.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  const removeUnit = (idx: number) => setUnits((u) => u.filter((_, i) => i !== idx));

  const save = async () => {
    if (!name.trim() || !price.trim()) return toast.error("Data belum lengkap", "Nama dan harga wajib diisi.");
    setBusy(true);
    try {
      const normalizedUnits = units
        .map((u) => ({
          name: u.name.trim(),
          factor: Number(String(u.factor).replace(/[^0-9.]/g, "")) || 0,
          price: Number(String(u.price).replace(/\D/g, "")) || 0,
        }))
        .filter((u) => u.name && u.factor > 0);
      const pricesDict: Record<string, number> = {};
      if (usePriceLevels) {
        priceLevels.forEach((lv) => {
          const raw = levelPrices[lv.id];
          if (raw !== undefined) {
            const num = Number(String(raw).replace(/\D/g, ""));
            if (num > 0) pricesDict[lv.id] = num;
          }
        });
      }
      const body = JSON.stringify({
        name: name.trim(),
        product_type: productType,
        base_unit: baseUnit.trim() || "Pcs",
        units: normalizedUnits,
        price: Number(price.replace(/\D/g, "")),
        prices: pricesDict,
        cost: Number(cost.replace(/\D/g, "")) || 0,
        stock: productType === "service" ? 0 : Number(stock.replace(/\D/g, "")) || 0,
        min_stock: Number(minStock.replace(/\D/g, "")) || 5,
        category: category.trim() || "Umum",
        barcode: barcode.trim(),
        sku: barcode.trim(),
        kitchen_print: kitchenPrint,
        use_price_levels: usePriceLevels,
        image_base64: image,
        requires_technician: productType === "service" && requiresTech,
        commission_type: commissionType,
        commission_value: Number(String(commissionValue).replace(/[^0-9.]/g, "")) || 0,
      });
      if (id) await apiRequest(`/products/${id}`, { method: "PUT", body });
      else await apiRequest("/products", { method: "POST", body });
      toast.success(id ? "Produk diperbarui" : "Produk ditambahkan");
      router.back();
    } catch (e) {
      toast.error("Gagal menyimpan", e instanceof Error ? e.message : undefined);
    } finally { setBusy(false); }
  };

  if (loading) {
    return <View style={[styles.screen, { alignItems: "center", justifyContent: "center" }]}><ActivityIndicator color={colors.brandPrimary} /></View>;
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 10 }]} keyboardShouldPersistTaps="handled">
        <View style={styles.between}>
          <Text style={[styles.title, { fontSize: 24 }]}>{id ? "Edit produk" : "Tambah produk"}</Text>
          <Pressable testID="close-product-form" onPress={() => router.back()}><Ionicons name="close" size={26} color={colors.onSurface} /></Pressable>
        </View>

        <View style={{ flexDirection: "row", gap: 8, marginVertical: 12 }}>
          {(["goods", "service"] as const).map((t) => (
            <Pressable
              key={t}
              testID={`type-${t}`}
              onPress={() => setProductType(t)}
              style={[{ flex: 1, minHeight: 44, borderRadius: 12, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" }, productType === t && { backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandPrimary }]}
            >
              <Text style={{ color: colors.onSurfaceTertiary, fontSize: 13, fontWeight: "800" }}>{t === "goods" ? "Barang" : "Jasa"}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable testID="product-image-picker" onPress={pickImage} style={{ height: 130, borderRadius: 16, marginBottom: 14, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
          {image ? <Image source={{ uri: `data:image/jpeg;base64,${image}` }} style={{ width: "100%", height: "100%" }} /> : (
            <>
              <Ionicons name={productType === "service" ? "briefcase-outline" : "camera-outline"} size={28} color={colors.brandPrimary} />
              <Text style={[styles.muted, { marginTop: 6 }]}>Tambah foto {productType === "service" ? "jasa" : "produk"}</Text>
            </>
          )}
        </Pressable>
        <Text style={styles.inputLabel}>Nama {productType === "service" ? "jasa" : "produk"}</Text>
        <TextInput testID="input-product-name" value={name} onChangeText={setName} style={styles.input} placeholder={productType === "service" ? "Contoh: Cuci motor" : "Contoh: Kopi susu"} placeholderTextColor={colors.muted} />
        <Text style={styles.inputLabel}>Harga pokok (modal)</Text>
        <TextInput testID="input-product-cost" value={cost} onChangeText={setCost} keyboardType="number-pad" style={styles.input} placeholder="10000" placeholderTextColor={colors.muted} />
        <Text style={styles.inputLabel}>Harga jual</Text>
        <TextInput testID="input-product-price" value={price} onChangeText={setPrice} keyboardType="number-pad" style={styles.input} placeholder="15000" placeholderTextColor={colors.muted} />

        <Text style={styles.inputLabel}>Satuan dasar</Text>
        <TextInput testID="input-base-unit" value={baseUnit} onChangeText={setBaseUnit} style={styles.input} placeholder="Pcs / Botol / Jam" placeholderTextColor={colors.muted} />

        {productType === "goods" ? (
          <>
            <Text style={styles.inputLabel}>Stok {id ? "saat ini" : "awal"} (dalam {baseUnit || "satuan dasar"})</Text>
            <TextInput testID="input-product-stock" value={stock} onChangeText={setStock} keyboardType="number-pad" style={styles.input} placeholder="0" placeholderTextColor={colors.muted} />
            <Text style={styles.inputLabel}>Peringatan stok minimum</Text>
            <TextInput value={minStock} onChangeText={setMinStock} keyboardType="number-pad" style={styles.input} placeholder="5" placeholderTextColor={colors.muted} />
          </>
        ) : (
          <>
            <Text style={[styles.muted, { marginBottom: 10 }]}>Produk jasa tidak dihitung stok, cocok untuk layanan atau servis.</Text>
            <View style={styles.card}>
              <View style={styles.between}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.productName}>Terhubung ke karyawan teknis</Text>
                  <Text style={styles.muted}>Saat transaksi, kasir memilih karyawan yang mengerjakan jasa ini.</Text>
                </View>
                <Switch testID="requires-technician-switch" value={requiresTech} onValueChange={setRequiresTech} trackColor={{ true: colors.brandPrimary, false: colors.borderStrong }} thumbColor={colors.onBrandPrimary} />
              </View>
              {requiresTech ? (
                <View style={{ marginTop: 12 }}>
                  <Text style={styles.inputLabel}>Komisi karyawan</Text>
                  <View style={{ flexDirection: "row", gap: 8, marginBottom: 10 }}>
                    {(["percent", "fixed"] as const).map((t) => (
                      <Pressable key={t} testID={`commission-${t}`} onPress={() => setCommissionType(t)} style={[styles.chip, { flex: 1 }, commissionType === t && styles.chipActive]}>
                        <Text style={[styles.chipText, commissionType === t && styles.chipTextActive]}>{t === "percent" ? "Persen (%)" : "Nominal (Rp)"}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <TextInput testID="input-commission-value" value={commissionValue} onChangeText={setCommissionValue} keyboardType="decimal-pad" style={styles.input} placeholder={commissionType === "percent" ? "Contoh: 10 (persen)" : "Contoh: 5000 per jasa"} placeholderTextColor={colors.muted} />
                  <Pressable onPress={() => router.push("/technicians")} style={{ minHeight: 36, justifyContent: "center" }}>
                    <Text style={{ color: colors.brandPrimary, fontWeight: "700", fontSize: 13 }}>Kelola daftar karyawan teknis →</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          </>
        )}

        <View style={styles.card}>
          <View style={styles.between}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Multi satuan</Text>
              <Text style={styles.muted}>Tambahkan konversi: Dus = 12 {baseUnit || "Pcs"}, Lusin = 12 {baseUnit || "Pcs"}.</Text>
            </View>
            <Pressable testID="add-unit" onPress={addUnitRow} style={styles.iconButton}><Ionicons name="add" size={22} color={colors.brandPrimary} /></Pressable>
          </View>
          {units.length === 0 ? <Text style={[styles.muted, { marginTop: 10 }]}>Belum ada satuan tambahan.</Text> : null}
          {units.map((u, idx) => (
            <View key={idx} style={{ marginTop: 10 }}>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TextInput testID={`unit-name-${idx}`} value={u.name} onChangeText={(t) => updateUnit(idx, { name: t })} placeholder="Nama (Dus)" placeholderTextColor={colors.muted} style={[styles.input, { flex: 2, marginBottom: 6 }]} />
                <TextInput testID={`unit-factor-${idx}`} value={u.factor} onChangeText={(t) => updateUnit(idx, { factor: t })} keyboardType="decimal-pad" placeholder="×" placeholderTextColor={colors.muted} style={[styles.input, { flex: 1, marginBottom: 6 }]} />
                <Pressable testID={`unit-remove-${idx}`} onPress={() => removeUnit(idx)} style={{ padding: 10 }}><Ionicons name="trash-outline" size={20} color={colors.error} /></Pressable>
              </View>
              <TextInput testID={`unit-price-${idx}`} value={u.price} onChangeText={(t) => updateUnit(idx, { price: t })} keyboardType="number-pad" placeholder="Harga per satuan (opsional)" placeholderTextColor={colors.muted} style={styles.input} />
            </View>
          ))}
        </View>

        <Text style={styles.inputLabel}>Kategori</Text>
        <Pressable testID="pick-category" onPress={() => setCategoryPicker(true)} style={[styles.input, { flexDirection: "row", alignItems: "center" }]}>
          <Text style={{ flex: 1, color: colors.onSurface, fontSize: 15 }}>{category || "Pilih kategori"}</Text>
          <Ionicons name="chevron-down" size={20} color={colors.muted} />
        </Pressable>
        <Text style={[styles.muted, { fontSize: 11, marginTop: -4, marginBottom: 8 }]}>Terhubung otomatis ke menu Kategori Produk ({categories.length} kategori).</Text>
        <Text style={styles.inputLabel}>Barcode / SKU</Text>
        <TextInput value={barcode} onChangeText={setBarcode} style={styles.input} placeholder="Opsional, scan atau ketik manual" placeholderTextColor={colors.muted} />
        <View style={[styles.between, styles.card, { marginTop: 2 }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.productName}>Cetak ke printer dapur</Text>
            <Text style={styles.muted}>Aktifkan untuk makanan / minuman yang perlu dapur.</Text>
          </View>
          <Switch testID="kitchen-print-switch" value={kitchenPrint} onValueChange={setKitchenPrint} trackColor={{ true: colors.brandPrimary, false: colors.borderStrong }} thumbColor={colors.onBrandPrimary} />
        </View>
        <View style={[styles.between, styles.card, { marginTop: 2 }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.productName}>Pakai level harga</Text>
            <Text style={styles.muted}>Aktifkan jika mau terapkan harga grosir / member untuk produk ini. Mati = selalu 1 harga.</Text>
          </View>
          <Switch testID="use-price-levels-switch" value={usePriceLevels} onValueChange={setUsePriceLevels} trackColor={{ true: colors.brandPrimary, false: colors.borderStrong }} thumbColor={colors.onBrandPrimary} />
        </View>

        {usePriceLevels ? (
          <View style={[styles.card, { marginTop: 2 }]} testID="price-level-inputs">
            <Text style={styles.cardTitle}>Harga per level</Text>
            <Text style={[styles.muted, { marginBottom: 10 }]}>Isi harga untuk tiap level. Pelanggan dengan level tertentu akan otomatis dapat harga ini.</Text>
            {priceLevels.length === 0 ? (
              <View style={{ padding: 12, backgroundColor: colors.brandTertiary, borderRadius: 10, borderWidth: 1, borderColor: colors.warning }}>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <Ionicons name="information-circle-outline" size={18} color={colors.warning} />
                  <Text style={[styles.productName, { marginLeft: 6, color: colors.warning }]}>Belum ada level harga</Text>
                </View>
                <Text style={[styles.muted, { marginTop: 6, lineHeight: 20 }]}>Tambah dulu level harga (misal: Grosir, Member, Reseller) di Lainnya → Pengaturan transaksi → bagian Level Harga, lalu kembali ke sini.</Text>
                <Pressable
                  testID="go-pricelevels"
                  onPress={() => router.push("/transaction-settings")}
                  style={[styles.outlineButton, { marginTop: 10 }]}
                >
                  <Text style={styles.outlineText}>Kelola Level Harga</Text>
                </Pressable>
              </View>
            ) : (
              priceLevels.map((lv) => (
                <View key={lv.id} style={{ marginBottom: 8 }}>
                  <Text style={styles.inputLabel}>{lv.name}</Text>
                  <TextInput
                    testID={`price-level-${lv.id}`}
                    value={levelPrices[lv.id] ?? ""}
                    onChangeText={(txt) => setLevelPrices((prev) => ({ ...prev, [lv.id]: txt.replace(/\D/g, "") }))}
                    placeholder={`Harga ${lv.name.toLowerCase()}`}
                    placeholderTextColor={colors.muted}
                    keyboardType="number-pad"
                    style={styles.input}
                  />
                </View>
              ))
            )}
          </View>
        ) : null}
        <Pressable testID="save-product-button" disabled={busy} onPress={save} style={[styles.primaryButton, busy && { opacity: 0.6 }]}>
          {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryButtonText}>{id ? "Simpan perubahan" : "Simpan produk"}</Text>}
        </Pressable>
      </ScrollView>

      <Modal visible={categoryPicker} transparent animationType="fade" onRequestClose={() => setCategoryPicker(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(28,28,30,0.55)", justifyContent: "flex-end" }}>
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 18, maxHeight: "80%" }}>
            <View style={styles.between}>
              <Text style={styles.cardTitle}>Pilih kategori produk</Text>
              <Pressable onPress={() => setCategoryPicker(false)}><Ionicons name="close" size={22} color={colors.onSurface} /></Pressable>
            </View>
            <Text style={[styles.muted, { marginTop: 4, marginBottom: 10 }]}>Daftar kategori sinkron dengan menu Kategori Produk. Kelola lewat Lainnya → Kategori produk.</Text>
            <ScrollView style={{ maxHeight: 300 }}>
              {categories.length === 0 ? (
                <Text style={[styles.muted, { padding: 10 }]}>Belum ada kategori. Tambahkan lewat input di bawah atau menu Kategori.</Text>
              ) : categories.map((c) => (
                <Pressable
                  key={c.id}
                  testID={`cat-opt-${c.id}`}
                  onPress={() => { setCategory(c.name); setCategoryPicker(false); }}
                  style={styles.listRow}
                >
                  <View style={styles.settingIcon}><Ionicons name={(c.icon as "pricetag-outline") || "pricetag-outline"} size={20} color={colors.brandPrimary} /></View>
                  <Text style={[styles.productName, { flex: 1 }]}>{c.name}</Text>
                  {category === c.name ? <Ionicons name="checkmark-circle" size={22} color={colors.brandPrimary} /> : null}
                </Pressable>
              ))}
            </ScrollView>
            <Text style={[styles.inputLabel, { marginTop: 10 }]}>Atau tambah kategori baru:</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TextInput
                testID="new-category-input"
                value={newCategoryInput}
                onChangeText={setNewCategoryInput}
                placeholder="Nama kategori baru"
                placeholderTextColor={colors.muted}
                style={[styles.input, { flex: 1, marginBottom: 0 }]}
              />
              <Pressable
                testID="add-category-button"
                onPress={async () => {
                  const name = newCategoryInput.trim();
                  if (!name) return;
                  try {
                    const created = await apiRequest<Category>("/categories", { method: "POST", body: JSON.stringify({ name, icon: "pricetag-outline" }) });
                    setCategories((prev) => [...prev, created]);
                    setCategory(created.name);
                    setNewCategoryInput("");
                    setCategoryPicker(false);
                    toast.success("Kategori ditambahkan", created.name);
                  } catch (e) { toast.error("Gagal tambah kategori", e instanceof Error ? e.message : undefined); }
                }}
                style={[styles.primaryButton, { minWidth: 80, paddingHorizontal: 14 }]}
              >
                <Text style={styles.primaryButtonText}>Tambah</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}
