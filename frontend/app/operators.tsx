import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest, Operator, PERMISSION_LABELS } from "@/src/api";
import { useAppStyles } from "@/src/app-styles";
import { useAuth } from "@/src/auth-context";
import { Header } from "@/src/components/header";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";

export default function OperatorsScreen() {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { user } = useAuth();
  const [list, setList] = useState<Operator[]>([]);

  const load = async () => {
    try { setList(await apiRequest<Operator[]>("/operators")); }
    catch (e) { toast.error("Gagal memuat", e instanceof Error ? e.message : undefined); }
  };
  useEffect(() => { load(); }, []);

  if (user?.role !== "owner") {
    return (
      <View style={[styles.screen, { paddingTop: insets.top, alignItems: "center", justifyContent: "center", padding: 24 }]}>
        <Ionicons name="lock-closed-outline" size={44} color={colors.muted} />
        <Text style={[styles.title, { fontSize: 22, textAlign: "center", marginTop: 16 }]}>Hanya pemilik</Text>
        <Text style={[styles.subtitle, { textAlign: "center" }]}>Pengaturan operator hanya untuk akun pemilik bisnis.</Text>
      </View>
    );
  }

  const askDelete = (op: Operator) => {
    Alert.alert("Hapus operator?", op.name, [
      { text: "Batal", style: "cancel" },
      { text: "Hapus", style: "destructive", onPress: async () => {
        try { await apiRequest(`/operators/${op.id}`, { method: "DELETE" }); toast.success("Operator dihapus"); await load(); }
        catch (e) { toast.error("Gagal menghapus", e instanceof Error ? e.message : undefined); }
      } },
    ]);
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.between}>
          <Header title="Operator & kewenangan" subtitle={`${list.length} operator terdaftar`} />
          <Pressable onPress={() => router.back()}><Ionicons name="chevron-back" size={26} color={colors.onSurface} /></Pressable>
        </View>
        {list.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="people-outline" size={44} color={colors.muted} />
            <Text style={[styles.muted, { marginTop: 10 }]}>Belum ada operator. Tambahkan tim Anda.</Text>
          </View>
        ) : list.map((op) => (
          <View key={op.id} style={styles.card}>
            <View style={styles.between}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{op.name}</Text>
                <Text style={styles.muted}>@{op.username} · {op.role}</Text>
              </View>
              <View style={styles.row}>
                <Pressable testID={`edit-op-${op.id}`} onPress={() => router.push({ pathname: "/operator-form", params: { id: op.id } })} style={{ marginRight: 10 }}>
                  <Ionicons name="create-outline" size={22} color={colors.brandPrimary} />
                </Pressable>
                <Pressable testID={`delete-op-${op.id}`} onPress={() => askDelete(op)}>
                  <Ionicons name="trash-outline" size={22} color={colors.error} />
                </Pressable>
              </View>
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
              {(op.permissions ?? []).length === 0 ? (
                <Text style={styles.muted}>Belum ada kewenangan aktif.</Text>
              ) : (op.permissions ?? []).map((p) => (
                <View key={p} style={styles.badge}>
                  <Text style={styles.badgeText}>{PERMISSION_LABELS[p]}</Text>
                </View>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
      <Pressable testID="add-operator-fab" onPress={() => router.push("/operator-form")} style={[styles.fab, { bottom: insets.bottom + 24 }]}>
        <Ionicons name="person-add" size={26} color={colors.onBrandPrimary} />
      </Pressable>
    </View>
  );
}
