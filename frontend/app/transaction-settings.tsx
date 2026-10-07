import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest, BusinessSettings, PriceLevel } from "@/src/api";
import { useAppStyles } from "@/src/app-styles";
import { Header } from "@/src/components/header";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";

export default function TransactionSettingsScreen() {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [s, setS] = useState<BusinessSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [newLevel, setNewLevel] = useState("");

  useEffect(() => { apiRequest<BusinessSettings>("/settings").then(setS).catch(() => undefined); }, []);

  const save = async () => {
    if (!s) return;
    setBusy(true);
    try {
      const next = await apiRequest<BusinessSettings>("/settings", { method: "PUT", body: JSON.stringify(s) });
      setS(next);
      toast.success("Pengaturan transaksi disimpan");
    } catch (e) { toast.error("Gagal", e instanceof Error ? e.message : undefined); }
    finally { setBusy(false); }
  };

  const addLevel = () => {
    if (!newLevel.trim() || !s) return;
    const id = `lvl_${Date.now()}`;
    setS({ ...s, price_levels: [...(s.price_levels ?? []), { id, name: newLevel.trim() }] });
    setNewLevel("");
  };
  const removeLevel = (id: string) => {
    if (!s) return;
    if (id === "default") return toast.error("Level default tidak bisa dihapus");
    setS({ ...s, price_levels: (s.price_levels ?? []).filter((l) => l.id !== id) });
  };

  if (!s) return <View style={[styles.screen, { alignItems: "center", justifyContent: "center" }]}><ActivityIndicator color={colors.brandPrimary} /></View>;
  const levels: PriceLevel[] = s.price_levels ?? [{ id: "default", name: "Harga Jual" }];

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.between}>
          <Header title="Pengaturan transaksi" subtitle="Kebijakan default kasir & checkout" />
          <Pressable onPress={() => router.back()}><Ionicons name="chevron-back" size={26} color={colors.onSurface} /></Pressable>
        </View>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Perilaku kasir</Text>
          <ToggleRow label="Perbolehkan kasir mengubah harga manual di keranjang" value={!!s.allow_price_edit} onChange={(v) => setS({ ...s, allow_price_edit: v })} />
          <ToggleRow label="Perbolehkan cetak struk sebelum selesaikan transaksi" value={!!s.allow_preview_print} onChange={(v) => setS({ ...s, allow_preview_print: v })} />
          <ToggleRow label="Konfirmasi sebelum batal transaksi" value={!!s.confirm_cancel} onChange={(v) => setS({ ...s, confirm_cancel: v })} />
          <ToggleRow label="Park otomatis saat tombol batal (bukan hapus)" value={!!s.auto_park_on_cancel} onChange={(v) => setS({ ...s, auto_park_on_cancel: v })} />
        </View>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Pajak & ongkir default</Text>
          <Text style={styles.inputLabel}>Label pajak</Text>
          <TextInput value={s.tax_label ?? "Pajak"} onChangeText={(t) => setS({ ...s, tax_label: t })} style={styles.input} placeholderTextColor={colors.muted} />
          <Text style={styles.inputLabel}>Pajak default (%)</Text>
          <TextInput testID="default-tax" keyboardType="decimal-pad" value={String(s.tax_percent ?? 0)} onChangeText={(t) => setS({ ...s, tax_percent: Number(t.replace(/[^0-9.]/g, "")) || 0 })} style={styles.input} placeholderTextColor={colors.muted} />
          <Text style={styles.inputLabel}>Ongkir default</Text>
          <TextInput testID="default-shipping" keyboardType="number-pad" value={String(s.shipping_default ?? 0)} onChangeText={(t) => setS({ ...s, shipping_default: Number(t.replace(/\D/g, "")) || 0 })} style={styles.input} placeholderTextColor={colors.muted} />
        </View>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Level harga</Text>
          <Text style={[styles.muted, { marginBottom: 8 }]}>Setiap pelanggan dapat memiliki level harga default (mis. Retail, Grosir, Member).</Text>
          {levels.map((lvl) => (
            <View key={lvl.id} style={styles.listRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.productName}>{lvl.name}</Text>
                <Text style={styles.muted}>{lvl.id}</Text>
              </View>
              {lvl.id !== "default" ? <Pressable onPress={() => removeLevel(lvl.id)}><Ionicons name="trash-outline" size={20} color={colors.error} /></Pressable> : <Text style={styles.muted}>default</Text>}
            </View>
          ))}
          <View style={[styles.row, { marginTop: 8, gap: 10 }]}>
            <TextInput testID="new-level" value={newLevel} onChangeText={setNewLevel} placeholder="Nama level baru (mis: Grosir)" placeholderTextColor={colors.muted} style={[styles.input, { flex: 1, marginBottom: 0 }]} />
            <Pressable testID="add-level" onPress={addLevel} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>+</Text>
            </Pressable>
          </View>
        </View>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Hardware kasir</Text>
          <ToggleRow label="Aktifkan cash drawer (ESC/POS)" value={!!s.cashdrawer_enabled} onChange={(v) => setS({ ...s, cashdrawer_enabled: v })} />
          <ToggleRow label="Multi-printer (cetak ke beberapa printer)" value={!!s.multi_printer} onChange={(v) => setS({ ...s, multi_printer: v })} />
          <Text style={[styles.muted, { marginTop: 8 }]}>Catatan: cash drawer & multi-printer aktif pada build Android produksi.</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Printer dapur (kitchen)</Text>
          <Text style={[styles.muted, { marginBottom: 10 }]}>Kapan nota dapur dicetak? (hanya untuk item ber-tag dapur)</Text>
          {([
            { key: "after", label: "Cetak setelah transaksi selesai", detail: "Default. Nota dapur dicetak otomatis setelah pelanggan membayar." },
            { key: "with_preview", label: "Cetak berbarengan preview struk", detail: "Nota dapur ikut tercetak saat kasir tekan \"Cetak struk sekarang\" sebelum menyelesaikan transaksi." },
          ] as const).map((opt) => {
            const selected = (s.kitchen_print_timing || "after") === opt.key;
            return (
              <Pressable
                key={opt.key}
                testID={`kitchen-timing-${opt.key}`}
                onPress={() => setS({ ...s, kitchen_print_timing: opt.key })}
                style={[styles.listRow, selected && { backgroundColor: colors.brandTertiary, borderRadius: 10 }]}
              >
                <Ionicons name={selected ? "radio-button-on" : "radio-button-off"} size={22} color={colors.brandPrimary} style={{ marginRight: 10 }} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.productName}>{opt.label}</Text>
                  <Text style={styles.muted}>{opt.detail}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
        <Pressable testID="save-tx-settings" disabled={busy} onPress={save} style={[styles.primaryButton, busy && { opacity: 0.5 }]}>
          {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryButtonText}>Simpan pengaturan</Text>}
        </Pressable>
      </ScrollView>
    </View>
  );
}

function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  const styles = useAppStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.listRow}>
      <View style={{ flex: 1 }}><Text style={styles.productName}>{label}</Text></View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.brandPrimary, false: colors.borderStrong }} thumbColor={colors.onBrandPrimary} />
    </View>
  );
}
