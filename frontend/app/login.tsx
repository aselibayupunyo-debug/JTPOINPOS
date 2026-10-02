import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { login, register } from "@/src/api";
import { useAppStyles } from "@/src/app-styles";
import { useAuth } from "@/src/auth-context";
import { useTheme } from "@/src/theme";

export default function LoginScreen() {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { signIn } = useAuth();
  const [isRegister, setIsRegister] = useState(false);
  const [business, setBusiness] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setError("");
    if (!username || !password || (isRegister && (!business || !name))) {
      setError("Lengkapi semua data terlebih dahulu.");
      return;
    }
    setBusy(true);
    try {
      const result = isRegister
        ? await register({ business_name: business, owner_name: name, username, password })
        : await login(username, password);
      await signIn(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Tidak dapat terhubung ke server.");
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
            <Text style={styles.cardTitle}>{isRegister ? "Buat bisnis baru" : "Selamat datang kembali"}</Text>
            <Text style={[styles.subtitle, { marginBottom: 18 }]}>{isRegister ? "Daftarkan akun pemilik untuk mulai berjualan." : "Masuk untuk melanjutkan operasional toko."}</Text>
            {isRegister ? (
              <>
                <Text style={styles.inputLabel}>Nama bisnis</Text>
                <TextInput testID="input-business" value={business} onChangeText={setBusiness} placeholder="Toko Sejahtera" placeholderTextColor={colors.muted} style={styles.input} />
                <Text style={styles.inputLabel}>Nama pemilik</Text>
                <TextInput testID="input-name" value={name} onChangeText={setName} placeholder="Nama lengkap" placeholderTextColor={colors.muted} style={styles.input} />
              </>
            ) : null}
            <Text style={styles.inputLabel}>Username</Text>
            <TextInput testID="input-username" autoCapitalize="none" value={username} onChangeText={setUsername} placeholder="username" placeholderTextColor={colors.muted} style={styles.input} />
            <Text style={styles.inputLabel}>Password</Text>
            <TextInput testID="input-password" secureTextEntry value={password} onChangeText={setPassword} placeholder="Minimal 6 karakter" placeholderTextColor={colors.muted} style={styles.input} />
            {error ? <Text style={{ color: colors.error, fontSize: 13, marginBottom: 12 }} testID="auth-error">{error}</Text> : null}
            <Pressable testID="submit-auth" accessibilityRole="button" onPress={submit} disabled={busy} style={({ pressed }) => [styles.primaryButton, pressed && { opacity: 0.82 }]}>
              {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryButtonText}>{isRegister ? "Daftar dan mulai" : "Masuk ke kasir"}</Text>}
            </Pressable>
            <Pressable testID="toggle-mode" onPress={() => { setIsRegister((v) => !v); setError(""); }} style={{ minHeight: 48, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ color: colors.brandPrimary, fontSize: 14, fontWeight: "700" }}>{isRegister ? "Sudah punya akun? Masuk" : "Daftar bisnis baru"}</Text>
            </Pressable>
          </View>
          <Text style={[styles.muted, { textAlign: "center", marginTop: 16 }]}>Semua data tersimpan 100% di perangkat Anda · Tanpa server · Tanpa internet.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
