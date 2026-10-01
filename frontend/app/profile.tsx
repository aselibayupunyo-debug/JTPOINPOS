import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { updateProfile } from "@/src/api";
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
  const [name, setName] = useState(user?.name ?? "");
  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!currentPwd) return toast.error("Masukkan password saat ini untuk verifikasi");
    if (newPwd && newPwd !== confirmPwd) return toast.error("Konfirmasi password tidak cocok");
    if (newPwd && newPwd.length < 6) return toast.error("Password baru minimal 6 karakter");
    setBusy(true);
    try {
      await updateProfile({ name: name.trim(), current_password: currentPwd, new_password: newPwd || undefined });
      toast.success("Profil diperbarui");
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
          <Text style={[styles.title, { fontSize: 22 }]}>Profil & Password</Text>
          <Pressable onPress={() => router.back()}><Ionicons name="close" size={26} color={colors.onSurface} /></Pressable>
        </View>
        <View style={[styles.card, { marginTop: 10 }]}>
          <Text style={styles.cardTitle}>Akun pemilik</Text>
          <Text style={[styles.muted, { marginTop: 4 }]}>{user?.business_name} · {user?.username}</Text>
          <Text style={styles.inputLabel}>Nama tampilan</Text>
          <TextInput testID="profile-name" value={name} onChangeText={setName} style={styles.input} placeholder="Nama lengkap" placeholderTextColor={colors.muted} />
        </View>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Ganti password</Text>
          <Text style={[styles.muted, { marginTop: 4, marginBottom: 10 }]}>Kosongkan jika hanya mengubah nama.</Text>
          <Text style={styles.inputLabel}>Password saat ini</Text>
          <TextInput testID="profile-current-pwd" value={currentPwd} onChangeText={setCurrentPwd} secureTextEntry style={styles.input} placeholder="Verifikasi perubahan" placeholderTextColor={colors.muted} />
          <Text style={styles.inputLabel}>Password baru</Text>
          <TextInput testID="profile-new-pwd" value={newPwd} onChangeText={setNewPwd} secureTextEntry style={styles.input} placeholder="Minimal 6 karakter" placeholderTextColor={colors.muted} />
          <Text style={styles.inputLabel}>Konfirmasi password baru</Text>
          <TextInput testID="profile-confirm-pwd" value={confirmPwd} onChangeText={setConfirmPwd} secureTextEntry style={styles.input} placeholder="Ulangi password baru" placeholderTextColor={colors.muted} />
        </View>
        <Pressable testID="save-profile" disabled={busy} onPress={save} style={[styles.primaryButton, busy && { opacity: 0.5 }]}>
          {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryButtonText}>Simpan perubahan</Text>}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
