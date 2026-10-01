import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest, BusinessSettings, Contact, formatRupiah } from "@/src/api";
import { useAppStyles } from "@/src/app-styles";
import { Header } from "@/src/components/header";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";

export function ContactListScreen({ kind }: { kind: "customers" | "suppliers" }) {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [list, setList] = useState<Contact[]>([]);
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const label = kind === "customers" ? "Pelanggan" : "Supplier";

  const load = useCallback(async () => {
    try { setList(await apiRequest<Contact[]>(`/${kind}?search=${encodeURIComponent(search)}`)); }
    catch (e) { toast.error("Gagal memuat", e instanceof Error ? e.message : undefined); }
  }, [kind, search, toast]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const askDelete = (c: Contact) => {
    Alert.alert(`Hapus ${label.toLowerCase()}?`, c.name, [
      { text: "Batal", style: "cancel" },
      { text: "Hapus", style: "destructive", onPress: async () => {
        try { await apiRequest(`/${kind}/${c.id}`, { method: "DELETE" }); toast.success(`${label} dihapus`); await load(); }
        catch (e) { toast.error("Gagal", e instanceof Error ? e.message : undefined); }
      } },
    ]);
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={colors.brandPrimary} />}
      >
        <View style={styles.between}>
          <Header title={label} subtitle={`${list.length} ${label.toLowerCase()} terdaftar`} />
          <Pressable onPress={() => router.back()}><Ionicons name="chevron-back" size={26} color={colors.onSurface} /></Pressable>
        </View>
        <View style={styles.row}>
          <TextInput testID={`${kind}-search`} value={search} onChangeText={setSearch} placeholder={`Cari ${label.toLowerCase()}`} placeholderTextColor={colors.muted} style={styles.search} />
          <Pressable testID={`add-${kind}`} onPress={() => router.push({ pathname: "/contact-form", params: { kind } })} style={styles.iconButton}>
            <Ionicons name="add" size={24} color={colors.brandPrimary} />
          </Pressable>
        </View>
        {list.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="people-outline" size={44} color={colors.muted} />
            <Text style={[styles.muted, { marginTop: 10 }]}>Belum ada {label.toLowerCase()}.</Text>
          </View>
        ) : list.map((c) => (
          <Pressable
            key={c.id}
            testID={`${kind}-item-${c.id}`}
            onPress={() => router.push({ pathname: "/contact-form", params: { kind, id: c.id } })}
            onLongPress={() => askDelete(c)}
            style={styles.card}
          >
            <View style={styles.between}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{c.name}</Text>
                <Text style={styles.muted}>{c.phone || "Tanpa nomor"}</Text>
                {c.address ? <Text style={[styles.muted, { marginTop: 2 }]}>{c.address}</Text> : null}
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={[styles.productName, { color: colors.brandPrimary }]}>{formatRupiah(c.total_spent ?? 0)}</Text>
                <Text style={styles.muted}>{c.transaction_count ?? 0} transaksi</Text>
                {(c.outstanding ?? 0) > 0 ? <Text style={{ color: colors.warning, fontSize: 12, marginTop: 3, fontWeight: "800" }}>{kind === "customers" ? "Piutang" : "Hutang"} {formatRupiah(c.outstanding ?? 0)}</Text> : null}
              </View>
            </View>
          </Pressable>
        ))}
      </ScrollView>
      <Pressable testID={`fab-${kind}`} onPress={() => router.push({ pathname: "/contact-form", params: { kind } })} style={[styles.fab, { bottom: insets.bottom + 24 }]}>
        <Ionicons name="person-add" size={26} color={colors.onBrandPrimary} />
      </Pressable>
    </View>
  );
}

export function ContactFormScreen() {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { kind, id } = useLocalSearchParams<{ kind: "customers" | "suppliers"; id?: string }>();
  const label = kind === "customers" ? "Pelanggan" : "Supplier";
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [note, setNote] = useState("");
  const [priceLevelId, setPriceLevelId] = useState<string>("default");
  const [priceLevels, setPriceLevels] = useState<{ id: string; name: string }[]>([{ id: "default", name: "Harga Jual" }]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiRequest<BusinessSettings>("/settings").then((s) => {
      if (s.price_levels && s.price_levels.length) setPriceLevels(s.price_levels);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!id || !kind) return;
    apiRequest<Contact[]>(`/${kind}`).then((list) => {
      const match = list.find((c) => c.id === id);
      if (match) {
        setName(match.name); setPhone(match.phone); setAddress(match.address); setNote(match.note);
        setPriceLevelId(match.price_level_id ?? "default");
      }
    }).catch(() => undefined);
  }, [id, kind]);

  const save = async () => {
    if (!name.trim()) return toast.error("Nama wajib diisi");
    setBusy(true);
    try {
      const body = JSON.stringify({ name: name.trim(), phone: phone.trim(), address: address.trim(), note, price_level_id: priceLevelId });
      if (id) await apiRequest(`/${kind}/${id}`, { method: "PUT", body });
      else await apiRequest(`/${kind}`, { method: "POST", body });
      toast.success(id ? `${label} diperbarui` : `${label} ditambahkan`);
      router.back();
    } catch (e) { toast.error("Gagal menyimpan", e instanceof Error ? e.message : undefined); }
    finally { setBusy(false); }
  };

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 10 }]} keyboardShouldPersistTaps="handled">
        <View style={styles.between}>
          <Text style={[styles.title, { fontSize: 24 }]}>{id ? `Edit ${label}` : `${label} baru`}</Text>
          <Pressable onPress={() => router.back()}><Ionicons name="close" size={26} color={colors.onSurface} /></Pressable>
        </View>
        <Text style={styles.inputLabel}>Nama</Text>
        <TextInput testID="contact-name" value={name} onChangeText={setName} style={styles.input} placeholder={`Nama ${label.toLowerCase()}`} placeholderTextColor={colors.muted} />
        <Text style={styles.inputLabel}>Nomor telepon / WhatsApp</Text>
        <TextInput testID="contact-phone" keyboardType="phone-pad" value={phone} onChangeText={setPhone} style={styles.input} placeholder="62812…" placeholderTextColor={colors.muted} />
        <Text style={styles.inputLabel}>Alamat</Text>
        <TextInput value={address} onChangeText={setAddress} style={[styles.input, { minHeight: 70 }]} placeholder="Opsional" placeholderTextColor={colors.muted} multiline />
        {kind === "customers" ? (
          <>
            <Text style={styles.inputLabel}>Level Harga</Text>
            <Text style={[styles.muted, { marginBottom: 8 }]}>Level harga ini akan otomatis dipakai saat pelanggan dipilih di Kasir.</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
              {priceLevels.map((lvl) => (
                <Pressable
                  key={lvl.id}
                  testID={`contact-level-${lvl.id}`}
                  onPress={() => setPriceLevelId(lvl.id)}
                  style={[{ paddingHorizontal: 14, minHeight: 40, borderRadius: 10, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" }, priceLevelId === lvl.id && { backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandPrimary }]}
                >
                  <Text style={{ color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "800" }}>{lvl.name}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}
        <Text style={styles.inputLabel}>Catatan</Text>
        <TextInput value={note} onChangeText={setNote} style={[styles.input, { minHeight: 70 }]} placeholder="Opsional" placeholderTextColor={colors.muted} multiline />
        <Pressable testID="save-contact" disabled={busy} onPress={save} style={[styles.primaryButton, busy && { opacity: 0.5 }]}>
          <Text style={styles.primaryButtonText}>{id ? "Simpan perubahan" : `Simpan ${label.toLowerCase()}`}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}
