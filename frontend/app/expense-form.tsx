import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiRequest, formatRupiah, PaymentMethodDoc } from "@/src/api";
import { useAppStyles } from "@/src/app-styles";
import { Header } from "@/src/components/header";
import { useTheme } from "@/src/theme";
import { useToast } from "@/src/toast";

type ExpenseCategory = { id: string; name: string };

export default function ExpenseFormScreen() {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [methods, setMethods] = useState<PaymentMethodDoc[]>([]);
  const [category, setCategory] = useState("Lainnya");
  const [customCategory, setCustomCategory] = useState("");
  const [addingCat, setAddingCat] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [method, setMethod] = useState("");
  const [methodLabel, setMethodLabel] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiRequest<ExpenseCategory[]>("/expense-categories").then((list) => {
      setCategories(list);
      if (list[0]) setCategory(list[0].name);
    }).catch(() => undefined);
    apiRequest<PaymentMethodDoc[]>("/payment-methods").then((list) => {
      setMethods(list);
      const first = list.find((m) => m.enabled !== false);
      if (first) { setMethod(first.id); setMethodLabel(first.name); }
    }).catch(() => undefined);
  }, []);

  const addCategory = async () => {
    const name = customCategory.trim();
    if (!name) return;
    try {
      const doc = await apiRequest<ExpenseCategory>("/expense-categories", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      setCategories((prev) => [...prev, doc]);
      setCategory(doc.name);
      setCustomCategory("");
      setAddingCat(false);
    } catch (e) { toast.error("Gagal", e instanceof Error ? e.message : undefined); }
  };

  const submit = async () => {
    const amt = Number(String(amount).replace(/\D/g, ""));
    if (!amt || amt <= 0) return toast.error("Isi jumlah biaya");
    if (!method) return toast.error("Pilih metode pembayaran");
    setBusy(true);
    try {
      await apiRequest("/expenses", {
        method: "POST",
        body: JSON.stringify({
          amount: amt,
          category,
          note,
          payment_method: method,
          payment_method_label: methodLabel,
        }),
      });
      toast.success("Biaya tercatat", `${category} · ${formatRupiah(amt)}`);
      router.back();
    } catch (e) { toast.error("Gagal", e instanceof Error ? e.message : undefined); }
    finally { setBusy(false); }
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 10 }]} keyboardShouldPersistTaps="handled">
        <View style={styles.between}>
          <Header title="Transaksi Biaya" subtitle="Catat pengeluaran operasional" />
          <Pressable onPress={() => router.back()}><Ionicons name="close" size={26} color={colors.onSurface} /></Pressable>
        </View>

        <Text style={styles.inputLabel}>Pos biaya</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
          {categories.map((c) => (
            <Pressable
              key={c.id}
              testID={`exp-cat-${c.id}`}
              onPress={() => setCategory(c.name)}
              style={[{ paddingHorizontal: 14, minHeight: 44, borderRadius: 12, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" }, category === c.name && { backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandPrimary }]}
            >
              <Text style={{ color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "800" }}>{c.name}</Text>
            </Pressable>
          ))}
          <Pressable onPress={() => setAddingCat((v) => !v)} style={[{ paddingHorizontal: 14, minHeight: 44, borderRadius: 12, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 4 }]}>
            <Ionicons name="add" size={14} color={colors.brandPrimary} />
            <Text style={{ color: colors.brandPrimary, fontSize: 12, fontWeight: "800" }}>Pos baru</Text>
          </Pressable>
        </View>
        {addingCat ? (
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 10 }}>
            <TextInput value={customCategory} onChangeText={setCustomCategory} style={[styles.input, { flex: 1, marginBottom: 0 }]} placeholder="Nama pos biaya" placeholderTextColor={colors.muted} />
            <Pressable onPress={addCategory} style={[styles.primaryButton, { minWidth: 80 }]}>
              <Text style={styles.primaryButtonText}>Tambah</Text>
            </Pressable>
          </View>
        ) : null}

        <Text style={styles.inputLabel}>Jumlah biaya</Text>
        <TextInput testID="exp-amount" keyboardType="number-pad" value={amount ? Number(amount.replace(/\D/g, "")).toLocaleString("id-ID") : ""} onChangeText={(t) => setAmount(t.replace(/\D/g, ""))} placeholder="0" placeholderTextColor={colors.muted} style={[styles.input, { fontSize: 22, fontWeight: "900" }]} />

        <Text style={styles.inputLabel}>Keterangan</Text>
        <TextInput testID="exp-note" value={note} onChangeText={setNote} multiline style={[styles.input, { minHeight: 70, textAlignVertical: "top" }]} placeholder="Detail biaya (opsional)" placeholderTextColor={colors.muted} />

        <Text style={styles.inputLabel}>Metode pembayaran</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
          {methods.filter((m) => m.enabled !== false).map((m) => (
            <Pressable
              key={m.id}
              testID={`exp-pm-${m.id}`}
              onPress={() => { setMethod(m.id); setMethodLabel(m.name); }}
              style={[{ paddingHorizontal: 14, minHeight: 44, borderRadius: 12, backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center" }, method === m.id && { backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandPrimary }]}
            >
              <Text style={{ color: colors.onSurfaceTertiary, fontSize: 12, fontWeight: "800" }}>{m.name}</Text>
            </Pressable>
          ))}
        </View>

        <Pressable testID="submit-expense" disabled={busy} onPress={submit} style={[styles.primaryButton, busy && { opacity: 0.5 }]}>
          {busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.primaryButtonText}>Simpan biaya</Text>}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
