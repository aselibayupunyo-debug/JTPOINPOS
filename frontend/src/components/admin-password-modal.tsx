import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { ActivityIndicator, Modal, Pressable, Text, TextInput, View } from "react-native";

import { useAppStyles } from "@/src/app-styles";
import { useTheme } from "@/src/theme";

type Props = {
  visible: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: (password: string) => Promise<void> | void;
};

export function AdminPasswordModal({ visible, title, description, confirmLabel = "Konfirmasi", danger = true, onCancel, onConfirm }: Props) {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const close = () => { setPassword(""); setBusy(false); onCancel(); };
  const submit = async () => {
    if (!password) return;
    setBusy(true);
    try { await onConfirm(password); setPassword(""); }
    finally { setBusy(false); }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={{ flex: 1, backgroundColor: "rgba(28,28,30,0.55)", justifyContent: "center", padding: 24 }}>
        <View style={{ backgroundColor: colors.surface, borderRadius: 20, padding: 20 }}>
          <View style={styles.between}>
            <Text style={styles.cardTitle}>{title}</Text>
            <Pressable onPress={close} disabled={busy}><Ionicons name="close" size={22} color={colors.onSurface} /></Pressable>
          </View>
          <Text style={[styles.muted, { marginTop: 8, marginBottom: 12 }]}>{description}</Text>
          <Text style={styles.inputLabel}>Password pemilik</Text>
          <TextInput
            testID="admin-password-input"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoFocus
            placeholder="Verifikasi aksi ini"
            placeholderTextColor={colors.muted}
            style={styles.input}
          />
          <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
            <Pressable onPress={close} disabled={busy} style={[styles.outlineButton, { flex: 1 }]}>
              <Text style={styles.outlineText}>Batal</Text>
            </Pressable>
            <Pressable
              testID="admin-password-confirm"
              onPress={submit}
              disabled={busy || !password}
              style={[danger ? styles.dangerButton : styles.primaryButton, { flex: 1 }, (busy || !password) && { opacity: 0.6 }]}
            >
              {busy ? <ActivityIndicator color={danger ? colors.onError ?? "#fff" : colors.onBrandPrimary} /> : (
                <Text style={danger ? styles.dangerText : styles.primaryButtonText}>{confirmLabel}</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
