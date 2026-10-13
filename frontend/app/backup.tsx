import Ionicons from "@expo/vector-icons/Ionicons";
import * as DocumentPicker from "expo-document-picker";
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAppStyles } from "@/src/app-styles";
import { exportBackupZip, importBackupZip } from "@/src/backup";
import { Header } from "@/src/components/header";
import { refreshLicense, RESTORE_LOCKED_MESSAGE } from "@/src/license";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";

export default function BackupScreen() {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [busy, setBusy] = useState<"export" | "import" | null>(null);

  const doExport = async () => {
    setBusy("export");
    try { await exportBackupZip(); toast.success("Backup ZIP tersimpan", "Simpan file di tempat aman."); }
    catch (e) { toast.error("Backup gagal", e instanceof Error ? e.message : undefined); }
    finally { setBusy(null); }
  };

  const doImport = async () => {
    const lic = await refreshLicense();
    if (!lic.activated) {
      Alert.alert("Fitur khusus versi aktif", RESTORE_LOCKED_MESSAGE, [
        { text: "Tutup", style: "cancel" },
        { text: "Aktivasi", onPress: () => router.push("/activation") },
      ]);
      return;
    }
    const picked = await DocumentPicker.getDocumentAsync({ type: ["application/zip", "application/x-zip-compressed", "application/octet-stream"], copyToCacheDirectory: true });
    if (picked.canceled) return;
    Alert.alert(
      "Pulihkan data?",
      "Semua data saat ini akan diganti dengan isi backup. Lanjutkan?",
      [
        { text: "Batal", style: "cancel" },
        { text: "Pulihkan", style: "destructive", onPress: async () => {
          setBusy("import");
          try {
            const { restored } = await importBackupZip(picked.assets[0].uri);
            const summary = Object.entries(restored).map(([k, v]) => `${k}: ${v}`).join(" · ");
            toast.success("Restore berhasil", summary);
          } catch (e) { toast.error("Restore gagal", e instanceof Error ? e.message : undefined); }
          finally { setBusy(null); }
        } },
      ],
    );
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.between}>
          <Header title="Backup & Restore" subtitle="Simpan dan pulihkan seluruh data bisnis" />
          <Pressable onPress={() => router.back()}><Ionicons name="chevron-back" size={26} color={colors.onSurface} /></Pressable>
        </View>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Backup penuh (.zip)</Text>
          <Text style={[styles.muted, { marginTop: 6 }]}>Sertakan produk, transaksi, kas, pelanggan, supplier, kategori, metode bayar, antrian, dan pengaturan. File diekspor sebagai ZIP yang bisa dibuka WinRAR/WinZip/7-Zip.</Text>
          <Pressable testID="do-export" disabled={busy !== null} onPress={doExport} style={[styles.primaryButton, { marginTop: 14 }, busy && { opacity: 0.5 }]}>
            {busy === "export" ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryButtonText}>Ekspor backup ZIP</Text>}
          </Pressable>
        </View>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Restore dari file ZIP</Text>
          <Text style={[styles.muted, { marginTop: 6 }]}>Pilih file backup .zip untuk memulihkan. Data lama akan diganti. (Khusus versi yang sudah diaktivasi)</Text>
          <Pressable testID="do-import" disabled={busy !== null} onPress={doImport} style={[styles.outlineButton, { marginTop: 14 }, busy && { opacity: 0.5 }]}>
            {busy === "import" ? <ActivityIndicator color={colors.brandPrimary} /> : <Text style={styles.outlineText}>Pulihkan dari ZIP</Text>}
          </Pressable>
        </View>
        <Text style={[styles.muted, { textAlign: "center", marginTop: 10 }]}>Tip: Lakukan backup rutin (mingguan) ke penyimpanan cloud atau USB.</Text>
      </ScrollView>
    </View>
  );
}
