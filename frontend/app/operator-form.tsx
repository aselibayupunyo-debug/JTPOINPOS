import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest, Operator, Permission, PERMISSION_LABELS } from "@/src/api";
import { useAppStyles } from "@/src/app-styles";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";

const ALL_PERMS: Permission[] = ["sales", "purchases", "returns", "inventory", "reports", "cashflow", "debts", "operators", "settings"];
const ROLES: { key: Operator["role"]; label: string; defaults: Permission[] }[] = [
  { key: "cashier", label: "Kasir", defaults: ["sales"] },
  { key: "inventory", label: "Gudang", defaults: ["inventory", "purchases"] },
  { key: "manager", label: "Manajer", defaults: ["sales", "purchases", "returns", "inventory", "reports", "cashflow", "debts"] },
  { key: "kitchen", label: "Dapur", defaults: [] },
];

export default function OperatorFormScreen() {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Operator["role"]>("cashier");
  const [permissions, setPermissions] = useState<Permission[]>(["sales"]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!!id);

  useEffect(() => {
    if (!id) return;
    apiRequest<Operator[]>(`/operators`).then((list) => {
      const match = list.find((o) => o.id === id);
      if (match) { setName(match.name); setUsername(match.username); setRole(match.role as Operator["role"]); setPermissions(match.permissions ?? []); }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [id]);

  const togglePerm = (p: Permission) => setPermissions((cur) => cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]);
  const applyRole = (next: Operator["role"]) => {
    setRole(next);
    const preset = ROLES.find((r) => r.key === next);
    if (preset) setPermissions(preset.defaults);
  };

  const save = async () => {
    if (!name.trim() || !username.trim() || (!id && !password.trim())) return toast.error("Lengkapi data operator");
    setBusy(true);
    try {
      const body = JSON.stringify({ name: name.trim(), username: username.trim(), password: password || "placeholder", role, permissions });
      if (id) await apiRequest(`/operators/${id}`, { method: "PUT", body });
      else await apiRequest("/operators", { method: "POST", body });
      toast.success(id ? "Operator diperbarui" : "Operator ditambahkan");
      router.back();
    } catch (e) { toast.error("Gagal menyimpan", e instanceof Error ? e.message : undefined); }
    finally { setBusy(false); }
  };

  if (loading) return <View style={[styles.screen, { alignItems: "center", justifyContent: "center" }]}><ActivityIndicator color={colors.brandPrimary} /></View>;

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 10 }]} keyboardShouldPersistTaps="handled">
        <View style={styles.between}>
          <Text style={[styles.title, { fontSize: 24 }]}>{id ? "Edit operator" : "Operator baru"}</Text>
          <Pressable onPress={() => router.back()}><Ionicons name="close" size={26} color={colors.onSurface} /></Pressable>
        </View>
        <Text style={styles.inputLabel}>Nama</Text>
        <TextInput testID="op-name" value={name} onChangeText={setName} style={styles.input} placeholderTextColor={colors.muted} placeholder="Nama operator" />
        <Text style={styles.inputLabel}>Username</Text>
        <TextInput testID="op-username" autoCapitalize="none" value={username} onChangeText={setUsername} style={styles.input} placeholderTextColor={colors.muted} placeholder="username unik" editable={!id} />
        <Text style={styles.inputLabel}>Password {id ? "(kosongkan jika tidak diubah)" : ""}</Text>
        <TextInput testID="op-password" secureTextEntry value={password} onChangeText={setPassword} style={styles.input} placeholderTextColor={colors.muted} placeholder="Minimal 6 karakter" />
        <Text style={styles.inputLabel}>Peran preset</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
          {ROLES.map((r) => (
            <Pressable key={r.key} testID={`role-${r.key}`} onPress={() => applyRole(r.key)} style={[{ paddingHorizontal: 14, minHeight: 42, borderRadius: 12, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" }, role === r.key && { backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandPrimary }]}>
              <Text style={{ color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "800" }}>{r.label}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.inputLabel}>Kewenangan yang diaktifkan</Text>
        <View style={styles.card}>
          {ALL_PERMS.map((p) => (
            <View key={p} style={styles.listRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.productName}>{PERMISSION_LABELS[p]}</Text>
              </View>
              <Switch testID={`perm-${p}`} value={permissions.includes(p)} onValueChange={() => togglePerm(p)} trackColor={{ true: colors.brandPrimary, false: colors.borderStrong }} thumbColor={colors.onBrandPrimary} />
            </View>
          ))}
        </View>
        <Pressable testID="save-operator" disabled={busy} onPress={save} style={[styles.primaryButton, busy && { opacity: 0.5 }]}>
          {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryButtonText}>{id ? "Simpan perubahan" : "Simpan operator"}</Text>}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
