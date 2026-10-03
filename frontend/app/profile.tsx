import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest, updateProfile, User } from "@/src/api";
import { useAppStyles } from "@/src/app-styles";
import { useAuth } from "@/src/auth-context";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";

export default function ProfileScreen() {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { user, refresh } = useAuth();
  const params = useLocalSearchParams<{ emergency?: string }>();
  const emergency = params.emergency === "1";

  const [name, setName] = useState(user?.name ?? "");
  const [username, setUsername] = useState(user?.username ?? "");
  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!emergency && !currentPwd) return toast.error("Masukkan password saat ini untuk verifikasi");
    const nextUsername = username.trim().toLowerCase();
    if (nextUsername && nextUsername !== (user?.username ?? "") && nextUsername.length < 3) {
      return toast.error("Username minimal 3 karakter");
    }
    if (newPwd && newPwd !== confirmPwd) return toast.error("Konfirmasi password tidak cocok");
    if (newPwd && newPwd.length < 6) return toast.error("Password baru minimal 6 karakter");
    setBusy(true);
    try {
      if (emergency) {
        // Mode darurat: pakai endpoint bypass yang tidak minta password saat ini.
        const body: Record<string, unknown> = {};
        if (name.trim()) body.display_name = name.trim();
        if (nextUsername && nextUsername !== (user?.username ?? "")) body.username = nextUsername;
        if (newPwd) body.new_password = newPwd;
        await apiRequest<User>("/profile/emergency", { method: "PUT", body: JSON.stringify(body) });
      } else {
        await updateProfile({
          name: name.trim(),
          username: nextUsername && nextUsername !== (user?.username ?? "") ? nextUsername : undefined,
          current_password: currentPwd,
          new_password: newPwd || undefined,
        });
      }
      toast.success(emergency ? "Password berhasil direset" : "Profil diperbarui");
      setCurrentPwd(""); setNewPwd(""); setConfirmPwd("");
      if (refresh) await refresh();
      router.back();
    } catch (e) { toast.error("Gagal", e instanceof Error ? e.message : undefined); }
    finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 10 }]} keyboardShouldPersistTaps="handled">
        <View style={styles.between}>
          <Text style={[styles.title, { fontSize: 22 }]}>{emergency ? "Reset Password Darurat" : "Profil & Password"}</Text>
          <Pressable onPress={() => router.back()}><Ionicons name="close" size={26} color={colors.onSurface} /></Pressable>
        </View>
        {emergency ? (
          <View style={[styles.card, { marginTop: 10, backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandPrimary }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Ionicons name="shield-checkmark" size={20} color={colors.brandPrimary} />
              <Text style={[styles.cardTitle, { color: colors.brandPrimary }]}>Mode Darurat Aktif</Text>
            </View>
            <Text style={[styles.muted, { marginTop: 6, lineHeight: 20 }]}>
              Anda masuk dengan password darurat. Silakan atur password baru pemilik Anda tanpa perlu memasukkan password lama.
            </Text>
          </View>
        ) : null}
        <View style={[styles.card, { marginTop: 10 }]}>
          <Text style={styles.cardTitle}>Akun pemilik</Text>
          <Text style={[styles.muted, { marginTop: 4 }]}>{user?.business_name}</Text>
          <Text style={styles.inputLabel}>Nama tampilan</Text>
          <TextInput testID="profile-name" value={name} onChangeText={setName} style={styles.input} placeholder="Nama lengkap" placeholderTextColor={colors.muted} autoComplete="off" autoCorrect={false} textContentType="none" importantForAutofill="no" />
          <Text style={styles.inputLabel}>Username / login</Text>
          <TextInput testID="profile-username" value={username} onChangeText={setUsername} autoCapitalize="none" style={styles.input} placeholder="Minimal 3 karakter, tanpa spasi" placeholderTextColor={colors.muted} autoComplete="off" autoCorrect={false} textContentType="none" importantForAutofill="no" />
          <Text style={styles.muted}>{emergency ? "Dipakai saat login." : "Dipakai saat login. Ubah dengan password admin."}</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{emergency ? "Set password baru" : "Ganti password"}</Text>
          <Text style={[styles.muted, { marginTop: 4, marginBottom: 10 }]}>
            {emergency ? "Isi password baru pemilik di bawah ini." : "Kosongkan jika hanya mengubah nama."}
          </Text>
          {emergency ? null : (
            <>
              <Text style={styles.inputLabel}>Password saat ini</Text>
              <TextInput testID="profile-current-pwd" value={currentPwd} onChangeText={setCurrentPwd} secureTextEntry style={styles.input} placeholder="Verifikasi perubahan" placeholderTextColor={colors.muted} autoComplete="off" autoCorrect={false} textContentType="none" importantForAutofill="no" />
            </>
          )}
          <Text style={styles.inputLabel}>Password baru</Text>
          <TextInput testID="profile-new-pwd" value={newPwd} onChangeText={setNewPwd} secureTextEntry style={styles.input} placeholder="Minimal 6 karakter" placeholderTextColor={colors.muted} autoComplete="off" autoCorrect={false} textContentType="none" importantForAutofill="no" />
          <Text style={styles.inputLabel}>Konfirmasi password baru</Text>
          <TextInput testID="profile-confirm-pwd" value={confirmPwd} onChangeText={setConfirmPwd} secureTextEntry style={styles.input} placeholder="Ulangi password baru" placeholderTextColor={colors.muted} autoComplete="off" autoCorrect={false} textContentType="none" importantForAutofill="no" />
        </View>
        <Pressable testID="save-profile" disabled={busy} onPress={save} style={[styles.primaryButton, busy && { opacity: 0.5 }]}>
          {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryButtonText}>Simpan perubahan</Text>}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
