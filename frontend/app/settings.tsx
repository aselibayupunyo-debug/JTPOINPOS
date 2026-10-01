import Ionicons from "@expo/vector-icons/Ionicons";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest, BusinessSettings } from "@/src/api";
import { useAppStyles } from "@/src/app-styles";
import { Header } from "@/src/components/header";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";

export default function SettingsScreen() {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { apiRequest<BusinessSettings>("/settings").then(setSettings).catch(() => undefined); }, []);

  const pickLogo = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return toast.error("Izin galeri ditolak");
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.6, base64: true, aspect: [1, 1] });
    if (!result.canceled) setSettings((s) => s ? { ...s, logo_base64: result.assets[0].base64 ?? null } : s);
  };

  const save = async () => {
    if (!settings) return;
    setBusy(true);
    try {
      const next = await apiRequest<BusinessSettings>("/settings", { method: "PUT", body: JSON.stringify(settings) });
      setSettings(next);
      toast.success("Pengaturan tersimpan");
    } catch (e) { toast.error("Gagal menyimpan", e instanceof Error ? e.message : undefined); }
    finally { setBusy(false); }
  };

  if (!settings) {
    return <View style={[styles.screen, { paddingTop: insets.top, alignItems: "center", justifyContent: "center" }]}><ActivityIndicator color={colors.brandPrimary} /></View>;
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 10 }]} keyboardShouldPersistTaps="handled">
        <View style={styles.between}>
          <Header title="Pengaturan toko" subtitle="Logo, struk, printer, WhatsApp" />
          <Pressable onPress={() => router.back()}><Ionicons name="chevron-back" size={26} color={colors.onSurface} /></Pressable>
        </View>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Identitas toko</Text>
          <Pressable testID="logo-picker" onPress={pickLogo} style={{ height: 110, width: 110, borderRadius: 20, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center", overflow: "hidden", marginVertical: 14 }}>
            {settings.logo_base64 ? <Image source={{ uri: `data:image/jpeg;base64,${settings.logo_base64}` }} style={{ width: "100%", height: "100%" }} /> : (
              <>
                <Ionicons name="image-outline" size={28} color={colors.brandPrimary} />
                <Text style={[styles.muted, { marginTop: 4 }]}>Logo</Text>
              </>
            )}
          </Pressable>
          <Text style={styles.inputLabel}>Nama bisnis</Text>
          <TextInput testID="set-business-name" value={settings.business_name} onChangeText={(t) => setSettings((s) => s ? { ...s, business_name: t } : s)} style={styles.input} placeholderTextColor={colors.muted} />
          <Text style={styles.inputLabel}>Alamat</Text>
          <TextInput value={settings.address} onChangeText={(t) => setSettings((s) => s ? { ...s, address: t } : s)} style={styles.input} placeholder="Opsional" placeholderTextColor={colors.muted} />
          <Text style={styles.inputLabel}>No. telepon</Text>
          <TextInput keyboardType="phone-pad" value={settings.phone} onChangeText={(t) => setSettings((s) => s ? { ...s, phone: t } : s)} style={styles.input} placeholderTextColor={colors.muted} />
          <Text style={styles.inputLabel}>Nomor WhatsApp pengirim</Text>
          <TextInput testID="set-whatsapp" keyboardType="phone-pad" value={settings.whatsapp_number ?? ""} onChangeText={(t) => setSettings((s) => s ? { ...s, whatsapp_number: t } : s)} style={styles.input} placeholder="62812…" placeholderTextColor={colors.muted} />
        </View>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Struk thermal</Text>
          <Text style={[styles.muted, { marginBottom: 10 }]}>Pilih lebar kertas default.</Text>
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 10 }}>
            {(["58mm", "80mm"] as const).map((w) => (
              <Pressable key={w} testID={`width-${w}`} onPress={() => setSettings((s) => s ? { ...s, receipt_width: w } : s)} style={[{ flex: 1, minHeight: 44, borderRadius: 12, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" }, settings.receipt_width === w && { backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandPrimary }]}>
                <Text style={{ color: colors.onSurfaceTertiary, fontSize: 13, fontWeight: "800" }}>{w}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.inputLabel}>Catatan kaki struk</Text>
          <TextInput value={settings.footer_note} onChangeText={(t) => setSettings((s) => s ? { ...s, footer_note: t } : s)} style={styles.input} placeholder="Terima kasih atas kunjungan Anda" placeholderTextColor={colors.muted} />
          <View style={{ padding: 12, backgroundColor: colors.surfaceTertiary, borderRadius: 12 }}>
            <Text style={styles.productName}>Printer Bluetooth</Text>
            <Text style={[styles.muted, { marginTop: 4 }]}>Dukungan ESC/POS 58mm & 80mm, logo, dan multi-printer dapur aktif pada build Android produksi. Deploy aplikasi lewat tombol Publish untuk mengaktifkan.</Text>
          </View>
        </View>
        <Pressable testID="save-settings" disabled={busy} onPress={save} style={[styles.primaryButton, busy && { opacity: 0.5 }]}>
          {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryButtonText}>Simpan pengaturan</Text>}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
