import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest, Category } from "@/src/api";
import { useAppStyles } from "@/src/app-styles";
import { Header } from "@/src/components/header";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";

export default function CategoriesScreen() {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [list, setList] = useState<Category[]>([]);
  const [editing, setEditing] = useState<Category | null>(null);
  const [name, setName] = useState("");

  const load = useCallback(async () => {
    try { setList(await apiRequest<Category[]>("/categories")); }
    catch (e) { toast.error("Gagal memuat", e instanceof Error ? e.message : undefined); }
  }, [toast]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const save = async () => {
    if (!name.trim()) return toast.error("Nama wajib");
    try {
      if (editing) await apiRequest(`/categories/${editing.id}`, { method: "PUT", body: JSON.stringify({ name: name.trim(), icon: "cube-outline" }) });
      else await apiRequest("/categories", { method: "POST", body: JSON.stringify({ name: name.trim(), icon: "cube-outline" }) });
      toast.success(editing ? "Kategori diperbarui" : "Kategori ditambahkan");
      setEditing(null); setName("");
      await load();
    } catch (e) { toast.error("Gagal", e instanceof Error ? e.message : undefined); }
  };

  const askDelete = (c: Category) => {
    Alert.alert("Hapus kategori?", c.name, [
      { text: "Batal", style: "cancel" },
      { text: "Hapus", style: "destructive", onPress: async () => {
        try { await apiRequest(`/categories/${c.id}`, { method: "DELETE" }); toast.success("Kategori dihapus"); await load(); }
        catch (e) { toast.error("Gagal", e instanceof Error ? e.message : undefined); }
      } },
    ]);
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.between}>
          <Header title="Kategori barang" subtitle={`${list.length} kategori terdaftar`} />
          <Pressable onPress={() => router.back()}><Ionicons name="chevron-back" size={26} color={colors.onSurface} /></Pressable>
        </View>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Tambah kategori</Text>
          <View style={[styles.row, { marginTop: 12, gap: 10 }]}>
            <TextInput testID="category-input" value={name} onChangeText={setName} placeholder="Mis: Makanan, Minuman" placeholderTextColor={colors.muted} style={[styles.input, { flex: 1, marginBottom: 0 }]} />
            <Pressable testID="save-category" onPress={save} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>{editing ? "Simpan" : "Tambah"}</Text>
            </Pressable>
          </View>
          {editing ? <Pressable onPress={() => { setEditing(null); setName(""); }} style={{ marginTop: 10 }}><Text style={{ color: colors.muted, textAlign: "center" }}>Batal edit</Text></Pressable> : null}
        </View>
        {list.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="pricetags-outline" size={44} color={colors.muted} />
            <Text style={[styles.muted, { marginTop: 10 }]}>Belum ada kategori. Tambahkan di atas.</Text>
          </View>
        ) : list.map((c) => (
          <Pressable key={c.id} testID={`cat-${c.id}`} onPress={() => { setEditing(c); setName(c.name); }} style={styles.listRow}>
            <View style={styles.settingIcon}><Ionicons name={(c.icon as never) || "cube-outline"} size={20} color={colors.brandPrimary} /></View>
            <View style={{ flex: 1 }}><Text style={styles.productName}>{c.name}</Text></View>
            <Pressable onPress={() => askDelete(c)} style={{ padding: 6 }}><Ionicons name="trash-outline" size={20} color={colors.error} /></Pressable>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
