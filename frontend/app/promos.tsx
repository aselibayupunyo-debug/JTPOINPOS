import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest, formatRupiah, Product, Promo } from "@/src/api";
import { useAppStyles } from "@/src/app-styles";
import { Header } from "@/src/components/header";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";

const KIND_LABEL: Record<Promo["kind"], string> = {
  buy_x_get_y: "Beli X Gratis Y",
  bundle: "Paket harga tetap",
  percent: "Diskon persen",
};

export default function PromosScreen() {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [list, setList] = useState<Promo[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Promo | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, prod] = await Promise.all([apiRequest<Promo[]>("/promos"), apiRequest<Product[]>("/products")]);
      setList(p); setProducts(prod);
    } catch (e) { toast.error("Gagal", e instanceof Error ? e.message : undefined); }
  }, [toast]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const askDelete = (p: Promo) => {
    Alert.alert("Hapus promo?", p.name, [
      { text: "Batal", style: "cancel" },
      { text: "Hapus", style: "destructive", onPress: async () => {
        try { await apiRequest(`/promos/${p.id}`, { method: "DELETE" }); toast.success("Dihapus"); await load(); }
        catch (e) { toast.error("Gagal", e instanceof Error ? e.message : undefined); }
      } },
    ]);
  };

  const toggle = async (p: Promo, active: boolean) => {
    try { await apiRequest(`/promos/${p.id}`, { method: "PUT", body: JSON.stringify({ ...p, active }) }); await load(); }
    catch (e) { toast.error("Gagal", e instanceof Error ? e.message : undefined); }
  };

  const describe = (p: Promo) => {
    const prod = (id?: string | null) => id ? (products.find((x) => x.id === id)?.name ?? "Produk") : "Produk";
    const cond = p.conditions.map((c) => `${c.quantity}× ${prod(c.product_id)}`).join(" + ");
    if (p.kind === "buy_x_get_y") return `${cond} → gratis ${p.reward.quantity}× ${prod(p.reward.product_id)}`;
    if (p.kind === "bundle") return `${cond} → harga paket ${formatRupiah(p.reward.fixed_price)}`;
    return `${cond} → diskon ${p.reward.percent}%`;
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.between}>
          <Header title="Promo paket" subtitle={`${list.filter((p) => p.active).length}/${list.length} promo aktif`} />
          <Pressable onPress={() => router.back()}><Ionicons name="chevron-back" size={26} color={colors.onSurface} /></Pressable>
        </View>
        {list.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="gift-outline" size={44} color={colors.muted} />
            <Text style={[styles.muted, { marginTop: 10 }]}>Belum ada promo. Buat promo pertama di bawah.</Text>
          </View>
        ) : list.map((p) => (
          <View key={p.id} style={styles.card}>
            <View style={styles.between}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{p.name}</Text>
                <Text style={styles.muted}>{KIND_LABEL[p.kind]}</Text>
                <Text style={[styles.muted, { marginTop: 4 }]}>{describe(p)}</Text>
              </View>
              <Switch testID={`promo-active-${p.id}`} value={p.active} onValueChange={(v) => toggle(p, v)} trackColor={{ true: colors.brandPrimary, false: colors.borderStrong }} thumbColor={colors.onBrandPrimary} />
            </View>
            <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
              <Pressable testID={`edit-promo-${p.id}`} onPress={() => { setEditing(p); setOpen(true); }} style={[styles.outlineButton, { flex: 1 }]}>
                <Text style={styles.outlineText}>Edit</Text>
              </Pressable>
              <Pressable testID={`del-promo-${p.id}`} onPress={() => askDelete(p)} style={[styles.dangerButton, { flex: 1 }]}>
                <Text style={styles.dangerText}>Hapus</Text>
              </Pressable>
            </View>
          </View>
        ))}
      </ScrollView>
      <Pressable testID="add-promo" onPress={() => { setEditing(null); setOpen(true); }} style={[styles.fab, { bottom: insets.bottom + 24 }]}>
        <Ionicons name="add" size={26} color={colors.onBrandPrimary} />
      </Pressable>
      <PromoForm visible={open} initial={editing} products={products} onClose={() => setOpen(false)} onSaved={async () => { setOpen(false); await load(); }} />
    </View>
  );
}

function PromoForm({ visible, initial, products, onClose, onSaved }: { visible: boolean; initial: Promo | null; products: Product[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const toast = useToast();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Promo["kind"]>("buy_x_get_y");
  const [buyId, setBuyId] = useState<string>("");
  const [buyQty, setBuyQty] = useState("2");
  const [freeId, setFreeId] = useState<string>("");
  const [freeQty, setFreeQty] = useState("1");
  const [bundlePrice, setBundlePrice] = useState("0");
  const [percent, setPercent] = useState("10");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    if (initial) {
      setName(initial.name); setKind(initial.kind);
      setBuyId(initial.conditions[0]?.product_id ?? "");
      setBuyQty(String(initial.conditions[0]?.quantity ?? 2));
      setFreeId(initial.reward.product_id ?? "");
      setFreeQty(String(initial.reward.quantity ?? 1));
      setBundlePrice(String(initial.reward.fixed_price ?? 0));
      setPercent(String(initial.reward.percent ?? 10));
    } else {
      setName(""); setKind("buy_x_get_y"); setBuyId(products[0]?.id ?? ""); setBuyQty("2");
      setFreeId(products[0]?.id ?? ""); setFreeQty("1"); setBundlePrice("0"); setPercent("10");
    }
  }, [visible, initial, products]);

  const save = async () => {
    if (!name.trim()) return toast.error("Nama promo wajib");
    if (!buyId) return toast.error("Pilih produk syarat");
    setBusy(true);
    try {
      const reward = kind === "buy_x_get_y" ? { kind: "free_item", product_id: freeId || buyId, quantity: Number(freeQty) || 1, percent: 0, fixed_price: 0 }
        : kind === "bundle" ? { kind: "fixed_price", product_id: null, quantity: 1, percent: 0, fixed_price: Number(bundlePrice.replace(/\D/g, "")) || 0 }
        : { kind: "percent_discount", product_id: null, quantity: 1, percent: Number(percent) || 0, fixed_price: 0 };
      const body = JSON.stringify({
        name: name.trim(), kind,
        conditions: [{ product_id: buyId, quantity: Number(buyQty) || 1 }],
        reward, active: true, note: "",
      });
      if (initial) await apiRequest(`/promos/${initial.id}`, { method: "PUT", body });
      else await apiRequest("/promos", { method: "POST", body });
      toast.success(initial ? "Promo diperbarui" : "Promo ditambahkan");
      await onSaved();
    } catch (e) { toast.error("Gagal", e instanceof Error ? e.message : undefined); }
    finally { setBusy(false); }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(28,28,30,0.55)", justifyContent: "flex-end" }}>
        <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: "90%" }}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <View style={styles.between}>
              <Text style={[styles.title, { fontSize: 22 }]}>{initial ? "Edit promo" : "Promo baru"}</Text>
              <Pressable onPress={onClose}><Ionicons name="close" size={24} color={colors.onSurface} /></Pressable>
            </View>
            <Text style={styles.inputLabel}>Nama promo</Text>
            <TextInput testID="promo-name" value={name} onChangeText={setName} placeholder="Mis: Beli 2 Gratis 1" placeholderTextColor={colors.muted} style={styles.input} />
            <Text style={styles.inputLabel}>Jenis promo</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
              {(["buy_x_get_y", "bundle", "percent"] as Promo["kind"][]).map((k) => (
                <Pressable key={k} onPress={() => setKind(k)} style={[{ paddingHorizontal: 14, minHeight: 42, borderRadius: 12, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" }, kind === k && { backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandPrimary }]}>
                  <Text style={{ color: colors.onSurfaceTertiary, fontWeight: "800", fontSize: 12 }}>{KIND_LABEL[k]}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.inputLabel}>Produk syarat</Text>
            <ProductPicker value={buyId} onChange={setBuyId} products={products} testID="buy-product" />
            <Text style={styles.inputLabel}>Jumlah syarat</Text>
            <TextInput testID="buy-qty" keyboardType="number-pad" value={buyQty} onChangeText={setBuyQty} style={styles.input} placeholderTextColor={colors.muted} />
            {kind === "buy_x_get_y" ? (
              <>
                <Text style={styles.inputLabel}>Produk hadiah (kosongkan untuk produk sama)</Text>
                <ProductPicker value={freeId} onChange={setFreeId} products={products} testID="free-product" />
                <Text style={styles.inputLabel}>Jumlah gratis</Text>
                <TextInput testID="free-qty" keyboardType="number-pad" value={freeQty} onChangeText={setFreeQty} style={styles.input} placeholderTextColor={colors.muted} />
              </>
            ) : null}
            {kind === "bundle" ? (
              <>
                <Text style={styles.inputLabel}>Harga paket</Text>
                <TextInput testID="bundle-price" keyboardType="number-pad" value={bundlePrice} onChangeText={setBundlePrice} style={styles.input} placeholderTextColor={colors.muted} />
              </>
            ) : null}
            {kind === "percent" ? (
              <>
                <Text style={styles.inputLabel}>Diskon (%)</Text>
                <TextInput testID="percent-input" keyboardType="number-pad" value={percent} onChangeText={setPercent} style={styles.input} placeholderTextColor={colors.muted} />
              </>
            ) : null}
            <Pressable testID="save-promo" disabled={busy} onPress={save} style={[styles.primaryButton, busy && { opacity: 0.5 }]}>
              <Text style={styles.primaryButtonText}>Simpan</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function ProductPicker({ value, onChange, products, testID }: { value: string; onChange: (id: string) => void; products: Product[]; testID?: string }) {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const selected = products.find((p) => p.id === value);
  return (
    <>
      <Pressable testID={testID} onPress={() => setOpen(true)} style={[styles.input, { justifyContent: "center" }]}>
        <Text style={{ color: selected ? colors.onSurface : colors.muted }}>{selected?.name ?? "Pilih produk…"}</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 24 }}>
          <View style={{ backgroundColor: colors.surface, borderRadius: 18, padding: 16, maxHeight: "80%" }}>
            <ScrollView>
              {products.map((p) => (
                <Pressable key={p.id} onPress={() => { onChange(p.id); setOpen(false); }} style={styles.listRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.productName}>{p.name}</Text>
                    <Text style={styles.muted}>{formatRupiah(p.price)}</Text>
                  </View>
                  {p.id === value ? <Ionicons name="checkmark" size={22} color={colors.brandPrimary} /> : null}
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}
