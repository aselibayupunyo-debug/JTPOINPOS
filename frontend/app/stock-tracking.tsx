import Ionicons from "@expo/vector-icons/Ionicons";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest, BusinessSettings } from "@/src/api";
import { useAppStyles } from "@/src/app-styles";
import { Header } from "@/src/components/header";
import { shareReportPdf } from "@/src/pdf";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";

type Row = { created_at: string; product_id: string; product_name: string; kind: string; reference: string; delta: number; actor: string };
type Product = { id: string; name: string; stock: number; base_unit?: string; product_type?: string };
type Data = { rows: Row[]; stock_in: number; stock_out: number; movement_count: number; products: Product[] };

const KIND_LABEL: Record<string, string> = {
  sale: "Penjualan", purchase: "Pembelian",
  sale_return: "Retur Jual", purchase_return: "Retur Beli",
  adjustment: "Penyesuaian",
};

export default function StockTrackingScreen() {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [data, setData] = useState<Data | null>(null);
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Product | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      // Ambil SEMUA pergerakan (period=yearly maks + override tahunan). Untuk per-produk
      // tampilkan dari awal, kita pakai period=yearly dengan rentang super lebar via custom.
      const now = new Date();
      const start = new Date(2000, 0, 1).toISOString();
      const end = new Date(now.getFullYear() + 1, 0, 1).toISOString();
      setData(await apiRequest<Data>(`/reports/stock-tracking?period=custom&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`));
      setSettings(await apiRequest<BusinessSettings>("/settings"));
    } catch (e) { toast.error("Gagal memuat", e instanceof Error ? e.message : undefined); }
  }, [toast]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Index pergerakan per produk + total net change
  const byProduct = useMemo(() => {
    const map: Record<string, { product: Product; rows: Row[]; net: number; in: number; out: number }> = {};
    const products = data?.products ?? [];
    for (const p of products) {
      map[p.id] = { product: p as Product, rows: [], net: 0, in: 0, out: 0 };
    }
    for (const r of (data?.rows ?? [])) {
      if (!map[r.product_id]) {
        map[r.product_id] = { product: { id: r.product_id, name: r.product_name, stock: 0 } as Product, rows: [], net: 0, in: 0, out: 0 };
      }
      map[r.product_id].rows.push(r);
      map[r.product_id].net += r.delta;
      if (r.delta > 0) map[r.product_id].in += r.delta;
      else map[r.product_id].out += Math.abs(r.delta);
    }
    return Object.values(map);
  }, [data]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const base = byProduct.filter((e) => (e.product.product_type || "goods") === "goods");
    if (!term) return base.sort((a, b) => b.rows.length - a.rows.length);
    return base.filter((e) => e.product.name.toLowerCase().includes(term)).sort((a, b) => b.rows.length - a.rows.length);
  }, [byProduct, search]);

  const selectedData = selected ? byProduct.find((e) => e.product.id === selected.id) : null;

  const exportProductPdf = async () => {
    if (!selectedData) return;
    setBusy("pdf");
    try {
      await shareReportPdf({
        title: `Tracking Stok · ${selectedData.product.name}`,
        subtitle: `${selectedData.rows.length} pergerakan sejak awal pencatatan`,
        headers: ["Tanggal", "Jenis", "Referensi", "Perubahan", "Operator"],
        rows: selectedData.rows.map((r) => [
          new Date(r.created_at).toLocaleString("id-ID"),
          KIND_LABEL[r.kind] || r.kind,
          r.reference,
          (r.delta > 0 ? "+" : "") + r.delta,
          r.actor,
        ]),
        summary: [
          { label: "Total Masuk", value: `+${selectedData.in}` },
          { label: "Total Keluar", value: `-${selectedData.out}` },
          { label: "Netto", value: String(selectedData.net) },
          { label: "Stok Sekarang", value: String(selectedData.product.stock) },
        ],
      }, settings?.business_name ?? "JTPOIN POS");
      toast.success("PDF siap", "Pilih aplikasi untuk membuka/bagikan.");
    } catch (e) { toast.error("Gagal PDF", e instanceof Error ? e.message : undefined); }
    finally { setBusy(null); }
  };

  const exportProductCsv = async () => {
    if (!selectedData) return;
    setBusy("csv");
    try {
      const header = ["Tanggal", "Jenis", "Referensi", "Perubahan", "Operator"];
      const rows = selectedData.rows.map((r) => [
        new Date(r.created_at).toLocaleString("id-ID"),
        KIND_LABEL[r.kind] || r.kind,
        `"${(r.reference || "").replace(/"/g, '""')}"`,
        String(r.delta),
        `"${(r.actor || "").replace(/"/g, '""')}"`,
      ].join(","));
      const csv = [`Tracking Stok: ${selectedData.product.name}`, header.join(","), ...rows].join("\n");
      if (Platform.OS === "web") return toast.info("Export CSV", "Fitur ini jalan di aplikasi mobile.");
      const path = `${FileSystem.cacheDirectory ?? ""}tracking-${selectedData.product.name.replace(/[^a-z0-9]/gi, "_")}-${Date.now()}.csv`;
      await FileSystem.writeAsStringAsync(path, csv, { encoding: FileSystem.EncodingType.UTF8 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path, { mimeType: "text/csv", dialogTitle: `Tracking stok ${selectedData.product.name}` });
      } else { toast.success("File tersimpan", path); }
    } catch (e) { toast.error("Gagal CSV", e instanceof Error ? e.message : undefined); }
    finally { setBusy(null); }
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.between}>
          <Header title="Tracking Stok" subtitle={`${filtered.length} produk · ${data?.movement_count ?? 0} pergerakan total`} />
          <Pressable onPress={() => router.back()}><Ionicons name="chevron-back" size={26} color={colors.onSurface} /></Pressable>
        </View>

        <TextInput
          testID="stock-tracking-search"
          value={search}
          onChangeText={setSearch}
          placeholder="Cari produk..."
          placeholderTextColor={colors.muted}
          style={styles.search}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <View style={{ height: 10 }} />

        <View style={[styles.card, { flexDirection: "row", gap: 10 }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.muted}>Total Masuk</Text>
            <Text style={[styles.cardTitle, { color: colors.brandPrimary }]}>+ {data?.stock_in ?? 0}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.muted}>Total Keluar</Text>
            <Text style={[styles.cardTitle, { color: colors.error }]}>- {data?.stock_out ?? 0}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.muted}>Pergerakan</Text>
            <Text style={styles.cardTitle}>{data?.movement_count ?? 0}</Text>
          </View>
        </View>

        {filtered.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="trending-up-outline" size={44} color={colors.muted} />
            <Text style={[styles.muted, { marginTop: 10 }]}>{search ? "Tidak ada produk cocok." : "Belum ada produk / pergerakan."}</Text>
          </View>
        ) : filtered.map((e) => (
          <Pressable
            key={e.product.id}
            testID={`track-prod-${e.product.id}`}
            onPress={() => setSelected(e.product)}
            style={styles.listRow}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.productName}>{e.product.name}</Text>
              <Text style={styles.muted}>Stok sekarang: {e.product.stock} {e.product.base_unit || ""} · {e.rows.length} pergerakan</Text>
            </View>
            <View style={{ alignItems: "flex-end", marginRight: 8 }}>
              <Text style={{ color: colors.brandPrimary, fontSize: 12, fontWeight: "700" }}>+ {e.in}</Text>
              <Text style={{ color: colors.error, fontSize: 12, fontWeight: "700" }}>- {e.out}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </Pressable>
        ))}
      </ScrollView>

      {/* Modal detail histori per produk */}
      <Modal visible={!!selected} animationType="slide" onRequestClose={() => setSelected(null)}>
        <View style={[styles.screen, { paddingTop: insets.top }]}>
          <View style={[styles.between, { padding: 16 }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { fontSize: 20 }]}>{selectedData?.product.name || ""}</Text>
              <Text style={styles.muted}>{selectedData?.rows.length ?? 0} pergerakan · sekarang {selectedData?.product.stock ?? 0}</Text>
            </View>
            <Pressable testID="close-detail" onPress={() => setSelected(null)}><Ionicons name="close" size={26} color={colors.onSurface} /></Pressable>
          </View>

          <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 16, marginBottom: 10 }}>
            <View style={[styles.card, { flex: 1, padding: 10, marginBottom: 0 }]}>
              <Text style={styles.muted}>Masuk</Text>
              <Text style={[styles.cardTitle, { color: colors.brandPrimary }]}>+ {selectedData?.in ?? 0}</Text>
            </View>
            <View style={[styles.card, { flex: 1, padding: 10, marginBottom: 0 }]}>
              <Text style={styles.muted}>Keluar</Text>
              <Text style={[styles.cardTitle, { color: colors.error }]}>- {selectedData?.out ?? 0}</Text>
            </View>
            <View style={[styles.card, { flex: 1, padding: 10, marginBottom: 0 }]}>
              <Text style={styles.muted}>Netto</Text>
              <Text style={styles.cardTitle}>{selectedData?.net ?? 0}</Text>
            </View>
          </View>

          <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 16, marginBottom: 10 }}>
            <Pressable testID="exp-prod-pdf" onPress={exportProductPdf} disabled={busy === "pdf"} style={[styles.outlineButton, { flex: 1 }]}>
              {busy === "pdf" ? <ActivityIndicator /> : <Text style={styles.outlineText}>Bagikan PDF</Text>}
            </Pressable>
            <Pressable testID="exp-prod-csv" onPress={exportProductCsv} disabled={busy === "csv"} style={[styles.outlineButton, { flex: 1 }]}>
              {busy === "csv" ? <ActivityIndicator /> : <Text style={styles.outlineText}>Bagikan Excel/CSV</Text>}
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 20 }}>
            {(selectedData?.rows ?? []).length === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="document-text-outline" size={40} color={colors.muted} />
                <Text style={[styles.muted, { marginTop: 10 }]}>Belum ada histori pergerakan.</Text>
              </View>
            ) : (selectedData?.rows ?? []).map((r, idx) => (
              <View key={idx} style={styles.listRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.productName}>{KIND_LABEL[r.kind] || r.kind}</Text>
                  <Text style={styles.muted}>{new Date(r.created_at).toLocaleString("id-ID")}</Text>
                  <Text style={[styles.muted, { fontSize: 11 }]}>{r.reference}{r.actor ? ` · ${r.actor}` : ""}</Text>
                </View>
                <Text style={{ fontWeight: "800", color: r.delta > 0 ? colors.brandPrimary : colors.error, fontSize: 16 }}>
                  {r.delta > 0 ? "+" : ""}{r.delta}
                </Text>
              </View>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}
