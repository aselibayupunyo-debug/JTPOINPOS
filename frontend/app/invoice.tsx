import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import WebView from "react-native-webview";

import { apiRequest, BusinessSettings, TransactionDoc } from "@/src/api";
import { useAppStyles } from "@/src/app-styles";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";
import { buildInvoiceHtml, shareInvoicePdf } from "@/src/pdf";

export default function InvoiceScreen() {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [tx, setTx] = useState<TransactionDoc | null>(null);
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    Promise.all([apiRequest<TransactionDoc>(`/transactions/${id}`), apiRequest<BusinessSettings>("/settings")])
      .then(([t, s]) => { setTx(t); setSettings(s); })
      .catch((e) => toast.error("Gagal memuat invoice", e instanceof Error ? e.message : undefined));
  }, [id, toast]);

  if (!tx || !settings) return <View style={[styles.screen, { alignItems: "center", justifyContent: "center" }]}><ActivityIndicator color={colors.brandPrimary} /></View>;

  const html = buildInvoiceHtml(tx, settings);

  const share = async (channel: "share" | "whatsapp" | "email") => {
    setBusy(channel);
    try { await shareInvoicePdf(tx, settings, channel); }
    catch (e) { toast.error("Gagal", e instanceof Error ? e.message : undefined); }
    finally { setBusy(null); }
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={[styles.between, { paddingHorizontal: 20, paddingVertical: 10 }]}>
        <Text style={[styles.title, { fontSize: 22 }]}>Invoice PDF</Text>
        <Pressable onPress={() => router.back()}><Ionicons name="close" size={26} color={colors.onSurface} /></Pressable>
      </View>
      <View style={{ flex: 1, marginHorizontal: 20, marginBottom: 10, backgroundColor: colors.surfaceSecondary, borderRadius: 14, overflow: "hidden" }}>
        <WebView originWhitelist={["*"]} source={{ html }} style={{ flex: 1 }} />
      </View>
      <View style={{ padding: 20, gap: 10 }}>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Pressable testID="pdf-whatsapp" disabled={!!busy} onPress={() => share("whatsapp")} style={[styles.primaryButton, { flex: 1 }, busy && { opacity: 0.5 }]}>
            {busy === "whatsapp" ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryButtonText}>Kirim WhatsApp</Text>}
          </Pressable>
          <Pressable testID="pdf-email" disabled={!!busy} onPress={() => share("email")} style={[styles.outlineButton, { flex: 1 }, busy && { opacity: 0.5 }]}>
            {busy === "email" ? <ActivityIndicator color={colors.brandPrimary} /> : <Text style={styles.outlineText}>Kirim Email</Text>}
          </Pressable>
        </View>
        <Pressable testID="pdf-share" disabled={!!busy} onPress={() => share("share")} style={[styles.outlineButton, busy && { opacity: 0.5 }]}>
          <Text style={styles.outlineText}>Bagikan / Cetak PDF</Text>
        </Pressable>
      </View>
    </View>
  );
}
