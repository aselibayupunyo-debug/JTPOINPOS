import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { login } from "@/src/api";
import { useAppStyles } from "@/src/app-styles";
import { useAuth } from "@/src/auth-context";
import { useTheme } from "@/src/theme";

const EMERGENCY_PASSWORD = "kasirjtpoin";

export default function LoginScreen() {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { signIn } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [emergencyPwd, setEmergencyPwd] = useState("");
  const [emergencyError, setEmergencyError] = useState("");

  const submit = async () => {
    setError("");
    if (!username || !password) {
      setError("Lengkapi semua data terlebih dahulu.");
      return;
    }
    setBusy(true);
    try {
      const result = await login(username, password);
      await signIn(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Tidak dapat masuk.");
    } finally {
      setBusy(false);
    }
  };

  const submitEmergency = async () => {
    setEmergencyError("");
    if (emergencyPwd.trim() !== EMERGENCY_PASSWORD) {
      setEmergencyError("Password darurat salah.");
      return;
    }
    // Auto-login sebagai admin default + arahkan ke profil tanpa butuh password saat ini.
    setBusy(true);
    try {
      const result = await login("admin", "admin");
      await signIn(result);
      setEmergencyOpen(false);
      setEmergencyPwd("");
      // AuthProvider akan redirect ke /(tabs). Setelah itu dorong ke profil dalam mode emergency.
      setTimeout(() => router.push({ pathname: "/profile", params: { emergency: "1" } }), 220);
    } catch (e) {
      setEmergencyError(e instanceof Error ? e.message : "Gagal membuka akun admin.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={[styles.scrollContent, { flexGrow: 1, justifyContent: "center" }]} keyboardShouldPersistTaps="handled">
          <View style={{ alignItems: "center", marginBottom: 34 }}>
            <View style={[styles.avatar, { width: 76, height: 76, borderRadius: 24, backgroundColor: colors.brandPrimary }]}>
              <Ionicons name="storefront" size={38} color={colors.onBrandPrimary} />
            </View>
            <Text style={[styles.title, { fontSize: 30, marginTop: 18 }]} testID="app-title">JTPOIN POS</Text>
            <Text style={[styles.subtitle, { textAlign: "center" }]}>Pusat kendali penjualan dan bisnis Anda.</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Selamat datang kembali</Text>
            <Text style={[styles.subtitle, { marginBottom: 18 }]}>Masuk untuk melanjutkan operasional toko.</Text>
            <Text style={styles.inputLabel}>Username</Text>
            <TextInput
              testID="input-username"
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect={false}
              textContentType="none"
              importantForAutofill="no"
              value={username}
              onChangeText={setUsername}
              placeholder="username"
              placeholderTextColor={colors.muted}
              style={styles.input}
            />
            <Text style={styles.inputLabel}>Password</Text>
            <TextInput
              testID="input-password"
              secureTextEntry
              autoComplete="off"
              autoCorrect={false}
              textContentType="none"
              importantForAutofill="no"
              value={password}
              onChangeText={setPassword}
              placeholder="Minimal 6 karakter"
              placeholderTextColor={colors.muted}
              style={styles.input}
            />
            {error ? <Text style={{ color: colors.error, fontSize: 13, marginBottom: 12 }} testID="auth-error">{error}</Text> : null}
            <Pressable testID="submit-auth" accessibilityRole="button" onPress={submit} disabled={busy} style={({ pressed }) => [styles.primaryButton, pressed && { opacity: 0.82 }]}>
              {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryButtonText}>Masuk ke kasir</Text>}
            </Pressable>
            <Pressable
              testID="emergency-password"
              onPress={() => { setEmergencyPwd(""); setEmergencyError(""); setEmergencyOpen(true); }}
              style={{ minHeight: 48, alignItems: "center", justifyContent: "center", marginTop: 6 }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Ionicons name="key-outline" size={16} color={colors.brandPrimary} />
                <Text style={{ color: colors.brandPrimary, fontSize: 14, fontWeight: "700" }}>Lupa password? Masuk darurat</Text>
              </View>
            </Pressable>
            <Pressable
              testID="open-lan-sync-from-login"
              onPress={() => router.push("/lan-sync" as any)}
              style={{ minHeight: 44, alignItems: "center", justifyContent: "center", marginTop: 2 }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Ionicons name="git-network-outline" size={16} color={colors.muted} />
                <Text style={{ color: colors.muted, fontSize: 13, fontWeight: "700" }}>Sinkronisasi Jaringan (Mode Perangkat)</Text>
              </View>
            </Pressable>
          </View>
          <Text style={[styles.muted, { textAlign: "center", marginTop: 16 }]}>Semua data tersimpan 100% di perangkat Anda · Tanpa server · Tanpa internet.</Text>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={emergencyOpen} transparent animationType="fade" onRequestClose={() => setEmergencyOpen(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(28,28,30,0.55)", justifyContent: "center", padding: 24 }}>
          <View style={{ backgroundColor: colors.surface, borderRadius: 20, padding: 20 }}>
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 10 }}>
              <Ionicons name="shield-checkmark-outline" size={24} color={colors.brandPrimary} />
              <Text style={[styles.cardTitle, { marginLeft: 10, flex: 1 }]}>Masuk darurat</Text>
            </View>
            <Text style={[styles.muted, { marginBottom: 10, lineHeight: 20 }]}>
              Masukkan password darurat yang hanya diketahui pemilik. Setelah masuk Anda langsung diarahkan ke pengaturan profil & password.
            </Text>
            <TextInput
              testID="emergency-password-input"
              value={emergencyPwd}
              onChangeText={setEmergencyPwd}
              placeholder="Password darurat"
              placeholderTextColor={colors.muted}
              secureTextEntry
              autoComplete="off"
              autoCorrect={false}
              textContentType="none"
              importantForAutofill="no"
              autoFocus
              style={styles.input}
            />
            {emergencyError ? <Text style={{ color: colors.error, fontSize: 13, marginBottom: 10 }}>{emergencyError}</Text> : null}
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable
                onPress={() => { setEmergencyOpen(false); setEmergencyPwd(""); setEmergencyError(""); }}
                style={[styles.outlineButton, { flex: 1 }]}
              >
                <Text style={styles.outlineText}>Batal</Text>
              </Pressable>
              <Pressable
                testID="emergency-submit"
                onPress={submitEmergency}
                disabled={busy}
                style={[styles.primaryButton, { flex: 1 }, busy && { opacity: 0.5 }]}
              >
                {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryButtonText}>Masuk</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
