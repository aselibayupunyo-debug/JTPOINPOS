import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest, Contact, formatRupiah, PAYMENT_LABELS, PaymentMethod, Product } from "@/src/api";
import { useAppStyles } from "@/src/app-styles";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";

type Line = { product_id: string; name: string; price: number; cost: number; quantity: number };

export default function PurchaseScreen() {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Contact[]>([]);
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [supplier, setSupplier] = useState("");
  const [paidText, setPaidText] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(false);

  useEffect(() => {
    apiRequest<Product[]>("/products").then(setProducts).catch(() => undefined);
    apiRequest<Contact[]>("/suppliers").then(setSuppliers).catch(() => undefined);
  }, []);
  const filtered = products.filter((p) => `${p.name} ${p.barcode}`.toLowerCase().includes(search.toLowerCase())).slice(0, 20);
  const total = lines.reduce((s, l) => s + l.price * l.quantity, 0);
  const paid = Number(paidText.replace(/\D/g, "")) || 0;

  const addLine = (p: Product) => setLines((current) => {
    const found = current.find((l) => l.product_id === p.id);
    if (found) return current.map((l) => l.product_id === p.id ? { ...l, quantity: l.quantity + 1 } : l);
    return [...current, { product_id: p.id, name: p.name, price: p.cost || p.price, cost: p.cost || p.price, quantity: 1 }];
  });
  const update = (id: string, patch: Partial<Line>) => setLines((c) => c.map((l) => l.product_id === id ? { ...l, ...patch } : l).filter((l) => l.quantity > 0));

  const submit = async () => {
    if (!lines.length) return toast.error("Belum ada item");
    if (method === "credit" && !supplier.trim()) return toast.error("Nama supplier wajib untuk kredit");
    setBusy(true);
    try {
      await apiRequest("/transactions", {
        method: "POST",
        body: JSON.stringify({
          transaction_type: "purchase",
          payment_method: method,
          paid_amount: method === "cash" ? total : paid,
          customer_name: supplier.trim() || "Supplier",
          supplier_id: supplierId,
          note,
          items: lines.map((l) => ({ product_id: l.product_id, name: l.name, quantity: l.quantity, price: l.price, cost: l.cost })),
        }),
      });
      toast.success("Pembelian tercatat", `${lines.length} item, ${formatRupiah(total)}`);
      router.back();
    } catch (e) { toast.error("Gagal mencatat", e instanceof Error ? e.message : undefined); }
    finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 10 }]} keyboardShouldPersistTaps="handled">
        <View style={styles.between}>
          <Text style={[styles.title, { fontSize: 24 }]}>Pembelian baru</Text>
          <Pressable onPress={() => router.back()}><Ionicons name="close" size={26} color={colors.onSurface} /></Pressable>
        </View>
        <Text style={[styles.subtitle, { marginBottom: 16 }]}>Catat barang masuk — stok langsung bertambah.</Text>
        <TextInput testID="purchase-search" value={search} onChangeText={setSearch} placeholder="Cari produk untuk ditambahkan" placeholderTextColor={colors.muted} style={styles.input} />
        {search ? filtered.map((p) => (
          <Pressable key={p.id} testID={`purchase-add-${p.id}`} onPress={() => { addLine(p); setSearch(""); }} style={styles.listRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.productName}>{p.name}</Text>
              <Text style={styles.muted}>Stok {p.stock} · Pokok {formatRupiah(p.cost)}</Text>
            </View>
            <Ionicons name="add-circle" size={24} color={colors.brandPrimary} />
          </Pressable>
        )) : null}
        {lines.length ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Daftar pembelian</Text>
            {lines.map((l) => (
              <View key={l.product_id} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.divider }}>
                <View style={styles.between}>
                  <Text style={styles.productName}>{l.name}</Text>
                  <Pressable onPress={() => update(l.product_id, { quantity: 0 })}><Ionicons name="trash-outline" size={20} color={colors.error} /></Pressable>
                </View>
                <View style={[styles.row, { marginTop: 8, gap: 10 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.muted}>Qty</Text>
                    <TextInput value={String(l.quantity)} onChangeText={(t) => update(l.product_id, { quantity: Number(t) || 0 })} keyboardType="number-pad" style={[styles.input, { marginBottom: 0 }]} />
                  </View>
                  <View style={{ flex: 2 }}>
                    <Text style={styles.muted}>Harga pokok / unit</Text>
                    <TextInput value={String(l.price)} onChangeText={(t) => update(l.product_id, { price: Number(t.replace(/\D/g, "")) || 0, cost: Number(t.replace(/\D/g, "")) || 0 })} keyboardType="number-pad" style={[styles.input, { marginBottom: 0 }]} />
                  </View>
                </View>
                <Text style={[styles.muted, { marginTop: 6 }]}>Subtotal: {formatRupiah(l.price * l.quantity)}</Text>
              </View>
            ))}
            <View style={[styles.between, { paddingTop: 12 }]}>
              <Text style={styles.cardTitle}>Total</Text>
              <Text style={[styles.cardTitle, { color: colors.brandPrimary }]}>{formatRupiah(total)}</Text>
            </View>
          </View>
        ) : null}
        <Text style={styles.inputLabel}>Metode pembayaran</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
          {(["cash", "credit"] as PaymentMethod[]).map((m) => (
            <Pressable key={m} testID={`purchase-pay-${m}`} onPress={() => setMethod(m)} style={[{ paddingHorizontal: 14, minHeight: 44, borderRadius: 12, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" }, method === m && { backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandPrimary }]}>
              <Text style={{ color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "800" }}>{PAYMENT_LABELS[m]}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.inputLabel}>Nama supplier</Text>
        <View style={[styles.row, { gap: 10, marginBottom: 12 }]}>
          <TextInput value={supplier} onChangeText={(t) => { setSupplier(t); setSupplierId(null); }} style={[styles.input, { flex: 1, marginBottom: 0 }]} placeholder={method === "credit" ? "Wajib untuk kredit" : "Opsional"} placeholderTextColor={colors.muted} />
          <Pressable testID="pick-supplier" onPress={() => setPicker(true)} style={styles.iconButton}><Ionicons name="briefcase-outline" size={22} color={colors.brandPrimary} /></Pressable>
        </View>
        {method === "credit" ? (
          <>
            <Text style={styles.inputLabel}>Uang muka (opsional)</Text>
            <TextInput value={paidText} onChangeText={setPaidText} keyboardType="number-pad" style={styles.input} placeholder="0" placeholderTextColor={colors.muted} />
          </>
        ) : null}
        <Text style={styles.inputLabel}>Catatan</Text>
        <TextInput value={note} onChangeText={setNote} style={styles.input} placeholder="Opsional" placeholderTextColor={colors.muted} />
        <Pressable testID="purchase-submit" disabled={busy || !lines.length} onPress={submit} style={[styles.primaryButton, (busy || !lines.length) && { opacity: 0.5 }]}>
          {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryButtonText}>Simpan pembelian</Text>}
        </Pressable>
      </ScrollView>
      {picker ? (
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(28,28,30,0.55)", justifyContent: "center", padding: 24 }}>
          <View style={{ backgroundColor: colors.surface, borderRadius: 20, padding: 18, maxHeight: "80%" }}>
            <View style={styles.between}>
              <Text style={styles.cardTitle}>Pilih supplier</Text>
              <Pressable onPress={() => setPicker(false)}><Ionicons name="close" size={22} color={colors.onSurface} /></Pressable>
            </View>
            <ScrollView style={{ marginTop: 10 }}>
              {suppliers.length === 0 ? <Text style={[styles.muted, { marginTop: 10 }]}>Belum ada supplier. Tambahkan di menu Supplier.</Text> : suppliers.map((s) => (
                <Pressable key={s.id} testID={`pick-supplier-${s.id}`} onPress={() => { setSupplier(s.name); setSupplierId(s.id); setPicker(false); }} style={styles.listRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.productName}>{s.name}</Text>
                    <Text style={styles.muted}>{s.phone || "Tanpa nomor"}</Text>
                  </View>
                  <Text style={styles.muted}>{s.transaction_count ?? 0} tx</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}
