import Ionicons from "@expo/vector-icons/Ionicons";
import { StyleSheet, Text, View } from "react-native";

import { useSync } from "@/src/sync-context";
import { useTheme } from "@/src/theme";

export function SyncBanner() {
  const { online, pending, flushing } = useSync();
  const { colors } = useTheme();
  if (online && pending === 0) return null;
  const bg = online ? colors.warning : colors.error;
  const text = online ? colors.onWarning : colors.onError;
  const label = flushing ? `Mengirim ${pending} data…` : online ? `${pending} data menunggu sync` : `Mode offline${pending ? ` · ${pending} antrian lokal` : ""}`;
  return (
    <View style={[styles.wrap, { backgroundColor: bg }]} testID="sync-banner">
      <Ionicons name={online ? "cloud-upload-outline" : "cloud-offline-outline"} size={16} color={text} />
      <Text style={[styles.label, { color: text }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12, marginBottom: 12 },
  label: { fontSize: 12, fontWeight: "800" },
});
