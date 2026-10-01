import { Redirect } from "expo-router";
import { ActivityIndicator, Text, View } from "react-native";

import { useAuth } from "@/src/auth-context";
import { useTheme } from "@/src/theme";

export default function Index() {
  const { user, booting } = useAuth();
  const { colors } = useTheme();
  if (booting) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface }}>
        <ActivityIndicator size="large" color={colors.brandPrimary} />
        <Text style={{ color: colors.muted, marginTop: 12 }} testID="splash-text">Menyiapkan KasirKu Pro…</Text>
      </View>
    );
  }
  return user ? <Redirect href="/(tabs)" /> : <Redirect href="/login" />;
}
