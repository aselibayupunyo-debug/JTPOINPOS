import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import * as Linking from "expo-linking";
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Share, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest, BusinessSettings, Contact, formatRupiah, ParkedTransaction } from "@/src/api";
import { useAppStyles } from "@/src/app-styles";
import { Header } from "@/src/components/header";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";

export default function ParkedScreen() {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [list, setList] = useState<ParkedTransaction[]>([]);
  const [query, setQuery] = useState("");
  const [confirmCancel, setConfirmCancel] = useState<ParkedTransaction | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [customers, setCustomers] = useState<Contact[]>([]);
  const [shareTarget, setShareTarget] = useState<null | { parked: ParkedTransaction; channel: "wa" | "email" }>(null);
  const [destination, setDestination] = useState("");

  const load = useCallback(async () => {
    try {
      setList(await apiRequest<ParkedTransaction[]>("/parked"));
      apiRequest<BusinessSettings>("/settings").then(setSettings).catch(() => undefined);
      apiRequest<Contact[]>("/customers").then(setCustomers).catch(() => undefined);
    }
    catch (e) { toast.error("Gagal memuat", e instanceof Error ? e.message : undefined); }
  }, [toast]);

  const buildText = (p: ParkedTransaction) => {
    const subtotal = p.items.reduce((s, i) => s + i.price * i.quantity - (i.discount || 0), 0);
    const lines: string[] = [];
    lines.push(`*${settings?.business_name ?? "JTPOIN POS"}*`);
    if (settings?.address) lines.push(settings.address);
    if (settings?.phone) lines.push(`Telp: ${settings.phone}`);
    lines.push("", "*STRUK ANTRIAN (BELUM DIBAYAR)*");
    lines.push(`Pelanggan: ${p.customer_name}`);
    lines.push(`${p.label} · ${new Date(p.created_at).toLocaleString("id-ID")}`);
    lines.push("─────────────────────");
    p.items.forEach((i) => {
      const t = (i as { technician_name?: string }).technician_name;
      lines.push(`${i.name}${i.unit ? ` (${i.unit})` : ""}${t ? ` · ${t}` : ""}`);
      lines.push(`  ${i.quantity} x ${formatRupiah(i.price)}   ${formatRupiah(i.price * i.quantity)}`);
      if (i.discount) lines.push(`  Diskon: -${formatRupiah(i.discount)}`);
    });
    lines.push("─────────────────────");
    lines.push(`TOTAL        ${formatRupiah(subtotal)}`);
    if (p.note) lines.push(`Catatan: ${p.note}`);
    if (settings?.footer_note) lines.push("", settings.footer_note);
    return lines.join("\n");
  };

  const openShare = (p: ParkedTransaction, channel: "wa" | "email") => {
    const c = customers.find((x) => x.id === p.customer_id) ?? customers.find((x) => x.name === p.customer_name);
    setDestination(channel === "wa" ? (c?.phone ?? "") : "");
    setShareTarget({ parked: p, channel });
  };

  const doShare = async () => {
    if (!shareTarget) return;
    const text = buildText(shareTarget.parked);
    try {
      if (shareTarget.channel === "wa") {
        let phone = destination.replace(/\D/g, "");
        if (phone.startsWith("0")) phone = `62${phone.slice(1)}`;
        const encoded = encodeURIComponent(text);
        const url = phone ? `whatsapp://send?phone=${phone}&text=${encoded}` : `whatsapp://send?text=${encoded}`;
        if (await Linking.canOpenURL(url)) await Linking.openURL(url);
        else if (phone) await Linking.openURL(`https://wa.me/${phone}?text=${encoded}`);
        else await Share.share({ message: text });
      } else {
        const to = destination.trim();
        if (to && !/^\S+@\S+\.\S+$/.test(to)) return toast.error("Email tidak valid");
        await Linking.openURL(`mailto:${to}?subject=${encodeURIComponent(`Struk antrian ${shareTarget.parked.customer_name}`)}&body=${encodeURIComponent(text)}`);
      }
      setShareTarget(null);
    } catch (e) { toast.error("Gagal mengirim", e instanceof Error ? e.message : undefined); }
  };
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((p) => {
      const name = (p.customer_name ?? "").toLowerCase();
      const label = (p.label ?? "").toLowerCase();
      const itemsText = (p.items ?? []).map((i) => (i.name ?? "").toLowerCase()).join(" ");
      return name.includes(q) || label.includes(q) || itemsText.includes(q);
    });
  }, [list, query]);

  const doCancel = async () => {
    if (!confirmCancel) return;
    const target = confirmCancel;
    setBusyId(target.id);
    try {
      await apiRequest(`/parked/${target.id}`, { method: "DELETE" });
      toast.info("Antrian dibatalkan", target.customer_name);
      setConfirmCancel(null);
      await load();
    } catch (e) {
      // Idempotent: if already deleted, treat as success
      const msg = e instanceof Error ? e.message : "";
      if (/not found|tidak ditemukan|404/i.test(msg)) {
        toast.info("Antrian sudah terhapus", target.customer_name);
        setConfirmCancel(null);
        await load();
      } else {
        toast.error("Gagal batalkan", msg);
      }
    } finally { setBusyId(null); }
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.between}>
          <Header title="Antrian transaksi" subtitle={`${filtered.length}${query ? ` / ${list.length}` : ""} transaksi diparkir`} />
          <Pressable onPress={() => router.back()}><Ionicons name="chevron-back" size={26} color={colors.onSurface} /></Pressable>
        </View>
        {/* Search box */}
        <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: colors.surfaceTertiary, borderRadius: 12, paddingHorizontal: 12, marginBottom: 10, minHeight: 44 }}>
          <Ionicons name="search-outline" size={18} color={colors.muted} />
          <TextInput
            testID="parked-search"
            value={query}
            onChangeText={setQuery}
            placeholder="Cari nama pelanggan, label antrian, atau produk…"
            placeholderTextColor={colors.muted}
            style={{ flex: 1, marginLeft: 8, color: colors.onSurface, fontSize: 14, paddingVertical: 8 }}
            autoCapitalize="none"
            returnKeyType="search"
          />
          {query ? (
            <Pressable testID="parked-search-clear" onPress={() => setQuery("")} style={{ padding: 4 }}>
              <Ionicons name="close-circle" size={18} color={colors.muted} />
            </Pressable>
          ) : null}
        </View>
        <Text style={[styles.muted, { marginBottom: 10 }]}>Antrian akan hilang hanya bila dilanjutkan hingga selesai atau dibatalkan.</Text>
        {filtered.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name={query ? "search-outline" : "layers-outline"} size={44} color={colors.muted} />
            <Text style={[styles.muted, { marginTop: 10 }]}>{query ? `Tidak ada antrian yang cocok dengan "${query}".` : "Belum ada antrian. Tekan tombol Park di kasir untuk menyimpan sementara."}</Text>
          </View>
        ) : filtered.map((p) => (
          <View key={p.id} style={styles.card}>
            <View style={styles.between}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{p.customer_name}</Text>
                <Text style={styles.muted}>{p.label} · {new Date(p.created_at).toLocaleString("id-ID")}</Text>
                <Text style={[styles.muted, { marginTop: 4 }]}>{p.items.length} item · total {formatRupiah(p.items.reduce((s, i) => s + i.price * i.quantity, 0))}</Text>
              </View>
            </View>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
              <Pressable testID={`resume-${p.id}`} onPress={() => router.replace({ pathname: "/(tabs)", params: { parked: p.id } })} style={[styles.primaryButton, { flex: 1 }]}>
                <Text style={styles.primaryButtonText}>Lanjutkan transaksi</Text>
              </Pressable>
              <Pressable
                testID={`cancel-parked-${p.id}`}
                onPress={() => setConfirmCancel(p)}
                disabled={busyId === p.id}
                style={[styles.dangerButton, { flex: 1 }, busyId === p.id && { opacity: 0.5 }]}
              >
                {busyId === p.id ? <ActivityIndicator color={colors.onError ?? "#fff"} /> : <Text style={styles.dangerText}>Batalkan</Text>}
              </Pressable>
            </View>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
              <Pressable testID={`share-wa-${p.id}`} onPress={() => openShare(p, "wa")} style={[styles.outlineButton, { flex: 1, flexDirection: "row", gap: 6 }]}>
                <Ionicons name="logo-whatsapp" size={18} color={colors.success} />
                <Text style={styles.outlineText}>WhatsApp</Text>
              </Pressable>
              <Pressable testID={`share-email-${p.id}`} onPress={() => openShare(p, "email")} style={[styles.outlineButton, { flex: 1, flexDirection: "row", gap: 6 }]}>
                <Ionicons name="mail-outline" size={18} color={colors.info} />
                <Text style={styles.outlineText}>Email</Text>
              </Pressable>
            </View>
          </View>
        ))}
      </ScrollView>

      <Modal visible={!!shareTarget} transparent animationType="fade" onRequestClose={() => setShareTarget(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1, backgroundColor: "rgba(28,28,30,0.55)", justifyContent: "center", padding: 24 }}>
          <View style={{ backgroundColor: colors.surface, borderRadius: 20, padding: 20 }}>
            <Text style={styles.cardTitle}>Kirim struk via {shareTarget?.channel === "wa" ? "WhatsApp" : "Email"}</Text>
            <Text style={[styles.muted, { marginTop: 6, marginBottom: 12 }]}>
              {shareTarget?.parked.customer_name} · {shareTarget ? formatRupiah(shareTarget.parked.items.reduce((s, i) => s + i.price * i.quantity - (i.discount || 0), 0)) : ""}
            </Text>
            <Text style={styles.inputLabel}>{shareTarget?.channel === "wa" ? "No. WhatsApp (opsional)" : "Alamat email (opsional)"}</Text>
            <TextInput
              testID="share-destination-input"
              value={destination}
              onChangeText={setDestination}
              placeholder={shareTarget?.channel === "wa" ? "08xxxxxxxxxx" : "pelanggan@email.com"}
              placeholderTextColor={colors.muted}
              keyboardType={shareTarget?.channel === "wa" ? "phone-pad" : "email-address"}
              autoCapitalize="none"
              style={styles.input}
            />
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable onPress={() => setShareTarget(null)} style={[styles.outlineButton, { flex: 1 }]}>
                <Text style={styles.outlineText}>Batal</Text>
              </Pressable>
              <Pressable testID="confirm-share" onPress={doShare} style={[styles.primaryButton, { flex: 1 }]}>
                <Text style={styles.primaryButtonText}>Kirim</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={!!confirmCancel} transparent animationType="fade" onRequestClose={() => setConfirmCancel(null)}>
        <View style={{ flex: 1, backgroundColor: "rgba(28,28,30,0.55)", justifyContent: "center", padding: 24 }}>
          <View style={{ backgroundColor: colors.surface, borderRadius: 20, padding: 20 }}>
            <Text style={styles.cardTitle}>Batalkan antrian?</Text>
            <Text style={[styles.muted, { marginTop: 6, marginBottom: 14 }]}>
              Antrian atas nama {confirmCancel?.customer_name} akan dihapus permanen. Stok produk tidak terpengaruh karena belum dijual.
            </Text>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable onPress={() => setConfirmCancel(null)} disabled={!!busyId} style={[styles.outlineButton, { flex: 1 }]}>
                <Text style={styles.outlineText}>Tidak</Text>
              </Pressable>
              <Pressable
                testID="confirm-cancel-parked"
                onPress={doCancel}
                disabled={!!busyId}
                style={[styles.dangerButton, { flex: 1 }, !!busyId && { opacity: 0.6 }]}
              >
                {busyId ? <ActivityIndicator color={colors.onError ?? "#fff"} /> : <Text style={styles.dangerText}>Ya, batalkan</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
