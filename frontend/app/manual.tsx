import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAppStyles } from "@/src/app-styles";
import { useTheme } from "@/src/theme";

type Section = {
  id: string;
  icon: keyof typeof import("@expo/vector-icons/Ionicons").glyphMap;
  title: string;
  short: string;
  body: { heading?: string; text?: string; bullets?: string[] }[];
};

const SECTIONS: Section[] = [
  {
    id: "mulai",
    icon: "rocket-outline",
    title: "Memulai KasirKu Pro",
    short: "Pengaturan awal dalam 5 menit",
    body: [
      { heading: "Langkah pertama", text: "Setelah daftar, lengkapi profil toko di menu Lainnya → Pengaturan toko & struk. Isi nama toko, alamat, nomor WhatsApp, dan upload logo (opsional)." },
      { heading: "Tambah produk", text: "Buka tab Stok → tombol + untuk tambah produk. Isi nama, harga pokok, harga jual, dan stok. Untuk produk tanpa stok (jasa), pilih tipe Jasa." },
      { heading: "Tambah metode pembayaran", text: "Lainnya → Metode pembayaran. Aktifkan Tunai, Kredit, QRIS, atau tambahkan metode kustom seperti Transfer BCA, OVO, GoPay." },
      { bullets: [
        "💡 Tips: Scan barcode produk dengan tombol kamera di tab Kasir.",
        "💡 Tips: Gunakan Kategori untuk kelompokkan produk (minuman, snack, dll).",
        "💡 Tips: Set stok minimum agar dapat peringatan saat stok menipis.",
      ] },
    ],
  },
  {
    id: "kasir",
    icon: "cart-outline",
    title: "Melayani Transaksi (Kasir)",
    short: "Cara melakukan penjualan harian",
    body: [
      { heading: "Transaksi dasar", text: "1) Ketuk produk atau cari dengan search / scan barcode. 2) Atur qty di keranjang. 3) Tekan Bayar → pilih metode pembayaran → selesai." },
      { heading: "Multi-unit", text: "Jika produk punya satuan tambahan (misal Pcs & Dus), modal pilihan satuan akan muncul saat ditambah ke keranjang. Pilih satuan yang dijual." },
      { heading: "Diskon per-item", text: "Di layar Pembayaran, ketuk tombol '+ Tambah diskon' di bawah tiap item untuk diskon per baris (nominal Rp atau persen %)." },
      { heading: "Diskon global, pajak, ongkir", text: "Di layar Pembayaran, isi field Diskon %, Diskon Rp, Pajak %, dan Ongkir sesuai kebutuhan. Pajak dihitung setelah diskon." },
      { heading: "Harga manual", text: "Ketuk harga item di layar Pembayaran untuk mengubah harga manual (jika diizinkan di Pengaturan)." },
      { heading: "Parkir / Antrian", text: "Jika pelanggan belum siap bayar, tekan Park / Antri. Simpan dengan nama pelanggan, lalu buka lagi dari ikon lapis di pojok kanan atas." },
      { heading: "Kredit", text: "Pilih metode Kredit untuk mencatat utang pelanggan. Wajib isi nama pelanggan. Catat pelunasan dari menu Hutang & Piutang." },
    ],
  },
  {
    id: "stok",
    icon: "cube-outline",
    title: "Mengelola Stok & Produk",
    short: "Tambah, impor, dan tracking stok",
    body: [
      { heading: "Edit produk", text: "Tab Stok → ketuk produk → edit. Bisa ubah harga, stok, barcode, SKU, kategori, dan satuan tambahan." },
      { heading: "Multi-level harga", text: "Produk bisa punya harga grosir / member / reseller. Set di edit produk → Harga per level. Terapkan ke pelanggan tertentu agar otomatis." },
      { heading: "Import massal", text: "Tab Stok → ikon upload. Siapkan file CSV/XLSX dengan kolom Nama, SKU, Barcode, Kategori, Harga Pokok, Harga Jual, Stok." },
      { heading: "Export Excel", text: "Tab Stok → ikon download. Hasilnya file .xlsx siap dibagikan via WhatsApp / email." },
      { heading: "Barcode sticker", text: "Lainnya → Cetak barcode label untuk cetak stiker barcode produk ke printer thermal / A4." },
      { heading: "Pembelian & stok masuk", text: "Lainnya → Pembelian baru untuk catat barang masuk dari supplier. Stok otomatis bertambah." },
    ],
  },
  {
    id: "laporan",
    icon: "stats-chart-outline",
    title: "Laporan Bisnis",
    short: "Pantau omzet, laba, dan performa",
    body: [
      { heading: "Pilih periode", text: "Tab Laporan → pilih Hari ini, Bulan ini, Tahun ini, atau Custom periode untuk rentang bebas." },
      { heading: "6 Jenis laporan", bullets: [
        "Ringkasan: metrik utama (penjualan, laba, piutang, kas).",
        "Per Produk: produk terlaris & laba per produk.",
        "Per Pelanggan: pelanggan teraktif & total belanja.",
        "Per Operator: performa tiap kasir.",
        "Detail Barang: list seluruh barang terjual + invoice.",
        "Detail Transaksi: list transaksi lengkap dengan tombol kirim PDF / WA / Email.",
      ] },
      { heading: "Export", text: "Tombol 'Kirim laporan sebagai PDF' untuk PDF A4, atau 'Export Excel' untuk file .xlsx multi-sheet (siap dibuka di Microsoft Excel / Google Sheets)." },
    ],
  },
  {
    id: "arus-kas",
    icon: "wallet-outline",
    title: "Arus Kas & Hutang",
    short: "Catat kas keluar dan tagih utang",
    body: [
      { heading: "Catat kas masuk/keluar", text: "Lainnya → Arus kas → + untuk tambah pemasukan/pengeluaran non-penjualan (misal: beli ATK, bayar listrik, modal masuk)." },
      { heading: "Lunasi piutang", text: "Lainnya → Hutang & Piutang → tab Piutang → ketuk pelanggan → Lunasi atau Bayar sebagian. Bisa pilih metode pembayaran kustom." },
      { heading: "Shift kasir", text: "Lainnya → Shift kasir → Buka shift (isi modal awal) → setelah selesai shift → Tutup shift (isi kas akhir). Sistem hitung selisih otomatis." },
    ],
  },
  {
    id: "struk",
    icon: "receipt-outline",
    title: "Struk & Invoice",
    short: "Cetak struk & kirim invoice digital",
    body: [
      { heading: "Preview struk", text: "Di layar Pembayaran, tekan 'Preview / Cetak Struk' sebelum selesaikan untuk preview printer thermal 58mm." },
      { heading: "Kirim ulang struk", text: "Lainnya → Riwayat transaksi → ketuk transaksi → tombol Cetak / Bagikan / Kirim WA." },
      { heading: "Invoice PDF A5", text: "Dari Riwayat / Laporan Detail Transaksi, tekan Bagikan PDF untuk invoice format A5 (bisa dicetak atau dikirim via email/WA)." },
      { heading: "Receipt gambar JPEG", text: "Alternatif selain PDF, struk bisa dibagikan sebagai gambar JPEG dari layar Riwayat." },
      { heading: "Printer Bluetooth", text: "Fitur ESC/POS 58mm/80mm sekarang aktif! Buka Lainnya → Printer Bluetooth → Scan → pilih printer → Cetak uji. Setelah tersimpan, tombol 'Cetak thermal' muncul otomatis di layar struk & riwayat.\n\n⚠️ Hanya berjalan di APK Android native (tidak di Expo Go/web). Jika pakai Expo Go, akan muncul peringatan 'butuh build'." },
    ],
  },
  {
    id: "offline",
    icon: "cloud-offline-outline",
    title: "Mode Offline",
    short: "KasirKu tetap jalan tanpa internet",
    body: [
      { heading: "Offline-first", text: "Semua data penting (produk, pelanggan, transaksi) di-cache lokal di perangkat Anda. Anda bisa melakukan transaksi tanpa internet." },
      { heading: "Antrian sinkron", text: "Transaksi yang dibuat offline akan masuk antrian lokal (ikon awan di banner atas). Begitu online, data otomatis dikirim ke server." },
      { heading: "Konflik data", text: "Jika ada konflik (misal stok minus), notifikasi muncul. Buka Pengaturan → Antrian sinkron untuk resolusi manual." },
    ],
  },
  {
    id: "operator",
    icon: "people-outline",
    title: "Operator & Keamanan",
    short: "Tim kasir, hak akses, audit",
    body: [
      { heading: "Tambah operator", text: "Lainnya → Operator & kewenangan → +. Isi nama, username, password, pilih peran (Manager/Kasir/Dapur) dan centang kewenangan." },
      { heading: "Peran & kewenangan", bullets: [
        "Owner: akses penuh (hanya 1 akun).",
        "Manager: akses hampir semua kecuali kelola operator & zona bahaya.",
        "Kasir: hanya penjualan & lihat laporan terbatas.",
        "Dapur: hanya lihat order (kitchen display).",
      ] },
      { heading: "Zona berbahaya (owner)", text: "Reset transaksi, hapus produk, dan audit log hanya untuk Owner. Semua aksi dilindungi password dan tercatat di Log Audit." },
      { heading: "Backup & Restore", text: "Lainnya → Backup & Restore (ZIP). Download file ZIP berisi semua data bisnis. Restore via file yang sama saat butuh pindah device." },
    ],
  },
  {
    id: "faq",
    icon: "help-circle-outline",
    title: "FAQ & Tips Lanjutan",
    short: "Jawaban pertanyaan umum",
    body: [
      { heading: "Kenapa stok minus?", text: "Biasanya karena offline sync membentur konflik. Buka Pengaturan → Antrian sinkron → resolve." },
      { heading: "Lupa password owner?", text: "Dari layar login, tekan 'Reset password'. Verifikasi email yang terdaftar." },
      { heading: "Cara ganti logo struk?", text: "Lainnya → Pengaturan toko & struk → upload Logo. Rekomendasi 300×300px PNG transparan." },
      { heading: "Printer thermal tidak terdeteksi?", text: "1) Pastikan pakai APK Android (bukan Expo Go). 2) Nyalakan Bluetooth HP + izin lokasi. 3) Pair printer dulu di Pengaturan Android (PIN umum: 0000 / 1234). 4) Buka Lainnya → Printer Bluetooth → Scan. 5) Pilih printer dari list → Cetak uji." },
      { heading: "Share receipt gagal?", text: "Pastikan WhatsApp sudah terinstall. Format receipt: pilih PDF atau JPEG di menu riwayat." },
    ],
  },
];

export default function ManualScreen() {
  const styles = useAppStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState<string | null>(null);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 10 }}>
          <Pressable testID="manual-back" onPress={() => router.back()} style={{ padding: 6, marginRight: 8 }}>
            <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Buku Panduan</Text>
            <Text style={styles.subtitle}>Pelajari semua fitur KasirKu Pro</Text>
          </View>
        </View>

        <View style={styles.greenCard}>
          <Text style={styles.white}>Butuh bantuan cepat?</Text>
          <Text style={styles.bigWhite}>Panduan lengkap tersedia offline</Text>
          <Text style={[styles.white, { opacity: 0.8, marginTop: 6 }]}>Ketuk tiap bagian untuk membuka detail. Semua panduan ini tersimpan di aplikasi.</Text>
        </View>

        {SECTIONS.map((s) => {
          const expanded = open === s.id;
          return (
            <Pressable
              key={s.id}
              testID={`manual-section-${s.id}`}
              onPress={() => setOpen(expanded ? null : s.id)}
              style={[styles.card, { padding: 14 }]}
            >
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <View style={[styles.settingIcon, { marginRight: 12 }]}>
                  <Ionicons name={s.icon} size={22} color={colors.brandPrimary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.productName}>{s.title}</Text>
                  <Text style={styles.muted}>{s.short}</Text>
                </View>
                <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={20} color={colors.muted} />
              </View>
              {expanded ? (
                <View style={{ marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.divider }}>
                  {s.body.map((block, idx) => (
                    <View key={idx} style={{ marginBottom: 12 }}>
                      {block.heading ? (
                        <Text style={[styles.cardTitle, { fontSize: 15, marginBottom: 4 }]}>{block.heading}</Text>
                      ) : null}
                      {block.text ? (
                        <Text style={[styles.muted, { lineHeight: 20, fontSize: 13 }]}>{block.text}</Text>
                      ) : null}
                      {block.bullets ? (
                        <View>
                          {block.bullets.map((b, i) => (
                            <View key={i} style={{ flexDirection: "row", marginTop: 4 }}>
                              <Text style={[styles.muted, { marginRight: 6 }]}>•</Text>
                              <Text style={[styles.muted, { flex: 1, lineHeight: 20, fontSize: 13 }]}>{b}</Text>
                            </View>
                          ))}
                        </View>
                      ) : null}
                    </View>
                  ))}
                </View>
              ) : null}
            </Pressable>
          );
        })}

        <View style={[styles.card, { marginTop: 10, backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandPrimary }]}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <Ionicons name="information-circle-outline" size={22} color={colors.brandPrimary} />
            <Text style={[styles.productName, { marginLeft: 8, color: colors.brandPrimary }]}>Fitur yang butuh native build</Text>
          </View>
          <Text style={[styles.muted, { marginTop: 6, lineHeight: 20 }]}>
            Beberapa fitur hardware (Bluetooth printer, cash drawer, barcode scanner USB) hanya aktif di APK Android native, bukan Expo Go. Setelah selesai setting, klik tombol Publish di aplikasi untuk generate APK.
          </Text>
        </View>

        <Text style={[styles.muted, { textAlign: "center", marginTop: 24 }]}>KasirKu Pro · Panduan versi 1.0</Text>
      </ScrollView>
    </View>
  );
}
