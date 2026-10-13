import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text } from "react-native";

import { useLicense } from "@/src/license";
import { useTheme } from "@/src/theme";

export function LicenseBanner() {
  const { status } = useLicense();
  const { colors } = useTheme();
  if (!status || status.activated) return null;
  const bg = status.expired ? colors.error : colors.warning;
  const fg = status.expired ? colors.onError : colors.onWarning;
  const label = status.expired
    ? "Masa demo habis · Hanya lihat data. Ketuk untuk aktivasi"
    : `Mode Demo · sisa ${status.daysLeft} hari. Ketuk untuk aktivasi`;
  return (
    <Pressable testID="license-banner" onPress={() => router.push("/activation")} style={[styles.wrap, { backgroundColor: bg }]}>
      <Ionicons name={status.expired ? "lock-closed-outline" : "hourglass-outline"} size={16} color={fg} />
      <Text style={[styles.label, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 14, minHeight: 44, borderRadius: 12, marginBottom: 12 },
  label: { fontSize: 12, fontWeight: "800", flexShrink: 1 },
});
