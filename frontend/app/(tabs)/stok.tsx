import Ionicons from "@expo/vector-icons/Ionicons";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Platform, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
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
        type: ["text/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel"],
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const file = result.assets[0];
      const response = await uploadProducts({ uri: file.uri, name: file.name, mimeType: file.mimeType });
      toast.success("Import selesai", `${response.imported} produk ditambahkan.`);
      await load();
    } catch (e) {
      toast.error("Import gagal", e instanceof Error ? e.message : "Periksa format file.");
    }
  };

  const exportExcel = async () => {
    try {
      if (Platform.OS === "web") return toast.info("Export Excel di web", "Fitur export otomatis buka file.xlsx di aplikasi mobile. Di web, gunakan menu share browser.");
      const { base64, filename } = await downloadProductsExcel();
      const dir = FileSystem.cacheDirectory ?? "";
      const path = `${dir}${filename}`;
      await FileSystem.writeAsStringAsync(path, base64, { encoding: FileSystem.EncodingType.Base64 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path, {
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          dialogTitle: "Bagikan katalog produk",
          UTI: "org.openxmlformats.spreadsheetml.sheet",
        });
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
        try { await apiRequest(`/products/${product.id}`, { method: "DELETE" }); toast.success("Produk dihapus"); await load(); }
        catch (e) { toast.error("Gagal menghapus", e instanceof Error ? e.message : undefined); }
      } },
    ]);
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
              <Text style={styles.muted}>Tambah, edit, atau import Excel.</Text>
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
              onPress={() => can("inventory") && router.push({ pathname: "/product-form", params: { id: p.id } })}
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
    </View>
  );
}
