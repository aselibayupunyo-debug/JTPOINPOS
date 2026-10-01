import Ionicons from "@expo/vector-icons/Ionicons";
import * as Linking from "expo-linking";
import * as Sharing from "expo-sharing";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, Share, Text, View } from "react-native";import { useSafeAreaInsets } from "react-native-safe-area-context";
import ViewShot, { captureRef } from "react-native-view-shot";

import { apiRequest, BusinessSettings, formatRupiah, PAYMENT_LABELS, TransactionDoc } from "@/src/api";
import { useAppStyles } from "@/src/app-styles";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";

export default function ReceiptScreen() {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [tx, setTx] = useState<TransactionDoc | null>(null);
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const shotRef = useRef<ViewShot>(null);

  useEffect(() => {
    if (!id) return;
    Promise.all([apiRequest<TransactionDoc>(`/transactions/${id}`), apiRequest<BusinessSettings>("/settings")])
      .then(([t, s]) => { setTx(t); setSettings(s); })
      .catch((e) => toast.error("Gagal memuat struk", e instanceof Error ? e.message : undefined));
  }, [id, toast]);

  if (!tx || !settings) {
    return <View style={[styles.screen, { alignItems: "center", justifyContent: "center" }]}><ActivityIndicator color={colors.brandPrimary} /></View>;
  }

  const headerLines = (settings.header_lines ?? []).filter(Boolean).slice(0, 4);
  const footerLines = (settings.footer_lines ?? []).filter(Boolean).slice(0, 4);
  const effectiveFooter = footerLines.length ? footerLines : (settings.footer_note ? [settings.footer_note] : []);

  const buildReceiptText = () => {
    const lines: string[] = [];
    lines.push(settings.business_name);
    if (headerLines.length) headerLines.forEach((l) => lines.push(l));
    else {
      if (settings.address) lines.push(settings.address);
      if (settings.phone) lines.push("Telp: " + settings.phone);
    }
    lines.push("─────────────────────");
    lines.push(`${tx.invoice_no}`);
    lines.push(`${new Date(tx.created_at).toLocaleString("id-ID")}`);
    lines.push(`Pelanggan: ${tx.customer_name}`);
    if (tx.created_by_name) lines.push(`Kasir: ${tx.created_by_name}`);
    lines.push("─────────────────────");
    tx.items.forEach((i) => {
      lines.push(`${i.name}${i.unit ? ` (${i.unit})` : ""}`);
      lines.push(`  ${i.quantity} x ${formatRupiah(i.price)}   ${formatRupiah(i.price * i.quantity)}`);
      if (i.discount) lines.push(`  Diskon: -${formatRupiah(i.discount)}`);
    });
    lines.push("─────────────────────");
    if (tx.subtotal && tx.subtotal !== tx.total) lines.push(`Subtotal     ${formatRupiah(tx.subtotal)}`);
    if (tx.global_discount) lines.push(`Diskon       -${formatRupiah(tx.global_discount)}`);
    if (tx.tax_amount) lines.push(`${settings.tax_label || "Pajak"} ${tx.tax_percent}%    ${formatRupiah(tx.tax_amount)}`);
    if (tx.shipping) lines.push(`Ongkir       ${formatRupiah(tx.shipping)}`);
    lines.push(`TOTAL        ${formatRupiah(tx.total)}`);
    lines.push(`Metode       ${tx.payment_method_label || PAYMENT_LABELS[tx.payment_method] || tx.payment_method}`);
    if (tx.paid_amount) lines.push(`Dibayar      ${formatRupiah(tx.paid_amount)}`);
    if (tx.outstanding) lines.push(`Sisa Hutang  ${formatRupiah(tx.outstanding)}`);
    if (tx.paid_amount - tx.total > 0) lines.push(`Kembalian    ${formatRupiah(tx.paid_amount - tx.total)}`);
    if (effectiveFooter.length) { lines.push(""); effectiveFooter.forEach((l) => lines.push(l)); }
    return lines.join("\n");
  };

  const message = buildReceiptText();

  const shareWhatsApp = async () => {
    const encoded = encodeURIComponent(message);
    const target = settings.whatsapp_number?.replace(/\D/g, "");
    const url = target ? `whatsapp://send?phone=${target}&text=${encoded}` : `whatsapp://send?text=${encoded}`;
    const canOpen = await Linking.canOpenURL(url);
    if (canOpen) return Linking.openURL(url);
    await Share.share({ message });
  };

  const shareAsImage = async () => {
    try {
      if (Platform.OS === "web") return toast.info("Fitur JPEG hanya di aplikasi mobile", "Build Expo Go / produksi untuk mencoba.");
      if (!shotRef.current) return;
      const uri = await captureRef(shotRef, { format: "jpg", quality: 0.95, result: "tmpfile" });
      if (!(await Sharing.isAvailableAsync())) return toast.info("Share tidak tersedia");
      await Sharing.shareAsync(uri, { mimeType: "image/jpeg", dialogTitle: "Kirim struk sebagai JPEG" });
    } catch (e) {
      toast.error("Gagal membuat JPEG", e instanceof Error ? e.message : undefined);
    }
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.between}>
          <Text style={[styles.title, { fontSize: 22 }]}>Preview struk</Text>
          <Pressable onPress={() => router.back()}><Ionicons name="close" size={26} color={colors.onSurface} /></Pressable>
        </View>
        <ViewShot ref={shotRef} options={{ format: "jpg", quality: 0.95 }} style={{ backgroundColor: colors.surface }}>
          <View style={[styles.card, { alignItems: "center" }]}>
            {settings.logo_base64 ? (
              <Image source={{ uri: `data:image/jpeg;base64,${settings.logo_base64}` }} style={{ width: 80, height: 80, borderRadius: 12, marginBottom: 10 }} />
            ) : null}
            <Text style={[styles.cardTitle, { fontSize: 18 }]}>{settings.business_name}</Text>
            {headerLines.length ? headerLines.map((l, i) => <Text key={`h${i}`} style={styles.muted}>{l}</Text>) : (
              <>
                {settings.address ? <Text style={styles.muted}>{settings.address}</Text> : null}
                {settings.phone ? <Text style={styles.muted}>Telp: {settings.phone}</Text> : null}
              </>
            )}
            <View style={{ height: 1, backgroundColor: colors.divider, alignSelf: "stretch", marginVertical: 12 }} />
            <Text style={[styles.muted, { alignSelf: "stretch" }]}>Invoice: {tx.invoice_no}</Text>
            <Text style={[styles.muted, { alignSelf: "stretch" }]}>{new Date(tx.created_at).toLocaleString("id-ID")}</Text>
            <Text style={[styles.muted, { alignSelf: "stretch" }]}>Pelanggan: {tx.customer_name}</Text>
            {tx.created_by_name ? <Text style={[styles.muted, { alignSelf: "stretch" }]}>Kasir: {tx.created_by_name}</Text> : null}
            <View style={{ height: 1, backgroundColor: colors.divider, alignSelf: "stretch", marginVertical: 12 }} />
            {tx.items.map((i, idx) => (
              <View key={idx} style={{ alignSelf: "stretch", marginBottom: 6 }}>
                <Text style={styles.productName}>{i.name}{i.unit ? ` (${i.unit})` : ""}</Text>
                <View style={styles.between}>
                  <Text style={styles.muted}>{i.quantity} × {formatRupiah(i.price)}</Text>
                  <Text style={styles.productName}>{formatRupiah(i.price * i.quantity)}</Text>
                </View>
                {i.discount ? <Text style={{ color: colors.warning, fontSize: 12 }}>Diskon -{formatRupiah(i.discount)}</Text> : null}
              </View>
            ))}
            <View style={{ height: 1, backgroundColor: colors.divider, alignSelf: "stretch", marginVertical: 12 }} />
            {tx.subtotal && tx.subtotal !== tx.total ? (
              <View style={[styles.between, { alignSelf: "stretch" }]}>
                <Text style={styles.muted}>Subtotal</Text>
                <Text style={styles.muted}>{formatRupiah(tx.subtotal)}</Text>
              </View>
            ) : null}
            {tx.global_discount ? (
              <View style={[styles.between, { alignSelf: "stretch" }]}>
                <Text style={styles.muted}>Diskon{tx.discount_percent ? ` ${tx.discount_percent}%` : ""}</Text>
                <Text style={styles.muted}>-{formatRupiah(tx.global_discount)}</Text>
              </View>
            ) : null}
            {tx.tax_amount ? (
              <View style={[styles.between, { alignSelf: "stretch" }]}>
                <Text style={styles.muted}>{settings.tax_label || "Pajak"} {tx.tax_percent}%</Text>
                <Text style={styles.muted}>{formatRupiah(tx.tax_amount)}</Text>
              </View>
            ) : null}
            {tx.shipping ? (
              <View style={[styles.between, { alignSelf: "stretch" }]}>
                <Text style={styles.muted}>Ongkir</Text>
                <Text style={styles.muted}>{formatRupiah(tx.shipping)}</Text>
              </View>
            ) : null}
            <View style={[styles.between, { alignSelf: "stretch", marginTop: 8 }]}>
              <Text style={styles.cardTitle}>Total</Text>
              <Text style={[styles.cardTitle, { color: colors.brandPrimary }]}>{formatRupiah(tx.total)}</Text>
            </View>
            <Text style={[styles.muted, { alignSelf: "stretch", marginTop: 8 }]}>Pembayaran: {tx.payment_method_label || PAYMENT_LABELS[tx.payment_method] || tx.payment_method}</Text>
            {tx.outstanding > 0 ? <Text style={{ color: colors.warning, fontWeight: "800", alignSelf: "stretch", marginTop: 4 }}>Sisa hutang: {formatRupiah(tx.outstanding)}</Text> : null}
            {effectiveFooter.length ? (
              <View style={{ marginTop: 14, alignItems: "center", alignSelf: "stretch" }}>
                {effectiveFooter.map((l, i) => (<Text key={`fl${i}`} style={[styles.muted, { textAlign: "center" }]}>{l}</Text>))}
              </View>
            ) : null}
            <Text style={[styles.muted, { marginTop: 6 }]}>Lebar struk: {settings.receipt_width}</Text>
          </View>
        </ViewShot>
        <View style={{ gap: 10 }}>
          <Pressable testID="share-whatsapp" onPress={shareWhatsApp} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Kirim via WhatsApp</Text>
          </Pressable>
          <Pressable testID="share-jpeg" onPress={shareAsImage} style={styles.outlineButton}>
            <Text style={styles.outlineText}>Kirim struk sebagai JPEG</Text>
          </Pressable>
          <View style={[styles.card, { marginTop: 8 }]}>
            <View style={styles.row}>
              <Ionicons name="print-outline" size={22} color={colors.brandPrimary} />
              <Text style={[styles.productName, { marginLeft: 10 }]}>Cetak thermal {settings.receipt_width}</Text>
            </View>
            <Text style={[styles.muted, { marginTop: 6 }]}>Cetak langsung ke printer Bluetooth (ESC/POS) & multi-printer dapur aktif pada build Android produksi. Setelah publish, tombol cetak akan muncul di sini.</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
