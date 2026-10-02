import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAppStyles } from "@/src/app-styles";
import {
  disconnectPrinter,
  getPairedPrinter,
  isPrinterAvailable,
  openBluetoothSettings,
  type PairedPrinter,
  savePairedPrinter,
  scanPrinters,
  testPrint,
} from "@/src/bt-printer";
import { Header } from "@/src/components/header";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";

export default function BluetoothPrinterScreen() {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [paired, setPaired] = useState<PairedPrinter[]>([]);
  const [found, setFound] = useState<PairedPrinter[]>([]);
  const [scanning, setScanning] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [current, setCurrent] = useState<PairedPrinter | null>(null);

  const refresh = useCallback(async () => {
    const avail = await isPrinterAvailable();
    setAvailable(avail);
    const saved = await getPairedPrinter();
    setCurrent(saved);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const doScan = async () => {
    if (!available) {
      return toast.error("Printer thermal tidak tersedia", "Butuh APK/IPA build (Expo Go tidak support).");
    }
    setScanning(true);
    setFound([]);
    try {
      const result = await scanPrinters(15000);
      setPaired(result.paired);
      setFound(result.found);
      if (result.paired.length === 0 && result.found.length === 0) {
        toast.info("Tidak ada printer ditemukan", "Pastikan printer sudah menyala dan Bluetooth aktif.");
      } else {
        toast.success(`Ditemukan ${result.paired.length + result.found.length} printer`, "Pilih printer dari daftar di bawah.");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Scan gagal";
      toast.error("Scan gagal", msg);
    } finally {
      setScanning(false);
    }
  };

  const pickPrinter = async (p: PairedPrinter) => {
    try {
      await savePairedPrinter(p);
      setCurrent(p);
      toast.success("Printer tersimpan", `${p.name} siap dipakai cetak struk.`);
    } catch (e) {
      toast.error("Gagal simpan printer", e instanceof Error ? e.message : undefined);
    }
  };

  const doTest = async (p: PairedPrinter) => {
    setTesting(p.address);
    try {
      await testPrint(p);
      toast.success("Berhasil cetak uji", `Lihat kertas keluar dari ${p.name}`);
    } catch (e) {
      toast.error("Cetak uji gagal", e instanceof Error ? e.message : undefined);
    } finally {
      setTesting(null);
    }
  };

  const clearPrinter = async () => {
    try {
      await disconnectPrinter();
      await savePairedPrinter(null);
      setCurrent(null);
      toast.info("Printer dilepas", "Pilih printer baru untuk mulai mencetak.");
    } catch {
      await savePairedPrinter(null);
      setCurrent(null);
    }
  };

  const openSettings = () => { openBluetoothSettings().catch(() => undefined); };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 10 }}>
          <Pressable testID="bt-back" onPress={() => router.back()} style={{ padding: 6, marginRight: 8 }}>
            <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Header title="Printer Bluetooth" subtitle="Thermal 58mm / 80mm · ESC/POS" />
          </View>
        </View>

        {available === false ? (
          <View style={[styles.card, { backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.warning }]}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Ionicons name="warning-outline" size={22} color={colors.warning} />
              <Text style={[styles.productName, { marginLeft: 8, color: colors.warning }]}>Butuh build Android/iOS native</Text>
            </View>
            <Text style={[styles.muted, { marginTop: 8, lineHeight: 20 }]}>
              Fitur Bluetooth thermal printer memakai modul native yang tidak tersedia di Expo Go atau web preview.{"\n\n"}
              <Text style={{ fontWeight: "700" }}>Cara pakai:</Text>{"\n"}
              1. Klik tombol <Text style={{ fontWeight: "700" }}>Publish</Text> di aplikasi untuk deploy.{"\n"}
              2. Generate APK Android (atau IPA iOS) dari panel build.{"\n"}
              3. Install APK ke HP, lalu pair printer di menu ini.
            </Text>
          </View>
        ) : null}

        {current ? (
          <View style={[styles.card, { backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandPrimary }]} testID="current-printer-card">
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Ionicons name="checkmark-circle" size={22} color={colors.brandPrimary} />
              <Text style={[styles.productName, { marginLeft: 8, color: colors.brandPrimary }]}>Printer terpasang</Text>
            </View>
            <Text style={[styles.productName, { marginTop: 8 }]}>{current.name}</Text>
            <Text style={styles.muted}>{current.address}</Text>
            <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
              <Pressable
                testID="test-current"
                disabled={!available || testing === current.address}
                onPress={() => doTest(current)}
                style={[styles.outlineButton, { flex: 1 }, (!available || testing === current.address) && { opacity: 0.5 }]}
              >
                {testing === current.address ? <ActivityIndicator color={colors.brandPrimary} /> : <Text style={styles.outlineText}>Cetak uji</Text>}
              </Pressable>
              <Pressable testID="unpair" onPress={clearPrinter} style={[styles.dangerButton, { flex: 1 }]}>
                <Text style={styles.dangerText}>Lepas</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={[styles.card]}>
            <Text style={styles.cardTitle}>Belum ada printer</Text>
            <Text style={[styles.muted, { marginTop: 4 }]}>Scan untuk mencari printer Bluetooth di sekitar.</Text>
          </View>
        )}

        <Pressable
          testID="scan-bt"
          disabled={scanning || available === false}
          onPress={doScan}
          style={[styles.primaryButton, { marginTop: 6 }, (scanning || available === false) && { opacity: 0.5 }]}
        >
          {scanning ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryButtonText}>{paired.length + found.length > 0 ? "Scan ulang" : "Scan printer Bluetooth"}</Text>}
        </Pressable>

        <Pressable testID="open-bt-settings" onPress={openSettings} style={[styles.outlineButton, { marginTop: 10 }]}>
          <Text style={styles.outlineText}>Buka pengaturan Bluetooth Android</Text>
        </Pressable>

        {paired.length > 0 ? (
          <View style={styles.card} testID="paired-list">
            <Text style={styles.cardTitle}>Terpasang (paired)</Text>
            {paired.map((p) => (
              <Pressable key={p.address} testID={`pick-paired-${p.address}`} onPress={() => pickPrinter(p)} style={styles.listRow}>
                <View style={styles.settingIcon}><Ionicons name="print-outline" size={20} color={colors.brandPrimary} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.productName}>{p.name}</Text>
                  <Text style={styles.muted}>{p.address}</Text>
                </View>
                {current?.address === p.address ? (
                  <Ionicons name="checkmark-circle" size={22} color={colors.brandPrimary} />
                ) : (
                  <Ionicons name="chevron-forward" size={20} color={colors.muted} />
                )}
              </Pressable>
            ))}
          </View>
        ) : null}

        {found.length > 0 ? (
          <View style={styles.card} testID="found-list">
            <Text style={styles.cardTitle}>Ditemukan di sekitar</Text>
            <Text style={[styles.muted, { marginBottom: 10 }]}>Pair device di pengaturan Bluetooth Android dulu untuk hasil terbaik.</Text>
            {found.map((p) => (
              <Pressable key={p.address} testID={`pick-found-${p.address}`} onPress={() => pickPrinter(p)} style={styles.listRow}>
                <View style={styles.settingIcon}><Ionicons name="bluetooth-outline" size={20} color={colors.info} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.productName}>{p.name}</Text>
                  <Text style={styles.muted}>{p.address}</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.muted} />
              </Pressable>
            ))}
          </View>
        ) : null}

        <View style={[styles.card, { marginTop: 10 }]}>
          <Text style={styles.cardTitle}>Tips</Text>
          <Text style={[styles.muted, { marginTop: 6, lineHeight: 20 }]}>
            • Printer thermal umum (Bellav, Panda, Xprinter, Rongta) biasanya pakai Bluetooth Classic SPP.{"\n"}
            • Pastikan Bluetooth HP & lokasi aktif saat scan.{"\n"}
            • Jika printer tidak muncul, pair dulu di pengaturan Android (biasanya PIN: 0000 / 1234).{"\n"}
            • Setelah printer tersimpan, tombol "Cetak Thermal" akan aktif di layar struk & riwayat.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
