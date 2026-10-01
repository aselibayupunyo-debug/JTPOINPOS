import Ionicons from "@expo/vector-icons/Ionicons";
import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest, Product } from "@/src/api";
import { useAppStyles } from "@/src/app-styles";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";

export default function ProductFormScreen() {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");
  const [stock, setStock] = useState("");
  const [minStock, setMinStock] = useState("5");
  const [category, setCategory] = useState("Umum");
  const [barcode, setBarcode] = useState("");
  const [kitchenPrint, setKitchenPrint] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!!id);

  useEffect(() => {
    if (!id) return;
    apiRequest<Product[]>(`/products`).then((list) => {
      const match = list.find((p) => p.id === id);
      if (match) {
        setName(match.name); setPrice(String(match.price)); setCost(String(match.cost));
        setStock(String(match.stock)); setMinStock(String(match.min_stock));
        setCategory(match.category); setBarcode(match.barcode); setKitchenPrint(!!match.kitchen_print);
        setImage(match.image_base64 ?? null);
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

  const save = async () => {
    if (!name.trim() || !price.trim()) return toast.error("Data belum lengkap", "Nama dan harga wajib diisi.");
    setBusy(true);
    try {
      const body = JSON.stringify({
        name: name.trim(),
        price: Number(price.replace(/\D/g, "")),
        cost: Number(cost.replace(/\D/g, "")) || 0,
        stock: Number(stock.replace(/\D/g, "")) || 0,
        min_stock: Number(minStock.replace(/\D/g, "")) || 5,
        category: category.trim() || "Umum",
        barcode: barcode.trim(),
        sku: barcode.trim(),
        kitchen_print: kitchenPrint,
        image_base64: image,
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
        <Pressable testID="product-image-picker" onPress={pickImage} style={{ height: 130, borderRadius: 16, marginVertical: 18, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
          {image ? <Image source={{ uri: `data:image/jpeg;base64,${image}` }} style={{ width: "100%", height: "100%" }} /> : (
            <>
              <Ionicons name="camera-outline" size={28} color={colors.brandPrimary} />
              <Text style={[styles.muted, { marginTop: 6 }]}>Tambah foto produk</Text>
            </>
          )}
        </Pressable>
        <Text style={styles.inputLabel}>Nama produk</Text>
        <TextInput testID="input-product-name" value={name} onChangeText={setName} style={styles.input} placeholder="Contoh: Kopi susu" placeholderTextColor={colors.muted} />
        <Text style={styles.inputLabel}>Harga pokok (modal)</Text>
        <TextInput testID="input-product-cost" value={cost} onChangeText={setCost} keyboardType="number-pad" style={styles.input} placeholder="10000" placeholderTextColor={colors.muted} />
        <Text style={styles.inputLabel}>Harga jual</Text>
        <TextInput testID="input-product-price" value={price} onChangeText={setPrice} keyboardType="number-pad" style={styles.input} placeholder="15000" placeholderTextColor={colors.muted} />
        <Text style={styles.inputLabel}>Stok {id ? "saat ini" : "awal"}</Text>
        <TextInput testID="input-product-stock" value={stock} onChangeText={setStock} keyboardType="number-pad" style={styles.input} placeholder="0" placeholderTextColor={colors.muted} />
        <Text style={styles.inputLabel}>Peringatan stok minimum</Text>
        <TextInput value={minStock} onChangeText={setMinStock} keyboardType="number-pad" style={styles.input} placeholder="5" placeholderTextColor={colors.muted} />
        <Text style={styles.inputLabel}>Kategori</Text>
        <TextInput value={category} onChangeText={setCategory} style={styles.input} placeholder="Umum / Makanan / Minuman" placeholderTextColor={colors.muted} />
        <Text style={styles.inputLabel}>Barcode / SKU</Text>
        <TextInput value={barcode} onChangeText={setBarcode} style={styles.input} placeholder="Opsional, scan atau ketik manual" placeholderTextColor={colors.muted} />
        <View style={[styles.between, styles.card, { marginTop: 2 }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.productName}>Cetak ke printer dapur</Text>
            <Text style={styles.muted}>Aktifkan untuk makanan / minuman yang perlu dapur.</Text>
          </View>
          <Switch testID="kitchen-print-switch" value={kitchenPrint} onValueChange={setKitchenPrint} trackColor={{ true: colors.brandPrimary, false: colors.borderStrong }} thumbColor={colors.onBrandPrimary} />
        </View>
        <Pressable testID="save-product-button" disabled={busy} onPress={save} style={[styles.primaryButton, busy && { opacity: 0.6 }]}>
          {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryButtonText}>{id ? "Simpan perubahan" : "Simpan produk"}</Text>}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
