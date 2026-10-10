/**
 * Banner mode LAN untuk header Kasir / layar utama.
 *
 * Menampilkan badge dengan status:
 * - SERVER     : HP ini pusat data (hijau brand + dot online/offline sesuai TCP server)
 * - KASIR      : HP terhubung ke Server Utama (biru info + dot online = ping ok)
 * - MANDIRI    : tidak dirender (default, agar tidak mengganggu tampilan)
 *
 * Didesain compact (height ~26px) agar tidak memakan ruang di header.
 */
import Ionicons from "@expo/vector-icons/Ionicons";
import { StyleSheet, Text, View } from "react-native";

import { useLanMode } from "@/src/lan-sync/use-lan-mode";
import { useTheme } from "@/src/theme";

export function LanModeBanner({ compact = false }: { compact?: boolean }) {
  const { mode, connectivity, serverHost, serverPort } = useLanMode();
  const { colors } = useTheme();

  if (mode === "mandiri") return null;

  const isServer = mode === "server";
  const bg = isServer ? colors.brandTertiary : colors.info + "22"; // 22 = alpha ~13%
  const fg = isServer ? colors.brandPrimary : colors.info;
  const borderColor = isServer ? colors.brandPrimary : colors.info;

  const dotColor =
    connectivity === "online" ? colors.success :
    connectivity === "checking" ? colors.warning :
    colors.error;

  const label = isServer ? "SERVER" : "KASIR TERHUBUNG";
  const detail = isServer
    ? (connectivity === "online" ? `Port ${serverPort} · menerima koneksi` : "Server tidak aktif · restart aplikasi")
    : (serverHost ? `${serverHost}:${serverPort}` : "Alamat belum diatur");

  const statusLabel =
    connectivity === "online" ? (isServer ? "Aktif" : "Terhubung") :
    connectivity === "checking" ? "Mengecek…" :
    connectivity === "offline" ? (isServer ? "Mati" : "Terputus") :
    "Idle";

  return (
    <View
      testID="lan-mode-banner"
      style={[
        styles.wrap,
        { backgroundColor: bg, borderColor },
        compact && styles.wrapCompact,
      ]}
    >
      <Ionicons name={isServer ? "server-outline" : "wifi-outline"} size={14} color={fg} />
      <Text style={[styles.label, { color: fg }]} numberOfLines={1}>{label}</Text>
      <View style={styles.sep} />
      <Text style={[styles.detail, { color: fg }]} numberOfLines={1}>{detail}</Text>
      <View style={styles.statusWrap}>
        <View style={[styles.dot, { backgroundColor: dotColor }]} />
        <Text style={[styles.statusText, { color: fg }]}>{statusLabel}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 10,
  },
  wrapCompact: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    marginBottom: 6,
  },
  label: { fontSize: 11, fontWeight: "800", letterSpacing: 0.4 },
  sep: { width: 1, height: 10, backgroundColor: "rgba(0,0,0,0.1)", marginHorizontal: 2 },
  detail: { fontSize: 11, fontWeight: "600", flex: 1 },
  statusWrap: { flexDirection: "row", alignItems: "center", gap: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 11, fontWeight: "700" },
});
