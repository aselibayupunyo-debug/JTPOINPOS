import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest, Technician } from "@/src/api";
import { useAppStyles } from "@/src/app-styles";
import { Header } from "@/src/components/header";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";

export default function TechniciansScreen() {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [list, setList] = useState<Technician[]>([]);
  const [editing, setEditing] = useState<Technician | null>(null);
  const [name, setName] = useState("");
  const [position, setPosition] = useState("");

  const load = useCallback(async () => {
    try { setList(await apiRequest<Technician[]>("/technicians")); }
    catch (e) { toast.error("Gagal memuat", e instanceof Error ? e.message : undefined); }
  }, [toast]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const reset = () => { setEditing(null); setName(""); setPosition(""); };

  const save = async () => {
    if (!name.trim()) return toast.error("Nama wajib diisi");
    const body = JSON.stringify({ name: name.trim(), position: position.trim() });
    try {
      if (editing) await apiRequest(`/technicians/${editing.id}`, { method: "PUT", body });
      else await apiRequest("/technicians", { method: "POST", body });
      toast.success(editing ? "Karyawan diperbarui" : "Karyawan ditambahkan");
      reset();
      await load();
    } catch (e) { toast.error("Gagal", e instanceof Error ? e.message : undefined); }
  };

  const askDelete = (t: Technician) => {
    Alert.alert("Hapus karyawan teknis?", t.name, [
      { text: "Batal", style: "cancel" },
      { text: "Hapus", style: "destructive", onPress: async () => {
        try { await apiRequest(`/technicians/${t.id}`, { method: "DELETE" }); toast.success("Karyawan dihapus"); await load(); }
        catch (e) { toast.error("Gagal", e instanceof Error ? e.message : undefined); }
      } },
    ]);
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <KeyboardAwareScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" bottomOffset={24}>
        <View style={styles.between}>
          <Header title="Karyawan Teknis" subtitle={`${list.length} karyawan · mekanik, teknisi, barberman, dll`} />
          <Pressable onPress={() => router.back()} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}><Ionicons name="chevron-back" size={26} color={colors.onSurface} /></Pressable>
        </View>
        <View style={styles.card}>
          <Text style={[styles.cardTitle, { marginBottom: 12 }]}>{editing ? "Edit karyawan" : "Tambah karyawan"}</Text>
          <Text style={styles.inputLabel}>Nama</Text>
          <TextInput testID="technician-name-input" value={name} onChangeText={setName} placeholder="Mis: Budi" placeholderTextColor={colors.muted} style={styles.input} />
          <Text style={styles.inputLabel}>Jabatan / keahlian</Text>
          <TextInput testID="technician-position-input" value={position} onChangeText={setPosition} placeholder="Mis: Mekanik, Barberman, Dokter" placeholderTextColor={colors.muted} style={styles.input} />
          <Pressable testID="save-technician" onPress={save} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>{editing ? "Simpan perubahan" : "Tambah karyawan"}</Text>
          </Pressable>
          {editing ? <Pressable onPress={reset} style={{ minHeight: 44, justifyContent: "center" }}><Text style={{ color: colors.muted, textAlign: "center" }}>Batal edit</Text></Pressable> : null}
        </View>
        {list.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="construct-outline" size={44} color={colors.muted} />
            <Text style={[styles.muted, { marginTop: 10 }]}>Belum ada karyawan teknis.</Text>
          </View>
        ) : list.map((t) => (
          <Pressable key={t.id} testID={`technician-${t.id}`} onPress={() => { setEditing(t); setName(t.name); setPosition(t.position || ""); }} style={styles.listRow}>
            <View style={styles.settingIcon}><Ionicons name="construct-outline" size={20} color={colors.brandPrimary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.productName}>{t.name}</Text>
              {t.position ? <Text style={styles.muted}>{t.position}</Text> : null}
            </View>
            <Pressable testID={`delete-technician-${t.id}`} onPress={() => askDelete(t)} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}><Ionicons name="trash-outline" size={20} color={colors.error} /></Pressable>
          </Pressable>
        ))}
      </KeyboardAwareScrollView>
    </View>
  );
}
