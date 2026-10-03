import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest, formatRupiah, PaymentMethodDoc, Product } from "@/src/api";
import { useAppStyles } from "@/src/app-styles";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";

type Kind = "sale" | "purchase";
type LineItem = { product: Product; qty: number; price: number };

export default function ReturnsScreen() {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [kind, setKind] = useState<Kind>("sale");
  const [products, setProducts] = useState<Product[]>([]);
  const [methods, setMethods] = useState<PaymentMethodDoc[]>([]);
  const [method, setMethod] = useState<string>("");
  const [methodLabel, setMethodLabel] = useState<string>("");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<Record<string, LineItem>>({});
  const [customer, setCustomer] = useState("");
  const [note, setNote] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiRequest<Product[]>("/products").then((list) => setProducts(list.filter((p) => (p.product_type || "goods") === "goods"))).catch(() => undefined);
    apiRequest<PaymentMethodDoc[]>("/payment-methods").then((list) => {
      setMethods(list);
      const first = list.find((m) => m.enabled !== false);
      if (first) { setMethod(first.id); setMethodLabel(first.name); }
    }).catch(() => undefined);
  }, []);

  const addItem = (p: Product) => {
    setItems((prev) => {
      if (prev[p.id]) return { ...prev, [p.id]: { ...prev[p.id], qty: prev[p.id].qty + 1 } };
      return { ...prev, [p.id]: { product: p, qty: 1, price: p.price } };
    });
  };
  const setQty = (id: string, qty: number) => {
    setItems((prev) => {
      if (!prev[id]) return prev;
      if (qty <= 0) {
        const next = { ...prev }; delete next[id]; return next;
      }
      return { ...prev, [id]: { ...prev[id], qty } };
    });
  };
  const setPrice = (id: string, price: number) => {
    setItems((prev) => prev[id] ? { ...prev, [id]: { ...prev[id], price } } : prev);
  };

  const lines = Object.values(items);
  const total = lines.reduce((s, l) => s + l.qty * l.price, 0);
  const totalItems = lines.reduce((s, l) => s + l.qty, 0);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return products.slice(0, 50);
    return products.filter((p) => `${p.name} ${p.barcode} ${p.sku}`.toLowerCase().includes(term)).slice(0, 50);
  }, [products, search]);

  const submit = async () => {
    if (lines.length === 0) return toast.error("Pilih minimal 1 barang untuk diretur");
    if (!method) return toast.error("Pilih metode pembayaran");
    setBusy(true);
    try {
      await apiRequest("/transactions", {
        method: "POST",
        body: JSON.stringify({
          transaction_type: kind === "sale" ? "sale_return" : "purchase_return",
          payment_method: method,
          payment_method_label: methodLabel,
          paid_amount: total,
          customer_name: customer.trim() || (kind === "sale" ? "Pelanggan" : "Supplier"),
          note: note || `Retur ${kind === "sale" ? "penjualan" : "pembelian"} berbasis stok`,
          items: lines.map((l) => ({
            product_id: l.product.id,
            name: l.product.name,
            quantity: l.qty,
            price: l.price,
            cost: l.product.cost || 0,
            unit: l.product.base_unit || "",
            unit_factor: 1,
            product_type: "goods",
          })),
        }),
      });
      toast.success("Retur tersimpan", `${totalItems} barang · ${formatRupiah(total)}`);
      setConfirmOpen(false);
      setItems({});
      setCustomer("");
      setNote("");
    } catch (e) { toast.error("Gagal", e instanceof Error ? e.message : undefined); }
    finally { setBusy(false); }
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: 160 }]} keyboardShouldPersistTaps="handled">
        <View style={styles.between}>
          <Text style={[styles.title, { fontSize: 24 }]}>Retur barang</Text>
          <Pressable onPress={() => router.back()}><Ionicons name="close" size={26} color={colors.onSurface} /></Pressable>
        </View>
        <Text style={[styles.muted, { marginTop: 2, marginBottom: 10 }]}>Pilih barang (produk) dan jumlah yang akan diretur. Stok otomatis bergerak.</Text>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {([{ key: "sale", label: "Retur Penjualan" }, { key: "purchase", label: "Retur Pembelian" }] as const).map((item) => (
            <Pressable key={item.key} testID={`return-tab-${item.key}`} onPress={() => setKind(item.key)} style={[styles.chip, kind === item.key && styles.chipActive]}>
              <Text style={[styles.chipText, kind === item.key && styles.chipTextActive]}>{item.label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <TextInput testID="return-search" value={search} onChangeText={setSearch} placeholder="Cari barang / barcode" placeholderTextColor={colors.muted} style={styles.search} />
        <View style={{ height: 10 }} />
        {filtered.length === 0 ? (
          <Text style={[styles.muted, { textAlign: "center", padding: 16 }]}>Tidak ada barang.</Text>
        ) : filtered.map((p) => (
          <Pressable key={p.id} testID={`return-pick-${p.id}`} onPress={() => addItem(p)} style={[styles.listRow, { backgroundColor: items[p.id] ? colors.brandTertiary : "transparent" }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.productName}>{p.name}</Text>
              <Text style={styles.muted}>Stok: {p.stock} {p.base_unit || ""} · {formatRupiah(p.price)}</Text>
            </View>
            <Ionicons name={items[p.id] ? "checkmark-circle" : "add-circle-outline"} size={26} color={colors.brandPrimary} />
          </Pressable>
        ))}

        {lines.length > 0 ? (
          <View style={[styles.card, { marginTop: 10 }]}>
            <Text style={styles.cardTitle}>Barang akan diretur</Text>
            {lines.map((l) => (
              <View key={l.product.id} style={[styles.listRow, { paddingVertical: 10 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.productName}>{l.product.name}</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}>
                    <Pressable onPress={() => setQty(l.product.id, l.qty - 1)} style={styles.iconButton}><Ionicons name="remove" size={14} color={colors.brandPrimary} /></Pressable>
                    <TextInput
                      value={String(l.qty)}
                      onChangeText={(t) => {
                        const n = Number(String(t).replace(",", ".").replace(/[^\d.]/g, ""));
                        if (Number.isFinite(n) && n >= 0) setQty(l.product.id, Math.round(n * 100) / 100);
                      }}
                      keyboardType="decimal-pad"
                      style={{ width: 60, textAlign: "center", color: colors.onSurface, fontWeight: "700", borderBottomWidth: 1, borderBottomColor: colors.brandPrimary }}
                    />
                    <Pressable onPress={() => setQty(l.product.id, l.qty + 1)} style={styles.iconButton}><Ionicons name="add" size={14} color={colors.brandPrimary} /></Pressable>
                    <Text style={styles.muted}> × </Text>
                    <TextInput
                      value={String(Math.round(l.price))}
                      onChangeText={(t) => {
                        const n = Number(String(t).replace(/\D/g, ""));
                        if (Number.isFinite(n) && n >= 0) setPrice(l.product.id, n);
                      }}
                      keyboardType="number-pad"
                      style={{ minWidth: 80, textAlign: "right", color: colors.onSurface, fontWeight: "700", borderBottomWidth: 1, borderBottomColor: colors.brandPrimary }}
                    />
                  </View>
                </View>
                <Text style={[styles.cardTitle, { color: colors.brandPrimary }]}>{formatRupiah(l.qty * l.price)}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>

      <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: 16, paddingBottom: insets.bottom + 16, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.divider }}>
        <View style={styles.between}>
          <Text style={styles.muted}>{totalItems} barang</Text>
          <Text style={[styles.cardTitle, { color: colors.brandPrimary }]}>{formatRupiah(total)}</Text>
        </View>
        <Pressable testID="submit-return" disabled={lines.length === 0} onPress={() => setConfirmOpen(true)} style={[styles.primaryButton, lines.length === 0 && { opacity: 0.4 }, { marginTop: 10 }]}>
          <Text style={styles.primaryButtonText}>Lanjut retur</Text>
        </Pressable>
      </View>

      <Modal visible={confirmOpen} transparent animationType="fade" onRequestClose={() => setConfirmOpen(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(28,28,30,0.55)", justifyContent: "center", padding: 24 }}>
          <View style={{ backgroundColor: colors.surface, borderRadius: 20, padding: 20 }}>
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 10 }}>
              <Ionicons name="alert-circle" size={28} color={colors.error} />
              <Text style={[styles.cardTitle, { marginLeft: 10, flex: 1, fontSize: 20 }]}>Apakah anda yakin??</Text>
            </View>
            <Text style={[styles.muted, { marginBottom: 10 }]}>
              Akan diretur {totalItems} barang senilai <Text style={{ fontWeight: "700", color: colors.onSurface }}>{formatRupiah(total)}</Text>.
              Stok otomatis akan {kind === "sale" ? "bertambah" : "berkurang"}.
            </Text>

            <Text style={styles.inputLabel}>Nama {kind === "sale" ? "pelanggan" : "supplier"}</Text>
            <TextInput value={customer} onChangeText={setCustomer} style={styles.input} placeholder="Opsional" placeholderTextColor={colors.muted} />
            <Text style={styles.inputLabel}>Catatan</Text>
            <TextInput value={note} onChangeText={setNote} style={styles.input} placeholder="Opsional" placeholderTextColor={colors.muted} />
            <Text style={styles.inputLabel}>Metode pembayaran</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
              {methods.filter((m) => m.enabled !== false).map((m) => (
                <Pressable
                  key={m.id}
                  onPress={() => { setMethod(m.id); setMethodLabel(m.name); }}
                  style={[{ paddingHorizontal: 14, minHeight: 40, borderRadius: 10, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" }, method === m.id && { backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandPrimary }]}
                >
                  <Text style={{ color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "800" }}>{m.name}</Text>
                </Pressable>
              ))}
            </View>

            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable testID="cancel-return" onPress={() => setConfirmOpen(false)} style={[styles.outlineButton, { flex: 1 }]}>
                <Text style={styles.outlineText}>Batal</Text>
              </Pressable>
              <Pressable testID="confirm-return" onPress={submit} disabled={busy} style={[styles.dangerButton, { flex: 1 }, busy && { opacity: 0.5 }]}>
                {busy ? <ActivityIndicator color={colors.error} /> : <Text style={styles.dangerText}>Ya, retur sekarang</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
