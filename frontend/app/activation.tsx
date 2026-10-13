import Ionicons from "@expo/vector-icons/Ionicons";
import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAppStyles } from "@/src/app-styles";
import { Header } from "@/src/components/header";
import { activate, generateActivationCode, MASTER_PASSWORD, TRIAL_DAYS, useLicense } from "@/src/license";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";

export default function ActivationScreen() {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { status } = useLicense();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const [genOpen, setGenOpen] = useState(false);
  const [masterPw, setMasterPw] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [targetId, setTargetId] = useState("");
  const [generated, setGenerated] = useState("");

  const copy = async (text: string, label: string) => {
    await Clipboard.setStringAsync(text);
    toast.success("Disalin", label);
  };

  const onActivate = async () => {
    if (!code.trim()) return toast.error("Isi kode aktivasi");
    setBusy(true);
    try {
      if (await activate(code)) toast.success("Aktivasi berhasil", "JTPOIN POS aktif permanen di HP ini");
      else toast.error("Kode tidak valid", "Pastikan kode dibuat untuk ID Perangkat ini");
    } finally { setBusy(false); }
  };

  const onUnlock = () => {
    if (masterPw === MASTER_PASSWORD) { setUnlocked(true); setMasterPw(""); }
    else toast.error("Password master salah");
  };

  const onGenerate = async () => {
    if (targetId.replace(/[^0-9a-fA-F]/g, "").length !== 8) return toast.error("ID Perangkat tidak valid", "Format: XXXX-XXXX");
    setGenerated(await generateActivationCode(targetId));
  };

  const statusText = !status ? "Memeriksa…"
    : status.activated ? "Aktif permanen"
    : status.expired ? (status.tampered ? "Demo habis (jam HP dimundurkan)" : "Masa demo habis")
    : `Mode demo · sisa ${status.daysLeft} hari`;
  const statusColor = !status ? colors.muted : status.activated ? colors.success : status.expired ? colors.error : colors.warning;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <KeyboardAwareScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" bottomOffset={24}>
        <Pressable testID="activation-back" onPress={() => router.back()} style={{ width: 44, height: 44, justifyContent: "center" }}>
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <Header eyebrow="JTPOIN POS" title="Aktivasi Lisensi" subtitle={`Demo gratis ${TRIAL_DAYS} hari, lalu aktivasi untuk pemakaian permanen`} />

        <View style={styles.card}>
          <Text style={styles.muted}>Status</Text>
          <Text testID="license-status" style={[styles.cardTitle, { color: statusColor, marginTop: 4 }]}>{statusText}</Text>
          {status && !status.activated && !status.expired ? (
            <Text style={[styles.muted, { marginTop: 4 }]}>Berakhir: {new Date(status.trialEndsAt).toLocaleString("id-ID")}</Text>
          ) : null}
          {status && !status.activated && status.expired ? (
            <Text style={[styles.muted, { marginTop: 6 }]}>Data & laporan tetap bisa dilihat. Transaksi baru dan perubahan data memerlukan aktivasi.</Text>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.muted}>ID Perangkat (kirim ke penjual untuk mendapatkan kode)</Text>
          <View style={[styles.between, { marginTop: 8 }]}>
            <Text testID="device-id" selectable style={{ color: colors.onSurface, fontSize: 26, fontWeight: "800", letterSpacing: 2 }}>{status?.deviceId ?? "…"}</Text>
            <Pressable testID="copy-device-id" onPress={() => status && copy(status.deviceId, "ID Perangkat disalin")} style={styles.iconButton}>
              <Ionicons name="copy-outline" size={20} color={colors.brandPrimary} />
            </Pressable>
          </View>
        </View>

        {status?.activated ? null : (
          <View style={styles.card}>
            <Text style={styles.inputLabel}>Kode Aktivasi</Text>
            <TextInput
              testID="activation-code-input"
              value={code}
              onChangeText={setCode}
              placeholder="XXXX-XXXX-XXXX"
              placeholderTextColor={colors.muted}
              autoCapitalize="characters"
              autoCorrect={false}
              style={[styles.input, { letterSpacing: 2, fontWeight: "700" }]}
            />
            <Pressable testID="activate-button" disabled={busy} onPress={onActivate} style={[styles.primaryButton, busy && { opacity: 0.6 }]}>
              <Text style={styles.primaryButtonText}>{busy ? "Memeriksa…" : "Aktifkan"}</Text>
            </Pressable>
          </View>
        )}

        <Pressable testID="open-generator" onPress={() => setGenOpen((v) => !v)} style={{ minHeight: 44, alignItems: "center", justifyContent: "center" }}>
          <Text style={styles.muted}>{genOpen ? "Tutup generator" : "Generator kode (khusus pemilik aplikasi)"}</Text>
        </Pressable>

        {genOpen ? (
          <View style={styles.card} testID="generator-card">
            {!unlocked ? (
              <>
                <Text style={styles.inputLabel}>Password master</Text>
                <TextInput testID="master-password-input" value={masterPw} onChangeText={setMasterPw} secureTextEntry placeholder="Password master" placeholderTextColor={colors.muted} style={styles.input} />
                <Pressable testID="unlock-generator" onPress={onUnlock} style={styles.outlineButton}><Text style={styles.outlineText}>Buka Generator</Text></Pressable>
              </>
            ) : (
              <>
                <Text style={styles.inputLabel}>ID Perangkat pelanggan</Text>
                <TextInput testID="target-device-id-input" value={targetId} onChangeText={(t) => { setTargetId(t); setGenerated(""); }} placeholder="XXXX-XXXX" placeholderTextColor={colors.muted} autoCapitalize="characters" autoCorrect={false} style={[styles.input, { letterSpacing: 2, fontWeight: "700" }]} />
                <View style={[styles.row, { gap: 10 }]}>
                  <Pressable testID="generate-code-button" onPress={onGenerate} style={[styles.primaryButton, { flex: 1 }]}><Text style={styles.primaryButtonText}>Buat Kode</Text></Pressable>
                  <Pressable testID="use-this-device" onPress={() => { if (status) { setTargetId(status.deviceId); setGenerated(""); } }} style={[styles.outlineButton, { flex: 1 }]}><Text style={styles.outlineText}>HP ini</Text></Pressable>
                </View>
                {generated ? (
                  <View style={[styles.between, { marginTop: 14 }]}>
                    <Text testID="generated-code" selectable style={{ color: colors.brandPrimary, fontSize: 22, fontWeight: "800", letterSpacing: 2 }}>{generated}</Text>
                    <Pressable testID="copy-generated-code" onPress={() => copy(generated, "Kode aktivasi disalin")} style={styles.iconButton}>
                      <Ionicons name="copy-outline" size={20} color={colors.brandPrimary} />
                    </Pressable>
                  </View>
                ) : null}
              </>
            )}
          </View>
        ) : null}
      </KeyboardAwareScrollView>
    </View>
  );
}
