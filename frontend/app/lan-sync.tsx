import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAppStyles } from "@/src/app-styles";
import { Header } from "@/src/components/header";
import {
  DeviceMode,
  DiscoveredServer,
  getLanConfig,
  getLanSyncServerStatus,
  isDiscoveryAvailable,
  LanConfig,
  LAN_SYNC_PORT,
  pingLanSyncServer,
  publishLanService,
  scanLanServers,
  setLanConfig,
  startLanSyncServer,
  stopLanSyncServer,
  unpublishLanService,
} from "@/src/lan-sync";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";

const MODE_LABEL: Record<DeviceMode, { title: string; subtitle: string; icon: keyof typeof Ionicons.glyphMap }> = {
  mandiri: {
    title: "Mandiri (default)",
    subtitle: "HP ini menyimpan datanya sendiri. Tidak terhubung dengan perangkat lain.",
    icon: "phone-portrait-outline",
  },
  server: {
    title: "Server Utama",
    subtitle: "HP ini jadi pusat data. HP kasir lain terhubung ke sini via Wi-Fi/Tailscale.",
    icon: "server-outline",
  },
  client: {
    title: "Kasir Terhubung",
    subtitle: "HP ini mengambil data dari Server Utama. Butuh koneksi ke HP server.",
    icon: "cloud-outline",
  },
};

export default function LanSyncScreen() {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();

  const [config, setConfig] = useState<LanConfig | null>(null);
  const [serverStatus, setServerStatus] = useState<{ running: boolean; port: number | null }>({ running: false, port: null });
  const [scanning, setScanning] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoveredServer[]>([]);
  const [testing, setTesting] = useState(false);
  const [busy, setBusy] = useState(false);

  const refreshStatus = useCallback(() => {
    const s = getLanSyncServerStatus();
    setServerStatus({ running: s.running, port: s.port });
  }, []);

  useEffect(() => {
    getLanConfig().then(setConfig);
    refreshStatus();
    const t = setInterval(refreshStatus, 2000);
    return () => clearInterval(t);
  }, [refreshStatus]);

  if (!config) {
    return <View style={[styles.screen, { alignItems: "center", justifyContent: "center" }]}><ActivityIndicator color={colors.brandPrimary} /></View>;
  }

  const update = (patch: Partial<LanConfig>) => setConfig((c) => c ? { ...c, ...patch } : c);

  const changeMode = async (mode: DeviceMode) => {
    if (mode === config.mode) return;
    Alert.alert(
      "Ganti mode perangkat?",
      `Mode akan diubah ke "${MODE_LABEL[mode].title}". Aplikasi mungkin perlu memuat ulang data.`,
      [
        { text: "Batal", style: "cancel" },
        {
          text: "Ganti",
          onPress: async () => {
            setBusy(true);
            try {
              // Matikan server lama kalau pindah dari "server" ke mode lain
              if (config.mode === "server" && mode !== "server") {
                await stopLanSyncServer();
                unpublishLanService();
              }
              const next = await setLanConfig({ mode });
              setConfig(next);
              // Nyalakan server kalau pindah ke "server"
              if (mode === "server") {
                try {
                  await startLanSyncServer(next.server_port);
                  publishLanService(next.device_name || "JTPOIN Server", next.server_port).catch(() => undefined);
                  toast.success("Server LAN aktif", `Port ${next.server_port}`);
                } catch (e) {
                  toast.error("Gagal start server", e instanceof Error ? e.message : "Butuh build native");
                }
              }
              refreshStatus();
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  const saveConfig = async () => {
    setBusy(true);
    try {
      const next = await setLanConfig(config);
      setConfig(next);
      // Kalau server mode & port berubah, restart server
      if (next.mode === "server") {
        await stopLanSyncServer();
        unpublishLanService();
        await startLanSyncServer(next.server_port);
        publishLanService(next.device_name || "JTPOIN Server", next.server_port).catch(() => undefined);
        refreshStatus();
      }
      toast.success("Pengaturan tersimpan");
    } catch (e) {
      toast.error("Gagal menyimpan", e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const scanServers = async () => {
    if (!isDiscoveryAvailable()) {
      toast.info("Discovery tidak aktif", "Fitur mDNS butuh build native (bukan Expo Go).");
      return;
    }
    setScanning(true);
    setDiscovered([]);
    try {
      const list = await scanLanServers(4500);
      setDiscovered(list);
      if (list.length === 0) toast.info("Tidak ada server ditemukan", "Pastikan HP server menyala & jaringan sama.");
    } catch (e) {
      toast.error("Gagal scan", e instanceof Error ? e.message : undefined);
    } finally {
      setScanning(false);
    }
  };

  const testConnection = async () => {
    if (!config.server_host.trim()) return toast.error("Alamat server kosong");
    setTesting(true);
    try {
      const result = await pingLanSyncServer(config.server_host, config.server_port, 4000);
      if (result.ok) toast.success("Terhubung ke server", `Service: ${result.service ?? "jtpoin"}`);
      else toast.error("Server tidak merespon", result.error || "cek IP & jaringan");
    } finally {
      setTesting(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 10, paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">
        <View style={styles.between}>
          <Header title="Sinkronisasi Jaringan" subtitle="LAN · Tailscale · Multi-perangkat" />
          <Pressable onPress={() => router.back()}><Ionicons name="chevron-back" size={26} color={colors.onSurface} /></Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Mode perangkat</Text>
          <Text style={[styles.muted, { marginBottom: 12 }]}>Pilih peran HP ini di jaringan toko.</Text>
          {(Object.keys(MODE_LABEL) as DeviceMode[]).map((m) => {
            const info = MODE_LABEL[m];
            const selected = config.mode === m;
            return (
              <Pressable
                key={m}
                testID={`mode-${m}`}
                onPress={() => changeMode(m)}
                style={[styles.listRow, selected && { backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandPrimary }]}
              >
                <View style={styles.settingIcon}><Ionicons name={info.icon} size={20} color={colors.brandPrimary} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.productName}>{info.title}</Text>
                  <Text style={styles.muted}>{info.subtitle}</Text>
                </View>
                {selected ? <Ionicons name="checkmark-circle" size={22} color={colors.brandPrimary} /> : null}
              </Pressable>
            );
          })}
        </View>

        {config.mode === "server" ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Server Utama</Text>
            <View style={[styles.listRow, { backgroundColor: serverStatus.running ? colors.success + "22" : colors.warning + "22" }]}>
              <View style={styles.settingIcon}>
                <Ionicons name={serverStatus.running ? "radio-outline" : "warning-outline"} size={20} color={serverStatus.running ? colors.success : colors.warning} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.productName}>{serverStatus.running ? "Aktif" : "Belum berjalan"}</Text>
                <Text style={styles.muted}>{serverStatus.running ? `Mendengarkan di port ${serverStatus.port}` : "Tap 'Simpan' untuk memulai, atau restart aplikasi."}</Text>
              </View>
            </View>
            <Text style={[styles.inputLabel, { marginTop: 12 }]}>Nama perangkat (muncul di HP kasir)</Text>
            <TextInput
              testID="server-device-name"
              value={config.device_name}
              onChangeText={(t) => update({ device_name: t })}
              placeholder="JTPOIN Server"
              placeholderTextColor={colors.muted}
              style={styles.input}
            />
            <Text style={styles.inputLabel}>Port TCP</Text>
            <TextInput
              testID="server-port"
              value={String(config.server_port)}
              onChangeText={(t) => update({ server_port: Number(t.replace(/\D/g, "")) || LAN_SYNC_PORT })}
              keyboardType="number-pad"
              style={styles.input}
            />
            <Text style={[styles.muted, { lineHeight: 20 }]}>
              💡 Pastikan HP ini tidak diam/sleep. Buka WhatsApp → Settings → Battery → kecualikan aplikasi ini dari penghemat baterai agar server tetap aktif.
            </Text>
            <Pressable testID="save-server" disabled={busy} onPress={saveConfig} style={[styles.primaryButton, busy && { opacity: 0.5 }, { marginTop: 12 }]}>
              <Text style={styles.primaryButtonText}>{busy ? "Menyimpan…" : "Simpan & restart server"}</Text>
            </Pressable>
          </View>
        ) : null}

        {config.mode === "client" ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Kasir Terhubung</Text>
            <Text style={styles.inputLabel}>Alamat server (IP LAN atau Tailscale IP)</Text>
            <TextInput
              testID="client-host"
              value={config.server_host}
              onChangeText={(t) => update({ server_host: t })}
              placeholder="192.168.1.5 atau 100.64.x.x"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
            />
            <Text style={styles.inputLabel}>Port</Text>
            <TextInput
              testID="client-port"
              value={String(config.server_port)}
              onChangeText={(t) => update({ server_port: Number(t.replace(/\D/g, "")) || LAN_SYNC_PORT })}
              keyboardType="number-pad"
              style={styles.input}
            />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable testID="test-connection" disabled={testing} onPress={testConnection} style={[styles.outlineButton, { flex: 1 }, testing && { opacity: 0.5 }]}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, justifyContent: "center" }}>
                  {testing ? <ActivityIndicator color={colors.brandPrimary} size="small" /> : <Ionicons name="wifi-outline" size={16} color={colors.brandPrimary} />}
                  <Text style={styles.outlineText}>{testing ? "Testing…" : "Tes koneksi"}</Text>
                </View>
              </Pressable>
              <Pressable testID="save-client" disabled={busy} onPress={saveConfig} style={[styles.primaryButton, { flex: 1 }, busy && { opacity: 0.5 }]}>
                <Text style={styles.primaryButtonText}>Simpan</Text>
              </Pressable>
            </View>

            <View style={{ marginTop: 16 }}>
              <View style={styles.between}>
                <Text style={styles.cardTitle}>Cari server di Wi-Fi</Text>
                <Pressable testID="scan-servers" disabled={scanning} onPress={scanServers} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  {scanning ? <ActivityIndicator color={colors.brandPrimary} size="small" /> : <Ionicons name="scan-outline" size={18} color={colors.brandPrimary} />}
                  <Text style={{ color: colors.brandPrimary, fontWeight: "800" }}>{scanning ? "Scanning…" : "Scan"}</Text>
                </Pressable>
              </View>
              {discovered.length ? discovered.map((s, i) => (
                <Pressable
                  key={`${s.host}:${s.port}:${i}`}
                  onPress={() => update({ server_host: s.host, server_port: s.port })}
                  style={[styles.listRow, { marginTop: 8 }]}
                >
                  <View style={styles.settingIcon}><Ionicons name="radio-outline" size={18} color={colors.brandPrimary} /></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.productName}>{s.name}</Text>
                    <Text style={styles.muted}>{s.host}:{s.port}</Text>
                  </View>
                  <Ionicons name="arrow-forward" size={18} color={colors.muted} />
                </Pressable>
              )) : (
                <Text style={[styles.muted, { marginTop: 8 }]}>Belum ada hasil. Pastikan HP server aktif & di jaringan Wi-Fi sama.</Text>
              )}
            </View>
          </View>
        ) : null}

        <Pressable testID="open-tailscale-guide" onPress={() => router.push("/tailscale-guide" as any)} style={[styles.card, { flexDirection: "row", alignItems: "center" }]}>
          <View style={styles.settingIcon}><Ionicons name="globe-outline" size={22} color={colors.brandPrimary} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.productName}>Panduan akses jarak jauh (Tailscale)</Text>
            <Text style={styles.muted}>Hubungkan HP kasir dari luar toko tanpa buka port router.</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.muted} />
        </Pressable>

        <View style={[styles.card, { backgroundColor: colors.warning + "15" }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <Ionicons name="information-circle-outline" size={18} color={colors.warning} />
            <Text style={[styles.cardTitle, { color: colors.warning }]}>Catatan</Text>
          </View>
          <Text style={[styles.muted, { lineHeight: 20 }]}>
            • Fitur ini butuh build APK/IPA (tidak jalan di Expo Go/preview web).{"\n"}
            • Server Utama harus tetap menyala & aplikasi terbuka.{"\n"}
            • Mode {`"Kasir Terhubung"`} tidak bisa jualan kalau Server mati — pastikan HP server stabil.{"\n"}
            • Login username/password tetap sama (akun yang terdaftar di Server Utama).
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
