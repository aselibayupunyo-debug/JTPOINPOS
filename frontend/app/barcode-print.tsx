import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SvgXml } from "react-native-svg";

import { apiRequest, BusinessSettings, formatRupiah, Product } from "@/src/api";
import { useAppStyles } from "@/src/app-styles";
import { Header } from "@/src/components/header";
import { barcodeSvg, printBarcodeSheet } from "@/src/pdf";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";

const LAYOUTS = [
  { key: "small", label: "Kecil 38×25mm", perRow: 5, widthMm: 38, heightMm: 25 },
  { key: "medium", label: "Sedang 50×30mm", perRow: 4, widthMm: 50, heightMm: 30 },
  { key: "large", label: "Besar 70×40mm", perRow: 2, widthMm: 70, heightMm: 40 },
];

type PreviewProps = {
  name: string;
  code: string;
  price?: number;
  businessName?: string;
  paperWidth: "58mm" | "80mm";
};

/**
 * Mock tampilan 1 label pada printer thermal.
 * Lebar visual disesuaikan ke paperWidth: 58mm ≈ 230px, 80mm ≈ 320px.
 */
function LabelPreview({ name, code, price, businessName, paperWidth }: PreviewProps) {
  const widthPx = paperWidth === "80mm" ? 320 : 230;
  const svg = useMemo(() => {
    try {
      return barcodeSvg(code || name || "NA", { height: 14, scale: 2, includetext: true });
    } catch {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="30"><text x="4" y="20">${code}</text></svg>`;
    }
  }, [code, name]);

  return (
    <View
      style={{
        alignSelf: "center",
        width: widthPx,
        backgroundColor: "#ffffff",
        borderWidth: 1,
        borderColor: "#d4d4d4",
        borderStyle: "dashed",
        paddingVertical: 12,
        paddingHorizontal: 10,
        alignItems: "center",
      }}
    >
      <Text numberOfLines={2} style={{ fontSize: 12, fontWeight: "800", color: "#111", textAlign: "center" }}>
        {name || "Nama produk"}
      </Text>
      <View style={{ marginTop: 6, width: "100%", alignItems: "center" }}>
        <SvgXml xml={svg} width={widthPx - 24} height={56} />
      </View>
      {typeof price === "number" ? (
        <Text style={{ marginTop: 4, fontSize: 13, fontWeight: "900", color: "#111" }}>
          {formatRupiah(price)}
        </Text>
      ) : null}
      {businessName ? (
        <Text style={{ marginTop: 4, fontSize: 9, color: "#666" }}>{businessName}</Text>
      ) : null}
    </View>
  );
}

export default function BarcodePrintScreen() {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [layoutKey, setLayoutKey] = useState("medium");
  const [showPrice, setShowPrice] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiRequest<Product[]>("/products").then(setProducts).catch(() => undefined);
    apiRequest<BusinessSettings>("/settings").then(setSettings).catch(() => undefined);
  }, []);

  const toggleProduct = (p: Product) => setSelected((s) => ({ ...s, [p.id]: s[p.id] ? 0 : 1 }));
  const changeCount = (id: string, next: number) => setSelected((s) => ({ ...s, [id]: Math.max(0, next) }));

  const totalLabels = Object.values(selected).reduce((a, b) => a + b, 0);
  const selectedProducts = products.filter((p) => (selected[p.id] ?? 0) > 0);

  // Produk pertama yang dipilih untuk dipakai jadi contoh preview.
  const previewProduct = selectedProducts[0] ?? null;
  const paperWidth: "58mm" | "80mm" = settings?.receipt_width === "80mm" ? "80mm" : "58mm";

  const printNow = async () => {
    if (totalLabels === 0) return toast.error("Pilih minimal 1 produk");
    if (!settings) return toast.error("Pengaturan belum siap", "Coba sebentar lagi");
    const labels = selectedProducts.flatMap((p) => Array.from({ length: selected[p.id] }, () => ({
      name: p.name,
      code: p.barcode || p.sku || p.id.slice(0, 10).toUpperCase(),
      price: showPrice ? p.price : undefined,
    })));
    setBusy(true);
    try {
      // 1) Coba cetak langsung ke printer thermal Bluetooth
      const { getPairedPrinter, isPrinterAvailable, printBarcodeLabels } = await import("@/src/bt-printer");
      const [paired, available] = await Promise.all([getPairedPrinter(), isPrinterAvailable()]);
      if (available && paired) {
        await printBarcodeLabels(labels, settings);
        toast.success("Barcode tercetak", `${totalLabels} label · ${paired.name}`);
      } else {
        // 2) Fallback: PDF via expo-print (untuk printer A4 / dibagikan)
        const layout = LAYOUTS.find((l) => l.key === layoutKey) ?? LAYOUTS[1];
        await printBarcodeSheet(labels, layout, settings.business_name ?? "");
        toast.info("PDF siap", "Printer Bluetooth belum terhubung. Kami buat PDF untuk dibagikan.");
      }
    } catch (e) { toast.error("Gagal", e instanceof Error ? e.message : undefined); }
    finally { setBusy(false); }
  };

  const filtered = products.filter((p) => `${p.name} ${p.barcode}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.between}>
          <Header title="Cetak Barcode" subtitle={`${totalLabels} label siap dicetak`} />
          <Pressable onPress={() => router.back()}><Ionicons name="chevron-back" size={26} color={colors.onSurface} /></Pressable>
        </View>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Ukuran stiker</Text>
          <Text style={[styles.muted, { fontSize: 11, marginTop: 2 }]}>Hanya dipakai untuk cetak PDF (fallback). Printer thermal pakai lebar kertas: {paperWidth}.</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
            {LAYOUTS.map((l) => (
              <Pressable key={l.key} testID={`layout-${l.key}`} onPress={() => setLayoutKey(l.key)} style={[{ paddingHorizontal: 14, minHeight: 44, borderRadius: 12, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" }, layoutKey === l.key && { backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandPrimary }]}>
                <Text style={{ color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "800" }}>{l.label}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable testID="toggle-price" onPress={() => setShowPrice((v) => !v)} style={[styles.listRow, { paddingVertical: 10 }]}>
            <View style={{ flex: 1 }}><Text style={styles.productName}>Cetak harga di stiker</Text></View>
            <Ionicons name={showPrice ? "checkbox" : "square-outline"} size={22} color={colors.brandPrimary} />
          </Pressable>
        </View>

        <View style={styles.card}>
          <View style={styles.between}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Contoh label</Text>
              <Text style={[styles.muted, { fontSize: 11, marginTop: 2 }]}>
                {previewProduct ? "Perkiraan tampilan 1 label di kertas thermal." : "Pilih produk di bawah untuk melihat preview."}
              </Text>
            </View>
            <Ionicons name="eye-outline" size={20} color={colors.muted} />
          </View>
          <View style={{ marginTop: 12, backgroundColor: colors.surfaceTertiary, paddingVertical: 14, borderRadius: 10 }}>
            {previewProduct ? (
              <LabelPreview
                name={previewProduct.name}
                code={previewProduct.barcode || previewProduct.sku || previewProduct.id.slice(0, 10).toUpperCase()}
                price={showPrice ? previewProduct.price : undefined}
                businessName={settings?.business_name ?? ""}
                paperWidth={paperWidth}
              />
            ) : (
              <View style={{ alignItems: "center", paddingVertical: 10 }}>
                <Ionicons name="barcode-outline" size={34} color={colors.muted} />
                <Text style={[styles.muted, { marginTop: 6 }]}>Belum ada produk dipilih</Text>
              </View>
            )}
          </View>
          {selectedProducts.length > 1 ? (
            <Text style={[styles.muted, { fontSize: 11, marginTop: 10, textAlign: "center" }]}>
              + {selectedProducts.length - 1} produk lain akan ikut tercetak dengan format sama
            </Text>
          ) : null}
        </View>

        <TextInput testID="bc-search" value={search} onChangeText={setSearch} placeholder="Cari produk" placeholderTextColor={colors.muted} style={styles.search} />
        <View style={{ height: 16 }} />
        {filtered.map((p) => (
          <View key={p.id} style={[styles.listRow, { marginHorizontal: 0 }]}>
            <Pressable testID={`select-${p.id}`} onPress={() => toggleProduct(p)} style={{ flex: 1, flexDirection: "row", alignItems: "center" }}>
              <Ionicons name={selected[p.id] ? "checkbox" : "square-outline"} size={22} color={colors.brandPrimary} style={{ marginRight: 10 }} />
              <View style={{ flex: 1 }}>
                <Text style={styles.productName}>{p.name}</Text>
                <Text style={styles.muted}>{p.barcode || p.sku || p.id.slice(0, 10)}</Text>
              </View>
            </Pressable>
            {selected[p.id] ? (
              <View style={styles.row}>
                <Pressable onPress={() => changeCount(p.id, (selected[p.id] ?? 0) - 1)} style={styles.iconButton}><Ionicons name="remove" size={16} color={colors.brandPrimary} /></Pressable>
                <TextInput value={String(selected[p.id] ?? 0)} onChangeText={(t) => changeCount(p.id, Number(t.replace(/\D/g, "")) || 0)} keyboardType="number-pad" style={{ width: 40, textAlign: "center", color: colors.onSurface, fontWeight: "700" }} />
                <Pressable onPress={() => changeCount(p.id, (selected[p.id] ?? 0) + 1)} style={styles.iconButton}><Ionicons name="add" size={16} color={colors.brandPrimary} /></Pressable>
              </View>
            ) : null}
          </View>
        ))}
      </ScrollView>
      <View style={{ padding: 20, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.divider }}>
        <Pressable testID="print-barcodes" disabled={busy || totalLabels === 0} onPress={printNow} style={[styles.primaryButton, (busy || totalLabels === 0) && { opacity: 0.5 }]}>
          {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryButtonText}>Cetak {totalLabels} label</Text>}
        </Pressable>
      </View>
    </View>
  );
}
