import Ionicons from "@expo/vector-icons/Ionicons";
import * as Linking from "expo-linking";
import { router } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAppStyles } from "@/src/app-styles";
import { Header } from "@/src/components/header";
import { useTheme } from "@/src/theme";

export default function TailscaleGuideScreen() {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const Step = ({ num, title, children }: { num: number; title: string; children: React.ReactNode }) => (
    <View style={[styles.card, { padding: 16 }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: colors.onBrandPrimary, fontWeight: "900", fontSize: 15 }}>{num}</Text>
        </View>
        <Text style={[styles.cardTitle, { flex: 1 }]}>{title}</Text>
      </View>
      <View style={{ gap: 6 }}>{children}</View>
    </View>
  );

  const Bullet = ({ children }: { children: React.ReactNode }) => (
    <View style={{ flexDirection: "row", gap: 8, paddingLeft: 4 }}>
      <Text style={{ color: colors.brandPrimary, fontWeight: "900" }}>•</Text>
      <Text style={[styles.muted, { flex: 1, lineHeight: 20 }]}>{children}</Text>
    </View>
  );

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 10, paddingBottom: insets.bottom + 40 }]}>
        <View style={styles.between}>
          <Header title="Panduan Tailscale" subtitle="Akses JTPOIN dari mana saja" />
          <Pressable onPress={() => router.back()}><Ionicons name="chevron-back" size={26} color={colors.onSurface} /></Pressable>
        </View>

        <View style={[styles.card, { backgroundColor: colors.brandTertiary }]}>
          <Text style={[styles.cardTitle, { marginBottom: 4 }]}>Apa itu Tailscale?</Text>
          <Text style={[styles.muted, { lineHeight: 20 }]}>
            Tailscale membuat “LAN virtual” aman antar perangkat Anda. Setelah login, HP server & HP kasir akan punya IP khusus (contoh:{" "}
            <Text style={{ fontWeight: "800", color: colors.onSurface }}>100.64.x.x</Text>) yang bisa saling terhubung walau beda Wi-Fi atau beda kota — tanpa buka port router, tanpa IP publik.
          </Text>
          <Text style={[styles.muted, { marginTop: 6, lineHeight: 20 }]}>
            Gratis untuk 3 user & 100 perangkat. Enkripsi end-to-end (WireGuard). Jadi lebih aman daripada port forwarding.
          </Text>
        </View>

        <Step num={1} title="Daftar akun Tailscale">
          <Bullet>Buka tailscale.com → “Get started”. Login pakai Google, Microsoft, atau GitHub.</Bullet>
          <Bullet>Pilih paket Personal (gratis).</Bullet>
          <Pressable
            onPress={() => Linking.openURL("https://tailscale.com/download")}
            style={[styles.outlineButton, { marginTop: 10 }]}
          >
            <View style={{ flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name="open-outline" size={16} color={colors.brandPrimary} />
              <Text style={styles.outlineText}>Buka tailscale.com/download</Text>
            </View>
          </Pressable>
        </Step>

        <Step num={2} title="Install app Tailscale di HP Server & HP Kasir">
          <Bullet>Android: unduh “Tailscale” dari Play Store.</Bullet>
          <Bullet>iOS: unduh “Tailscale” dari App Store.</Bullet>
          <Bullet>Login dengan akun yang sama di SEMUA HP yang mau terhubung.</Bullet>
          <Bullet>Pastikan toggle VPN Tailscale di posisi <Text style={{ fontWeight: "800", color: colors.onSurface }}>ON</Text> (ikon kunci muncul di status bar).</Bullet>
        </Step>

        <Step num={3} title="Catat IP Tailscale HP Server">
          <Bullet>Buka app Tailscale di HP Server → akan muncul alamat seperti <Text style={{ fontWeight: "800", color: colors.onSurface }}>100.64.1.5</Text>.</Bullet>
          <Bullet>Atau buka tailscale.com/admin/machines di laptop untuk lihat semua perangkat & IP-nya.</Bullet>
        </Step>

        <Step num={4} title="Atur JTPOIN POS">
          <Bullet>Di HP Server: Mode = <Text style={{ fontWeight: "800", color: colors.onSurface }}>Server Utama</Text>. Pastikan server LAN sudah aktif.</Bullet>
          <Bullet>Di HP Kasir: Mode = <Text style={{ fontWeight: "800", color: colors.onSurface }}>Kasir Terhubung</Text>.</Bullet>
          <Bullet>Isi “Alamat server” dengan IP Tailscale yang Anda catat (contoh: 100.64.1.5). Port tetap 8787.</Bullet>
          <Bullet>Tap “Tes koneksi” — kalau hijau, berarti berhasil!</Bullet>
        </Step>

        <Step num={5} title="Login seperti biasa">
          <Bullet>Login pakai username/password yang terdaftar di HP Server.</Bullet>
          <Bullet>Semua transaksi otomatis masuk ke database HP Server.</Bullet>
          <Bullet>Dari rumah / toko lain, HP kasir tetap bisa akses selama Tailscale aktif.</Bullet>
        </Step>

        <View style={[styles.card, { backgroundColor: colors.warning + "15" }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <Ionicons name="warning-outline" size={18} color={colors.warning} />
            <Text style={[styles.cardTitle, { color: colors.warning }]}>Tips & Troubleshoot</Text>
          </View>
          <Bullet>Kalau koneksi lambat dari jauh, aktifkan “Direct connection” di Tailscale admin (bukan DERP relay).</Bullet>
          <Bullet>IP Tailscale biasanya tetap. Kalau berubah, cek lagi di app Tailscale HP Server.</Bullet>
          <Bullet>HP Server tetap harus menyala & JTPOIN tetap terbuka. Pakai power adapter + “Keep screen on” di developer options.</Bullet>
          <Bullet>Mode <Text style={{ fontWeight: "800" }}>Kasir Terhubung</Text> tidak jalan di Wi-Fi tanpa Tailscale kalau HP server di lokasi lain.</Bullet>
          <Bullet>Baterai hemat: Tailscale sebenarnya ringan, tapi matikan “Always on” kalau tidak butuh akses jarak jauh.</Bullet>
        </View>

        <View style={[styles.card, { backgroundColor: colors.brandTertiary }]}>
          <Text style={[styles.cardTitle, { marginBottom: 6 }]}>Alternatif</Text>
          <Bullet><Text style={{ fontWeight: "800", color: colors.onSurface }}>ZeroTier</Text>: mirip Tailscale, butuh gabung Network ID. Gratis 25 perangkat.</Bullet>
          <Bullet><Text style={{ fontWeight: "800", color: colors.onSurface }}>Radmin VPN</Text>: Windows-first, kurang cocok untuk Android.</Bullet>
          <Bullet><Text style={{ fontWeight: "800", color: colors.onSurface }}>Wi-Fi toko langsung</Text>: paling simpel kalau semua HP di toko yang sama — tidak butuh VPN.</Bullet>
        </View>
      </ScrollView>
    </View>
  );
}
