import Ionicons from "@expo/vector-icons/Ionicons";
import * as Print from "expo-print";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Share, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest, BusinessSettings, formatRupiah, PAYMENT_LABELS, PaymentMethod, PaymentMethodDoc, TransactionDoc } from "@/src/api";
import { useAppStyles } from "@/src/app-styles";
import { Header } from "@/src/components/header";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";

type Kind = "receivable" | "payable";

export default function DebtsScreen() {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [kind, setKind] = useState<Kind>("receivable");
  const [data, setData] = useState<{ total: number; items: TransactionDoc[] }>({ total: 0, items: [] });
  const [active, setActive] = useState<TransactionDoc | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [methodLabel, setMethodLabel] = useState<string>(PAYMENT_LABELS.cash);
  const [methods, setMethods] = useState<PaymentMethodDoc[]>([]);
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (k: Kind) => {
    try { setData(await apiRequest<{ total: number; items: TransactionDoc[] }>(`/debts?kind=${k}`)); }
    catch (e) { toast.error("Gagal memuat", e instanceof Error ? e.message : undefined); }
  }, [toast]);
  useEffect(() => { load(kind); }, [kind, load]);
  useEffect(() => {
    apiRequest<PaymentMethodDoc[]>("/payment-methods").then(setMethods).catch(() => undefined);
    apiRequest<BusinessSettings>("/settings").then(setSettings).catch(() => undefined);
  }, []);

  const buildReceiptHtml = (tx: TransactionDoc, paidAmount: number, paymentLabel: string, remaining: number): string => {
    const biz = settings?.business_name ?? "Toko";
    const header = (settings?.header_lines ?? []).slice(0, 4).map((l) => `<div>${l.replace(/</g, "&lt;")}</div>`).join("");
    const footer = (settings?.footer_lines ?? []).slice(0, 4).map((l) => `<div>${l.replace(/</g, "&lt;")}</div>`).join("");
    const title = kind === "receivable" ? "TANDA TERIMA PIUTANG" : "BUKTI BAYAR HUTANG";
    return `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><style>
      body { font-family: -apple-system, Arial, sans-serif; width: 58mm; padding: 6px; margin: 0; }
      .center { text-align:center; }
      .biz { font-size: 14px; font-weight: 800; }
      .title { font-size: 12px; font-weight: 900; margin-top: 6px; letter-spacing: 0.6px; }
      .meta { font-size: 10px; color: #333; }
      .sep { border-top: 1px dashed #000; margin: 8px 0; }
      .row { display: flex; justify-content: space-between; font-size: 10px; margin: 3px 0; }
      .total { font-size: 13px; font-weight: 900; }
      .footer { font-size: 9px; text-align: center; margin-top: 10px; color: #555; }
    </style></head><body>
      <div class="center biz">${biz}</div>
      <div class="center meta">${header}</div>
      <div class="center title">${title}</div>
      <div class="sep"></div>
      <div class="row"><span>Invoice</span><span>${tx.invoice_no}</span></div>
      <div class="row"><span>Tanggal</span><span>${new Date().toLocaleString("id-ID")}</span></div>
      <div class="row"><span>${kind === "receivable" ? "Pelanggan" : "Supplier"}</span><span>${tx.customer_name}</span></div>
      <div class="row"><span>Total Transaksi</span><span>${formatRupiah(tx.total)}</span></div>
      <div class="row"><span>Metode</span><span>${paymentLabel}</span></div>
      <div class="sep"></div>
      <div class="row total"><span>DIBAYAR</span><span>${formatRupiah(paidAmount)}</span></div>
      <div class="row"><span>Sisa</span><span>${formatRupiah(remaining)}</span></div>
      <div class="sep"></div>
      <div class="footer">${footer || "Terima kasih"}</div>
    </body></html>`;
  };

  const pay = async () => {
    if (!active) return;
    const num = Number(amount.replace(/\D/g, ""));
    if (!num) return toast.error("Nominal tidak valid");
    setBusy(true);
    try {
      const res = await apiRequest<{ outstanding: number; payment_id: string }>(`/transactions/${active.id}/pay`, {
        method: "POST",
        body: JSON.stringify({ amount: num, payment_method: method, payment_method_label: methodLabel, note }),
      });
      toast.success("Pembayaran dicatat", `${formatRupiah(num)} · ${methodLabel}`);
      const txSnapshot = active;
      const remaining = res.outstanding;
      setActive(null); setAmount(""); setNote("");
      await load(kind);
      // Prompt to print receipt
      Alert.alert("Cetak tanda terima?", `Pembayaran ${formatRupiah(num)} tercatat.`, [
        { text: "Nanti", style: "cancel" },
        {
          text: "Cetak / Bagikan",
          onPress: async () => {
            try {
              const html = buildReceiptHtml(txSnapshot, num, methodLabel, remaining);
              await Print.printAsync({ html });
            } catch (e) { toast.error("Cetak gagal", e instanceof Error ? e.message : undefined); }
          },
        },
        {
          text: "Kirim WA",
          onPress: () => {
            const msg = `*${kind === "receivable" ? "TANDA TERIMA PIUTANG" : "BUKTI BAYAR HUTANG"}*\n${settings?.business_name ?? ""}\nInvoice: ${txSnapshot.invoice_no}\nTanggal: ${new Date().toLocaleString("id-ID")}\n${kind === "receivable" ? "Pelanggan" : "Supplier"}: ${txSnapshot.customer_name}\nDibayar: *${formatRupiah(num)}* via ${methodLabel}\nSisa: ${formatRupiah(remaining)}\n\nTerima kasih.`;
            Share.share({ message: msg });
          },
        },
      ]);
    } catch (e) { toast.error("Gagal", e instanceof Error ? e.message : undefined); }
    finally { setBusy(false); }
  };

  // Semua metode pembayaran AKTIF yang tersedia KECUALI kredit (karena ini melunasi kredit)
  const paymentOptions: { id: string; kind: PaymentMethod; label: string }[] = methods
    .filter((m) => m.enabled !== false && m.kind !== "credit")
    .map((m) => ({ id: m.id, kind: m.id as PaymentMethod, label: m.name || PAYMENT_LABELS[m.kind] || m.kind }));
  // Fallback jika belum ada data metode: minimal tunai
  if (paymentOptions.length === 0) {
    paymentOptions.push({ id: "cash", kind: "cash", label: PAYMENT_LABELS.cash });
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.between}>
          <Header title="Hutang & Piutang" subtitle="Lunasi transaksi kredit yang masih berjalan" />
          <Pressable onPress={() => router.back()}><Ionicons name="chevron-back" size={26} color={colors.onSurface} /></Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {([{ key: "receivable", label: "Piutang" }, { key: "payable", label: "Hutang" }] as { key: Kind; label: string }[]).map((item) => (
            <Pressable key={item.key} testID={`debt-${item.key}`} onPress={() => setKind(item.key)} style={[styles.chip, kind === item.key && styles.chipActive]}>
              <Text style={[styles.chipText, kind === item.key && styles.chipTextActive]}>{item.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <View style={styles.greenCard}>
          <Text style={styles.white}>Total {kind === "receivable" ? "piutang" : "hutang"}</Text>
          <Text style={styles.bigWhite}>{formatRupiah(data.total)}</Text>
          <Text style={[styles.white, { opacity: 0.78, marginTop: 6 }]}>{data.items.length} transaksi aktif</Text>
        </View>
        {data.items.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="checkmark-done-circle-outline" size={44} color={colors.success} />
            <Text style={[styles.muted, { marginTop: 10 }]}>Semua lunas! Tidak ada {kind === "receivable" ? "piutang" : "hutang"}.</Text>
          </View>
        ) : data.items.map((tx) => (
          <View key={tx.id} style={styles.card}>
            <View style={styles.between}>
              <View style={{ flex: 1 }}>
                <Text style={styles.productName}>{tx.customer_name}</Text>
                <Text style={styles.muted}>{tx.invoice_no} · {new Date(tx.created_at).toLocaleDateString("id-ID")}</Text>
              </View>
              <Text style={[styles.cardTitle, { color: colors.warning }]}>{formatRupiah(tx.outstanding)}</Text>
            </View>
            <Pressable testID={`pay-${tx.id}`} onPress={() => {
              setActive(tx);
              setAmount(String(tx.outstanding));
              const first = paymentOptions[0];
              if (first) { setMethod(first.kind); setMethodLabel(first.label); }
            }} style={[styles.primaryButton, { marginTop: 10 }]}>
              <Text style={styles.primaryButtonText}>Catat pembayaran</Text>
            </Pressable>
          </View>
        ))}
      </ScrollView>
      <Modal visible={!!active} transparent animationType="slide" onRequestClose={() => setActive(null)}>
        <View style={{ flex: 1, backgroundColor: "rgba(28,28,30,0.55)", justifyContent: "flex-end" }}>
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 20, paddingBottom: insets.bottom + 20 }}>
            <View style={styles.between}>
              <Text style={[styles.title, { fontSize: 20 }]}>Pembayaran {kind === "receivable" ? "Piutang" : "Hutang"}</Text>
              <Pressable onPress={() => setActive(null)}><Ionicons name="close" size={24} color={colors.onSurface} /></Pressable>
            </View>
            {active ? (
              <ScrollView keyboardShouldPersistTaps="handled">
                <Text style={[styles.muted, { marginVertical: 8 }]}>{active.customer_name} · {active.invoice_no}</Text>
                <Text style={[styles.cardTitle, { color: colors.warning, marginBottom: 14 }]}>Sisa {formatRupiah(active.outstanding)}</Text>
                <Text style={styles.inputLabel}>Nominal</Text>
                <TextInput testID="pay-amount" value={amount} onChangeText={setAmount} keyboardType="number-pad" style={styles.input} placeholderTextColor={colors.muted} />
                <Text style={styles.inputLabel}>Metode pembayaran</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                  {paymentOptions.map((opt, idx) => (
                    <Pressable
                      key={`${opt.kind}-${idx}`}
                      testID={`pay-method-${opt.kind}`}
                      onPress={() => { setMethod(opt.kind); setMethodLabel(opt.label); }}
                      style={[{ paddingHorizontal: 14, minHeight: 44, borderRadius: 12, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" }, method === opt.kind && { backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandPrimary }]}
                    >
                      <Text style={{ color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "800" }}>{opt.label}</Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={styles.inputLabel}>Catatan</Text>
                <TextInput value={note} onChangeText={setNote} style={styles.input} placeholder="Opsional" placeholderTextColor={colors.muted} />
                <Pressable testID="pay-submit" disabled={busy} onPress={pay} style={[styles.primaryButton, busy && { opacity: 0.5 }]}>
                  {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryButtonText}>Simpan & Cetak Tanda Terima</Text>}
                </Pressable>
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}
