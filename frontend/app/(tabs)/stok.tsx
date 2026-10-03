import Ionicons from "@expo/vector-icons/Ionicons";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Modal, Platform, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest, downloadProductsExcel, formatRupiah, Product, uploadProducts } from "@/src/api";
import { useAppStyles } from "@/src/app-styles";
import { useAuth } from "@/src/auth-context";
import { Header } from "@/src/components/header";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";

export default function StokScreen() {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { user, can } = useAuth();
  const toast = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"Semua" | "Menipis" | "Habis">("Semua");
  const [refreshing, setRefreshing] = useState(false);

  // Menu produk & stock adjust
  const [menuProduct, setMenuProduct] = useState<Product | null>(null);
  const [adjustMode, setAdjustMode] = useState<"add" | "sub" | null>(null);
  const [adjustQty, setAdjustQty] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjustBusy, setAdjustBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setProducts(await apiRequest<Product[]>("/products"));
    } catch (e) {
      toast.error("Gagal memuat stok", e instanceof Error ? e.message : undefined);
    }
  }, [toast]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const shown = products
    .filter((p) => `${p.name} ${p.barcode} ${p.sku}`.toLowerCase().includes(search.toLowerCase()))
    .filter((p) => filter === "Semua" || (filter === "Menipis" ? p.stock <= p.min_stock && p.stock > 0 : p.stock === 0));

  const importExcel = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["text/csv", "text/comma-separated-values", "application/csv", "text/plain", "*/*"],
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const file = result.assets[0];
      if (!file.name.toLowerCase().endsWith(".csv")) {
        return toast.error("Format tidak didukung", "Mode offline hanya menerima file .CSV (export dari Excel: Save As → CSV)");
      }
      const response = await uploadProducts({ uri: file.uri, name: file.name, mimeType: file.mimeType });
      toast.success("Import selesai", `${response.imported} produk · ${response.created ?? 0} baru, ${response.updated ?? 0} diperbarui.`);
      await load();
    } catch (e) {
      toast.error("Import gagal", e instanceof Error ? e.message : "Periksa format file.");
    }
  };

  const exportExcel = async () => {
    try {
      if (Platform.OS === "web") return toast.info("Export di web", "Fitur export otomatis buka file di aplikasi mobile.");
      const { base64, filename } = await downloadProductsExcel();
      const dir = FileSystem.cacheDirectory ?? "";
      const path = `${dir}${filename}`;
      await FileSystem.writeAsStringAsync(path, base64, { encoding: FileSystem.EncodingType.Base64 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path, { mimeType: "text/csv", dialogTitle: "Bagikan katalog produk" });
      } else {
        toast.success("File tersimpan", path);
      }
    } catch (e) {
      toast.error("Export gagal", e instanceof Error ? e.message : undefined);
    }
  };

  const askDelete = (product: Product) => {
    Alert.alert("Hapus produk?", product.name, [
      { text: "Batal", style: "cancel" },
      { text: "Hapus", style: "destructive", onPress: async () => {
        try { await apiRequest(`/products/${product.id}`, { method: "DELETE" }); toast.success("Produk dihapus"); setMenuProduct(null); await load(); }
        catch (e) { toast.error("Gagal menghapus", e instanceof Error ? e.message : undefined); }
      } },
    ]);
  };

  const openAdjust = (mode: "add" | "sub") => { setAdjustMode(mode); setAdjustQty(""); setAdjustReason(""); };
  const submitAdjust = async () => {
    if (!menuProduct || !adjustMode) return;
    const qty = Number(adjustQty.replace(",", "."));
    if (!Number.isFinite(qty) || qty <= 0) return toast.error("Jumlah tidak valid");
    setAdjustBusy(true);
    try {
      const delta = adjustMode === "add" ? qty : -qty;
      await apiRequest("/stock-adjustments", {
        method: "POST",
        body: JSON.stringify({ product_id: menuProduct.id, delta, reason: adjustReason || (adjustMode === "add" ? "Tambah stok" : "Kurangi stok") }),
      });
      toast.success(adjustMode === "add" ? "Stok ditambah" : "Stok dikurangi", `${menuProduct.name} ${adjustMode === "add" ? "+" : "-"}${qty}`);
      setAdjustMode(null);
      setMenuProduct(null);
      await load();
    } catch (e) { toast.error("Gagal", e instanceof Error ? e.message : undefined); }
    finally { setAdjustBusy(false); }
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={colors.brandPrimary} />}
      >
        <Header eyebrow={user?.business_name} title="Stok" subtitle={`${products.length} produk terdaftar`} />
        <View style={styles.row}>
          <TextInput testID="stok-search" value={search} onChangeText={setSearch} placeholder="Cari produk / barcode" placeholderTextColor={colors.muted} style={styles.search} />
          {can("inventory") ? (
            <Pressable testID="add-product-button" onPress={() => router.push("/product-form")} style={styles.iconButton}>
              <Ionicons name="add" size={24} color={colors.brandPrimary} />
            </Pressable>
          ) : null}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {(["Semua", "Menipis", "Habis"] as const).map((f) => (
            <Pressable key={f} testID={`filter-${f}`} onPress={() => setFilter(f)} style={[styles.chip, filter === f && styles.chipActive]}>
              <Text style={[styles.chipText, filter === f && styles.chipTextActive]}>{f}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <View style={styles.card}>
          <View style={styles.between}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Kelola katalog</Text>
              <Text style={styles.muted}>Ketuk produk untuk kelola stok, atau import/export CSV.</Text>
            </View>
            {can("inventory") ? (
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pressable testID="export-excel-button" onPress={exportExcel} style={styles.outlineButton}>
                  <Text style={styles.outlineText}>Export</Text>
                </Pressable>
                <Pressable testID="import-excel-button" onPress={importExcel} style={styles.outlineButton}>
                  <Text style={styles.outlineText}>Import</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
          {shown.length ? shown.map((p) => (
            <Pressable
              key={p.id}
              testID={`stok-item-${p.id}`}
              onPress={() => can("inventory") && setMenuProduct(p)}
              onLongPress={() => can("inventory") && askDelete(p)}
              style={styles.listRow}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.productName}>{p.name}{p.product_type === "service" ? " · Jasa" : ""}</Text>
                <Text style={styles.muted}>{p.category} · Jual {formatRupiah(p.price)}{p.cost ? ` · Pokok ${formatRupiah(p.cost)}` : ""}</Text>
                <Text style={[styles.muted, { marginTop: 3 }]}>{p.barcode || p.sku || "Tanpa kode"}{p.base_unit ? ` · ${p.base_unit}` : ""}{(p.units ?? []).length ? ` · multi-satuan` : ""}</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                {p.product_type === "service" ? (
                  <View style={[styles.badge, { backgroundColor: colors.brandTertiary }]}>
                    <Text style={[styles.badgeText, { color: colors.brandPrimary }]}>Jasa</Text>
                  </View>
                ) : (
                  <View style={[styles.badge, { backgroundColor: p.stock === 0 ? colors.surfaceTertiary : p.stock <= p.min_stock ? colors.surfaceTertiary : colors.brandTertiary }]}>
                    <Text style={[styles.badgeText, p.stock === 0 && { color: colors.error }, p.stock > 0 && p.stock <= p.min_stock && { color: colors.warning }]}>{p.stock} stok</Text>
                  </View>
                )}
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </View>
            </Pressable>
          )) : (
            <View style={styles.empty}>
              <Ionicons name="cube-outline" size={40} color={colors.muted} />
              <Text style={[styles.muted, { marginTop: 10 }]}>Belum ada produk{search ? " yang cocok" : ""}.</Text>
            </View>
          )}
        </View>
      </ScrollView>
      {can("inventory") ? (
        <Pressable testID="fab-add-product" onPress={() => router.push("/product-form")} style={[styles.fab, { bottom: insets.bottom + 16 }]}>
          <Ionicons name="add" size={28} color={colors.onBrandPrimary} />
        </Pressable>
      ) : null}

      {/* Menu aksi produk */}
      <Modal visible={!!menuProduct && !adjustMode} transparent animationType="fade" onRequestClose={() => setMenuProduct(null)}>
        <Pressable style={{ flex: 1, backgroundColor: "rgba(28,28,30,0.55)", justifyContent: "flex-end" }} onPress={() => setMenuProduct(null)}>
          <Pressable style={{ backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: insets.bottom + 20 }} onPress={() => undefined}>
            <View style={{ alignItems: "center", marginBottom: 12 }}>
              <View style={{ width: 44, height: 4, borderRadius: 2, backgroundColor: colors.divider }} />
            </View>
            {menuProduct ? (
              <>
                <Text style={styles.cardTitle}>{menuProduct.name}</Text>
                <Text style={[styles.muted, { marginBottom: 14 }]}>Stok saat ini: {menuProduct.stock} {menuProduct.base_unit || ""}</Text>
                <Pressable testID="menu-add-stock" onPress={() => openAdjust("add")} style={[styles.listRow, { backgroundColor: colors.brandTertiary, borderRadius: 14, paddingHorizontal: 14, marginBottom: 10 }]}>
                  <Ionicons name="add-circle" size={24} color={colors.brandPrimary} />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={[styles.productName, { color: colors.brandPrimary }]}>Tambah Stok</Text>
                    <Text style={styles.muted}>Catat barang masuk / koreksi tambah</Text>
                  </View>
                </Pressable>
                <Pressable testID="menu-sub-stock" onPress={() => openAdjust("sub")} style={[styles.listRow, { backgroundColor: colors.surfaceTertiary, borderRadius: 14, paddingHorizontal: 14, marginBottom: 10 }]}>
                  <Ionicons name="remove-circle" size={24} color={colors.warning} />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={[styles.productName, { color: colors.warning }]}>Kurangi Stok</Text>
                    <Text style={styles.muted}>Catat barang rusak / hilang / koreksi kurang</Text>
                  </View>
                </Pressable>
                <Pressable
                  testID="menu-edit-product"
                  onPress={() => { setMenuProduct(null); router.push({ pathname: "/product-form", params: { id: menuProduct.id } }); }}
                  style={[styles.listRow, { backgroundColor: colors.surfaceTertiary, borderRadius: 14, paddingHorizontal: 14, marginBottom: 10 }]}
                >
                  <Ionicons name="create-outline" size={24} color={colors.onSurface} />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={styles.productName}>Edit Produk</Text>
                    <Text style={styles.muted}>Ubah nama, harga, kategori, dsb.</Text>
                  </View>
                </Pressable>
                <Pressable onPress={() => setMenuProduct(null)} style={[styles.outlineButton, { marginTop: 6 }]}>
                  <Text style={styles.outlineText}>Tutup</Text>
                </Pressable>
              </>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Modal input adjust */}
      <Modal visible={!!adjustMode} transparent animationType="fade" onRequestClose={() => setAdjustMode(null)}>
        <View style={{ flex: 1, backgroundColor: "rgba(28,28,30,0.55)", justifyContent: "center", padding: 24 }}>
          <View style={{ backgroundColor: colors.surface, borderRadius: 20, padding: 20 }}>
            <Text style={styles.cardTitle}>{adjustMode === "add" ? "Tambah Stok" : "Kurangi Stok"}</Text>
            <Text style={[styles.muted, { marginBottom: 10 }]}>{menuProduct?.name} · stok sekarang {menuProduct?.stock}</Text>
            <Text style={styles.inputLabel}>Jumlah</Text>
            <TextInput testID="adjust-qty" value={adjustQty} onChangeText={setAdjustQty} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.muted} style={styles.input} />
            <Text style={styles.inputLabel}>Keterangan</Text>
            <TextInput testID="adjust-reason" value={adjustReason} onChangeText={setAdjustReason} placeholder={adjustMode === "add" ? "contoh: barang masuk, koreksi tambah" : "contoh: rusak, hilang, pakai sendiri"} placeholderTextColor={colors.muted} style={styles.input} />
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable onPress={() => setAdjustMode(null)} style={[styles.outlineButton, { flex: 1 }]}>
                <Text style={styles.outlineText}>Batal</Text>
              </Pressable>
              <Pressable testID="submit-adjust" disabled={adjustBusy} onPress={submitAdjust} style={[styles.primaryButton, { flex: 1 }, adjustBusy && { opacity: 0.5 }]}>
                {adjustBusy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryButtonText}>Simpan</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
