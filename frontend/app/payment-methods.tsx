import Ionicons from "@expo/vector-icons/Ionicons";
import * as ImagePicker from "expo-image-picker";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Image, Modal, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest, PAYMENT_KIND_LABELS, PaymentKind, PaymentMethodDoc } from "@/src/api";
import { useAppStyles } from "@/src/app-styles";
import { Header } from "@/src/components/header";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";

export default function PaymentMethodsScreen() {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [list, setList] = useState<PaymentMethodDoc[]>([]);
  const [editing, setEditing] = useState<PaymentMethodDoc | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try { setList(await apiRequest<PaymentMethodDoc[]>("/payment-methods")); }
    catch (e) { toast.error("Gagal memuat", e instanceof Error ? e.message : undefined); }
  }, [toast]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const askDelete = (m: PaymentMethodDoc) => {
    Alert.alert("Hapus metode?", m.name, [
      { text: "Batal", style: "cancel" },
      { text: "Hapus", style: "destructive", onPress: async () => {
        try { await apiRequest(`/payment-methods/${m.id}`, { method: "DELETE" }); toast.success("Metode dihapus"); await load(); }
        catch (e) { toast.error("Gagal", e instanceof Error ? e.message : undefined); }
      } },
    ]);
  };

  const toggle = async (m: PaymentMethodDoc, enabled: boolean) => {
    try { await apiRequest(`/payment-methods/${m.id}`, { method: "PUT", body: JSON.stringify({ ...m, enabled }) }); await load(); }
    catch (e) { toast.error("Gagal", e instanceof Error ? e.message : undefined); }
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.between}>
          <Header title="Metode pembayaran" subtitle="Tunai, Kredit, QRIS statis, dan kustom" />
          <Pressable onPress={() => router.back()}><Ionicons name="chevron-back" size={26} color={colors.onSurface} /></Pressable>
        </View>
        {list.map((m) => (
          <View key={m.id} style={styles.card}>
            <View style={styles.between}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{m.name}</Text>
                <Text style={styles.muted}>{PAYMENT_KIND_LABELS[m.kind]}{m.kind === "qris_static" ? (m.qris_image_base64 ? " · gambar tersimpan" : " · belum ada gambar") : ""}</Text>
              </View>
              <Switch testID={`enable-${m.id}`} value={m.enabled} onValueChange={(v) => toggle(m, v)} trackColor={{ true: colors.brandPrimary, false: colors.borderStrong }} thumbColor={colors.onBrandPrimary} />
            </View>
            {m.kind === "qris_static" && m.qris_image_base64 ? (
              <Image source={{ uri: `data:image/png;base64,${m.qris_image_base64}` }} style={{ width: 120, height: 120, borderRadius: 10, marginTop: 10 }} />
            ) : null}
            <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
              <Pressable testID={`edit-pm-${m.id}`} onPress={() => { setEditing(m); setOpen(true); }} style={[styles.outlineButton, { flex: 1 }]}>
                <Text style={styles.outlineText}>Edit</Text>
              </Pressable>
              <Pressable testID={`del-pm-${m.id}`} onPress={() => askDelete(m)} style={[styles.dangerButton, { flex: 1 }]}>
                <Text style={styles.dangerText}>Hapus</Text>
              </Pressable>
            </View>
          </View>
        ))}
        <Pressable testID="add-pm" onPress={() => { setEditing(null); setOpen(true); }} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>+ Tambah metode baru</Text>
        </Pressable>
      </ScrollView>
      <PmForm visible={open} initial={editing} onClose={() => setOpen(false)} onSaved={async () => { setOpen(false); await load(); }} />
    </View>
  );
}

function PmForm({ visible, initial, onClose, onSaved }: { visible: boolean; initial: PaymentMethodDoc | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const toast = useToast();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<PaymentKind>("custom");
  const [image, setImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Sync when sheet opens / initial changes
  useEffect(() => {
    if (visible) {
      setName(initial?.name ?? "");
      setKind(initial?.kind ?? "custom");
      setImage(initial?.qris_image_base64 ?? null);
    }
  }, [visible, initial]);

  const pickImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return toast.error("Izin galeri ditolak");
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7, base64: true });
    if (!result.canceled) setImage(result.assets[0].base64 ?? null);
  };

  const save = async () => {
    if (!name.trim()) return toast.error("Nama wajib");
    setBusy(true);
    try {
      const body = JSON.stringify({ name: name.trim(), kind, qris_image_base64: kind === "qris_static" ? image : null, enabled: true, sort_order: 100 });
      if (initial) await apiRequest(`/payment-methods/${initial.id}`, { method: "PUT", body });
      else await apiRequest("/payment-methods", { method: "POST", body });
      toast.success("Metode disimpan");
      setName(""); setKind("custom"); setImage(null);
      await onSaved();
    } catch (e) { toast.error("Gagal", e instanceof Error ? e.message : undefined); }
    finally { setBusy(false); }
  };

  const reset = () => { setName(""); setKind("custom"); setImage(null); };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => { reset(); onClose(); }}>
      <View style={{ flex: 1, backgroundColor: "rgba(28,28,30,0.55)", justifyContent: "flex-end" }}>
        <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: "90%" }}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <View style={styles.between}>
              <Text style={[styles.title, { fontSize: 22 }]}>{initial ? "Edit metode" : "Metode baru"}</Text>
              <Pressable onPress={() => { reset(); onClose(); }}><Ionicons name="close" size={24} color={colors.onSurface} /></Pressable>
            </View>
            <Text style={styles.inputLabel}>Nama</Text>
            <TextInput testID="pm-name" value={name} onChangeText={setName} style={styles.input} placeholder="Contoh: Transfer BCA" placeholderTextColor={colors.muted} />
            <Text style={styles.inputLabel}>Jenis</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
              {(["cash", "credit", "qris_static", "custom"] as PaymentKind[]).map((k) => (
                <Pressable key={k} onPress={() => setKind(k)} style={[{ paddingHorizontal: 14, minHeight: 42, borderRadius: 12, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" }, kind === k && { backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandPrimary }]}>
                  <Text style={{ color: colors.onSurfaceTertiary, fontWeight: "800", fontSize: 12 }}>{PAYMENT_KIND_LABELS[k]}</Text>
                </Pressable>
              ))}
            </View>
            {kind === "qris_static" ? (
              <>
                <Text style={styles.inputLabel}>Gambar QRIS statis</Text>
                <Pressable testID="pm-image" onPress={pickImage} style={{ height: 180, borderRadius: 14, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center", overflow: "hidden", marginBottom: 12 }}>
                  {image ? <Image source={{ uri: `data:image/png;base64,${image}` }} style={{ width: "100%", height: "100%", resizeMode: "contain" }} /> : (
                    <>
                      <Ionicons name="qr-code-outline" size={36} color={colors.brandPrimary} />
                      <Text style={[styles.muted, { marginTop: 8 }]}>Upload gambar QR</Text>
                    </>
                  )}
                </Pressable>
              </>
            ) : null}
            <Pressable testID="save-pm" disabled={busy} onPress={save} style={[styles.primaryButton, busy && { opacity: 0.5 }]}>
              <Text style={styles.primaryButtonText}>Simpan</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
