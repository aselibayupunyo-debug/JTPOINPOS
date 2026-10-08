import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest, Contact, formatRupiah, PaymentMethod, PaymentMethodDoc, Product } from "@/src/api";
import { useAppStyles } from "@/src/app-styles";
import { formatQtyID, normalizeQtyInput } from "@/src/qty-input";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";

type Line = {
  line_id: string;
  product_id: string;
  name: string;
  unit: string;
  unit_factor: number;
  product_type: "goods" | "service";
  price: number;
  cost: number;
  quantity: number;
};

export default function PurchaseScreen() {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Contact[]>([]);
  const [methods, setMethods] = useState<PaymentMethodDoc[]>([]);
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [method, setMethod] = useState<PaymentMethod>("");
  const [methodLabel, setMethodLabel] = useState<string>("");
  const [supplier, setSupplier] = useState("");
  const [paidText, setPaidText] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(false);
  const [unitPicker, setUnitPicker] = useState<null | { product: Product; options: { name: string; factor: number; cost: number }[] }>(null);
  const [qtyDraft, setQtyDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    apiRequest<Product[]>("/products").then(setProducts).catch(() => undefined);
    apiRequest<Contact[]>("/suppliers").then(setSuppliers).catch(() => undefined);
    apiRequest<PaymentMethodDoc[]>("/payment-methods").then((list) => {
      setMethods(list);
      const first = list.find((m) => m.enabled !== false);
      if (first) { setMethod(first.id); setMethodLabel(first.name); }
    }).catch(() => undefined);
  }, []);
  const currentMethod = methods.find((m) => m.id === method);
  const isCredit = currentMethod?.kind === "credit";
  const filtered = products.filter((p) => `${p.name} ${p.barcode}`.toLowerCase().includes(search.toLowerCase())).slice(0, 20);
  const total = lines.reduce((s, l) => s + l.price * l.quantity, 0);
  const paid = Number(paidText.replace(/\D/g, "")) || 0;

  const pushLine = (product: Product, unit: string, factor: number, costPerUnit: number) => {
    setLines((current) => {
      const lineId = `${product.id}:${unit}`;
      const found = current.find((l) => l.line_id === lineId);
      if (found) return current.map((l) => l.line_id === lineId ? { ...l, quantity: l.quantity + 1 } : l);
      return [...current, {
        line_id: lineId,
        product_id: product.id,
        name: product.name,
        unit,
        unit_factor: factor,
        product_type: product.product_type ?? "goods",
        price: costPerUnit,
        cost: costPerUnit,
        quantity: 1,
      }];
    });
  };

  const addProduct = (p: Product) => {
    if ((p.units ?? []).length > 0) {
      const baseCost = p.cost || p.price;
      const options = [
        { name: p.base_unit ?? "Pcs", factor: 1, cost: baseCost },
        ...(p.units ?? []).map((u) => ({ name: u.name, factor: u.factor, cost: u.price || baseCost * u.factor })),
      ];
      setUnitPicker({ product: p, options });
      return;
    }
    pushLine(p, p.base_unit ?? "Pcs", 1, p.cost || p.price);
    setSearch("");
  };

  const update = (lineId: string, patch: Partial<Line>) =>
    setLines((c) => c.map((l) => l.line_id === lineId ? { ...l, ...patch } : l).filter((l) => l.quantity > 0));

  const commitQty = (lineId: string, next: number) => {
    const rounded = Math.max(0, Math.round(next * 100) / 100);
    update(lineId, { quantity: rounded });
  };

  const submit = async () => {
    if (!lines.length) return toast.error("Belum ada item");
    if (!method) return toast.error("Pilih metode pembayaran");
    if (isCredit && !supplier.trim()) return toast.error("Nama supplier wajib untuk kredit");
    setBusy(true);
    try {
      await apiRequest("/transactions", {
        method: "POST",
        body: JSON.stringify({
          transaction_type: "purchase",
          payment_method: method,
          payment_method_label: methodLabel,
          paid_amount: isCredit ? paid : total,
          customer_name: supplier.trim() || "Supplier",
          supplier_id: supplierId,
          note,
          items: lines.map((l) => ({
            product_id: l.product_id,
            name: l.name,
            quantity: l.quantity,
            price: l.price,
            cost: l.cost,
            unit: l.unit,
            unit_factor: l.unit_factor,
            product_type: l.product_type,
          })),
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
        <Text style={[styles.subtitle, { marginBottom: 16 }]}>Catat barang masuk — stok langsung bertambah mengikuti satuan.</Text>
        <TextInput testID="purchase-search" value={search} onChangeText={setSearch} placeholder="Cari produk untuk ditambahkan" placeholderTextColor={colors.muted} style={styles.input} />
        {search ? filtered.map((p) => (
          <Pressable key={p.id} testID={`purchase-add-${p.id}`} onPress={() => addProduct(p)} style={styles.listRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.productName}>{p.name}{p.product_type === "service" ? " · Jasa" : ""}</Text>
              <Text style={styles.muted}>Stok {p.stock} {p.base_unit ?? "Pcs"} · Pokok {formatRupiah(p.cost)}{(p.units ?? []).length ? " · multi-satuan" : ""}</Text>
            </View>
            <Ionicons name="add-circle" size={24} color={colors.brandPrimary} />
          </Pressable>
        )) : null}
        {lines.length ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Daftar pembelian</Text>
            {lines.map((l) => (
              <View key={l.line_id} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.divider }}>
                <View style={styles.between}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.productName}>{l.name}</Text>
                    <Text style={styles.muted}>Satuan: {l.unit} (×{l.unit_factor})</Text>
                  </View>
                  <Pressable testID={`purchase-remove-${l.line_id}`} onPress={() => update(l.line_id, { quantity: 0 })}><Ionicons name="trash-outline" size={20} color={colors.error} /></Pressable>
                </View>
                <View style={[styles.row, { marginTop: 8, gap: 10 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.muted}>Qty</Text>
                    <TextInput
                      testID={`purchase-qty-${l.line_id}`}
                      value={qtyDraft[l.line_id] ?? formatQtyID(l.quantity)}
                      onChangeText={(t) => {
                        const { display, value } = normalizeQtyInput(t);
                        setQtyDraft((d) => ({ ...d, [l.line_id]: display }));
                        if (value !== null && value > 0) commitQty(l.line_id, value);
                      }}
                      onBlur={() => {
                        const draft = qtyDraft[l.line_id];
                        if (draft !== undefined) {
                          const { value } = normalizeQtyInput(draft);
                          if (value !== null && value > 0) commitQty(l.line_id, value);
                        }
                        setQtyDraft((d) => { const n = { ...d }; delete n[l.line_id]; return n; });
                      }}
                      keyboardType="decimal-pad"
                      placeholder="0"
                      placeholderTextColor={colors.muted}
                      style={[styles.input, { marginBottom: 0 }]}
                    />
                  </View>
                  <View style={{ flex: 2 }}>
                    <Text style={styles.muted}>Harga pokok / {l.unit}</Text>
                    <TextInput testID={`purchase-price-${l.line_id}`} value={String(l.price)} onChangeText={(t) => update(l.line_id, { price: Number(t.replace(/\D/g, "")) || 0, cost: Number(t.replace(/\D/g, "")) || 0 })} keyboardType="number-pad" style={[styles.input, { marginBottom: 0 }]} />
                  </View>
                </View>
                <Text style={[styles.muted, { marginTop: 6 }]}>Subtotal: {formatRupiah(l.price * l.quantity)}{l.product_type === "goods" && l.unit_factor !== 1 ? ` · +${formatQtyID(l.quantity * l.unit_factor)} stok dasar` : ""}</Text>
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
          {methods.filter((m) => m.enabled !== false).map((m) => {
            const selected = method === m.id;
            return (
              <Pressable
                key={m.id}
                testID={`purchase-pay-${m.id}`}
                onPress={() => { setMethod(m.id); setMethodLabel(m.name); }}
                style={[{ paddingHorizontal: 14, minHeight: 44, borderRadius: 12, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" }, selected && { backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandPrimary }]}
              >
                <Text style={{ color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "800" }}>{m.name}</Text>
              </Pressable>
            );
          })}
          {methods.length === 0 ? (
            <Text style={styles.muted}>Belum ada metode. Tambahkan di menu Metode Pembayaran.</Text>
          ) : null}
        </View>
        <Text style={styles.inputLabel}>Nama supplier</Text>
        <View style={[styles.row, { gap: 10, marginBottom: 12 }]}>
          <TextInput value={supplier} onChangeText={(t) => { setSupplier(t); setSupplierId(null); }} style={[styles.input, { flex: 1, marginBottom: 0 }]} placeholder={isCredit ? "Wajib untuk kredit" : "Opsional"} placeholderTextColor={colors.muted} />
          <Pressable testID="pick-supplier" onPress={() => setPicker(true)} style={styles.iconButton}><Ionicons name="briefcase-outline" size={22} color={colors.brandPrimary} /></Pressable>
        </View>
        {isCredit ? (
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
      <Modal visible={!!unitPicker} transparent animationType="fade" onRequestClose={() => setUnitPicker(null)}>
        <View style={{ flex: 1, backgroundColor: "rgba(28,28,30,0.55)", justifyContent: "flex-end" }}>
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: insets.bottom + 20 }}>
            <View style={styles.between}>
              <Text style={styles.cardTitle}>{unitPicker?.product.name}</Text>
              <Pressable onPress={() => setUnitPicker(null)}><Ionicons name="close" size={24} color={colors.onSurface} /></Pressable>
            </View>
            <Text style={[styles.muted, { marginTop: 4, marginBottom: 10 }]}>Pilih satuan pembelian. Stok otomatis ditambah mengikuti faktor konversi.</Text>
            {(unitPicker?.options ?? []).map((u, idx) => (
              <Pressable
                key={`${u.name}-${idx}`}
                testID={`purchase-unit-${u.name}`}
                onPress={() => {
                  if (!unitPicker) return;
                  pushLine(unitPicker.product, u.name, u.factor, u.cost);
                  setUnitPicker(null);
                  setSearch("");
                }}
                style={styles.listRow}
              >
                <View style={styles.settingIcon}><Ionicons name="cube-outline" size={20} color={colors.brandPrimary} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.productName}>{u.name}</Text>
                  <Text style={styles.muted}>×{u.factor} satuan dasar</Text>
                </View>
                <Text style={[styles.productName, { color: colors.brandPrimary }]}>{formatRupiah(u.cost)}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}
