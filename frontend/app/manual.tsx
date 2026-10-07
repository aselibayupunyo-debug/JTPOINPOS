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
    title: "Memulai JTPOIN POS",
    short: "Pengaturan awal dalam 5 menit",
    body: [
      { heading: "Masuk pertama kali", text: "Login default: username `admin` password `admin`. Segera ganti password dari menu Lainnya → Profil & Password." },
      { heading: "Lengkapi profil toko", text: "Lainnya → Pengaturan toko & struk. Isi nama toko, alamat, telepon, upload logo (persegi/persegi panjang) — logo otomatis dicetak di struk thermal." },
      { heading: "Tambah produk", text: "Tab Stok → tombol +. Isi nama, harga pokok, harga jual, dan stok. Untuk produk jasa (tanpa stok), pilih tipe Jasa." },
      { heading: "Atur metode pembayaran", text: "Lainnya → Metode pembayaran. Aktifkan Tunai, Kredit, QRIS statis, atau tambah kustom (Transfer BCA, OVO, GoPay, dll). Metode yang dipilih di sini otomatis muncul di Kasir, Pembelian, dan Transaksi Biaya." },
      { bullets: [
        "💡 Scan barcode produk dengan tombol kamera di tab Kasir.",
        "💡 Pakai Kategori untuk kelompokkan produk (minuman, snack, dll).",
        "💡 Set stok minimum agar dapat peringatan \"Menipis\" dan \"Habis\".",
      ] },
    ],
  },
  {
    id: "offline-aman",
    icon: "shield-checkmark-outline",
    title: "Data 100% di Perangkat",
    short: "Tidak butuh internet, tanpa server",
    body: [
      { heading: "Full offline", text: "Semua data (produk, transaksi, pelanggan, laporan, pengaturan) tersimpan di SQLite lokal di HP Anda. Tidak ada server, tidak ada koneksi keluar — aman walau sinyal mati total." },
      { heading: "Backup rutin itu wajib", text: "Karena data cuma di 1 HP, pastikan rutin backup. Lainnya → Backup & Restore (ZIP) → Ekspor backup ZIP → simpan di WhatsApp sendiri, email, Google Drive, atau flashdisk." },
      { heading: "Pindah HP / ganti device", text: "Pulihkan dari file ZIP backup di menu yang sama → Pulihkan dari ZIP. Semua data langsung masuk ke HP baru." },
    ],
  },
  {
    id: "kasir",
    icon: "cart-outline",
    title: "Melayani Transaksi (Kasir)",
    short: "Cara melakukan penjualan harian",
    body: [
      { heading: "Transaksi dasar", text: "1) Ketuk produk atau cari dengan search / scan barcode. 2) Atur qty di keranjang. 3) Tekan Bayar → pilih metode pembayaran → selesai." },
      { heading: "Kuantitas desimal", text: "Ketuk angka qty untuk input manual. Dukung sampai 2 angka desimal (contoh: 1.75, 0.5) — cocok untuk produk per gram / per liter." },
      { heading: "Ubah harga manual", text: "Ketuk angka harga item di layar Pembayaran untuk ubah manual tanpa setting apapun." },
      { heading: "Multi-unit", text: "Jika produk punya satuan tambahan (misal Pcs & Dus), modal pilihan satuan muncul saat ditambah ke keranjang." },
      { heading: "Diskon per item + global", text: "Di layar Pembayaran: tombol \"+ Tambah diskon\" di bawah tiap item untuk diskon per baris (nominal Rp atau persen %). Diskon global, pajak, dan ongkir juga tersedia di bagian bawah." },
      { heading: "Preview struk sebelum simpan", text: "Opsional. Aktifkan \"Perbolehkan cetak struk sebelum selesaikan transaksi\" di Pengaturan Transaksi. Jika aktif, tombol \"Cetak struk sekarang\" muncul di layar Pembayaran — struk preview bertuliskan **BELUM DIBAYAR** otomatis dicetak ke printer Bluetooth." },
      { heading: "Parkir / Antrian", text: "Jika pelanggan belum siap bayar, tekan Park. Buka lagi dari ikon lapis di pojok kanan atas — ada kotak pencarian antrian." },
      { heading: "Kredit", text: "Pilih metode Kredit untuk catat utang pelanggan. Wajib isi nama pelanggan. Catat pelunasan dari Lainnya → Hutang & Piutang." },
    ],
  },
  {
    id: "stok",
    icon: "cube-outline",
    title: "Kelola Stok & Produk",
    short: "Tambah, impor, dan atur stok",
    body: [
      { heading: "Edit cepat lewat tap", text: "Tab Stok → ketuk produk → muncul menu bawah: **Tambah Stok**, **Kurangi Stok**, atau Edit Produk. Setiap penyesuaian otomatis tercatat di Laporan Tracking Stok." },
      { heading: "Multi-level harga", text: "Produk bisa punya harga standar / grosir / member. Aktifkan toggle \"Level harga\" di form produk, lalu isi harga tiap level. Pengaturan level ada di Pengaturan Transaksi." },
      { heading: "Import CSV", text: "Tab Stok → Import. Siapkan file .CSV (dari Excel: Save As → CSV) dengan header: `name, sku, barcode, category, price, cost, stock, min_stock, base_unit, product_type`. Baris dengan SKU/barcode yang sama akan di-update, baris baru ditambahkan." },
      { heading: "Export CSV", text: "Tab Stok → Export. Hasilnya .csv siap dibagikan via WhatsApp / email / drive." },
      { heading: "Pembelian & stok masuk", text: "Lainnya → Pembelian baru. Catat barang dari supplier, pilih metode pembayaran (ikut setting), stok otomatis bertambah. Jika Kredit, otomatis masuk ke daftar Hutang." },
      { heading: "Cetak barcode label", text: "Lainnya → Cetak barcode label. Pilih produk → kartu Contoh label menampilkan preview seperti di kertas thermal → tombol Cetak langsung ke printer Bluetooth yang paired. Fallback ke PDF kalau printer belum terhubung." },
    ],
  },
  {
    id: "retur",
    icon: "return-up-back-outline",
    title: "Retur Berbasis Stok",
    short: "Retur jual / beli tanpa cari transaksi",
    body: [
      { heading: "Alur retur", text: "Lainnya → Retur transaksi → pilih tab Retur Penjualan atau Retur Pembelian → cari & tap produk yang dikembalikan → atur qty + harga → tombol Lanjut retur → konfirmasi **\"Apakah anda yakin??\"**." },
      { heading: "Stok otomatis bergerak", text: "Retur Penjualan menambah stok, Retur Pembelian mengurangi stok. Terekam di Laporan Tracking Stok sebagai jenis \"Retur Jual\" / \"Retur Beli\"." },
    ],
  },
  {
    id: "biaya",
    icon: "cash-outline",
    title: "Transaksi Biaya",
    short: "Catat pengeluaran operasional",
    body: [
      { heading: "Catat biaya", text: "Lainnya → Transaksi biaya → tombol +. Pilih pos biaya (12 default: Gaji, Listrik, Air, Internet, Sewa, Transportasi, dll) atau tambah pos baru. Isi jumlah + keterangan + metode pembayaran." },
      { heading: "Dampak ke kas", text: "Jika metode pembayaran = Tunai, saldo kas otomatis berkurang dan tercatat sebagai pengeluaran kas." },
      { heading: "Laporan Biaya", text: "Lainnya → Laporan biaya. Rekap per pos biaya + daftar transaksi + bagikan PDF / Excel/CSV." },
    ],
  },
  {
    id: "pelanggan-poin",
    icon: "people-outline",
    title: "Pelanggan & Sistem Poin",
    short: "Database pelanggan + poin otomatis",
    body: [
      { heading: "Database pelanggan", text: "Lainnya → Pelanggan. Simpan nama, telepon/WA, alamat. Kotak pencarian aktif untuk cari cepat." },
      { heading: "Jumlah transaksi otomatis", text: "Tiap pelanggan menampilkan total transaksi, total belanja, dan sisa piutang berjalan — di-hitung real-time dari database." },
      { heading: "Poin loyalty", text: "**1 poin setiap Rp 1.000 pembelanjaan.** Poin terkumpul otomatis dari transaksi penjualan dengan pelanggan terdaftar. Ditampilkan di kartu pelanggan dengan ikon bintang." },
    ],
  },
  {
    id: "laporan",
    icon: "stats-chart-outline",
    title: "Laporan Bisnis Lengkap",
    short: "Omzet, laba rugi, pajak, tracking stok",
    body: [
      { heading: "Laporan standar (tab Laporan)", bullets: [
        "Ringkasan: metrik utama (penjualan, laba, piutang, kas, barang menipis).",
        "Per Produk: produk terlaris & laba per produk.",
        "Per Pelanggan: pelanggan teraktif & total belanja.",
        "Per Operator: performa tiap kasir.",
        "Detail Barang: list seluruh barang terjual + invoice.",
        "Detail Transaksi: list transaksi + bagikan PDF / WA.",
      ] },
      { heading: "Laporan Laba Rugi", text: "Lainnya → Laporan laba rugi. Penjualan - Retur - HPP = Laba Kotor; dikurangi Biaya = **Laba Bersih** + margin %. Export PDF / Excel/CSV." },
      { heading: "Laporan Biaya", text: "Lainnya → Laporan biaya. Rekap per pos biaya + detail transaksi." },
      { heading: "Rekap Pajak", text: "Lainnya → Rekap pajak. DPP + PPN Keluaran (jual), DPP + PPN Masukan (beli), Pajak Netto Terhutang. Aktifkan pajak default di Pengaturan Transaksi dulu." },
      { heading: "Tracking Stok", text: "Lainnya → Laporan tracking stok. Timeline pergerakan stok (jual, beli, retur, penyesuaian) per periode + total masuk / keluar / netto." },
      { heading: "Rentang waktu bebas", text: "Hampir semua laporan dukung Hari ini, Bulan ini, Tahun ini, atau Custom periode (atur tanggal mulai & akhir)." },
    ],
  },
  {
    id: "arus-kas",
    icon: "wallet-outline",
    title: "Arus Kas, Shift, Hutang-Piutang",
    short: "Pengelolaan kas & utang",
    body: [
      { heading: "Catat kas masuk/keluar", text: "Lainnya → Arus kas → + untuk pemasukan/pengeluaran non-penjualan (modal masuk, prive, dll)." },
      { heading: "Hutang & Piutang", text: "Lainnya → Hutang & Piutang → tab Piutang (dari pelanggan) atau Hutang (ke supplier) → ketuk transaksi → bayar sebagian / lunas. Metode pembayaran bisa pilih dari daftar." },
      { heading: "Shift kasir", text: "Lainnya → Shift kasir → Buka shift (isi modal awal) → setelah selesai → Tutup shift (isi kas akhir). Sistem hitung selisih kas otomatis per shift." },
    ],
  },
  {
    id: "struk",
    icon: "receipt-outline",
    title: "Struk & Printer Bluetooth",
    short: "Cetak thermal + kirim invoice digital",
    body: [
      { heading: "Pair printer Bluetooth", text: "Lainnya → Printer Bluetooth → Scan → pilih printer thermal (58mm / 80mm) → Cetak uji. Printer tersimpan permanen." },
      { heading: "Cetak struk saat transaksi", text: "Setelah bayar, struk otomatis dicetak ke printer paired. Logo (format persegi/persegi panjang) ikut tercetak di atas struk." },
      { heading: "Preview sebelum simpan (opsional)", text: "Aktifkan toggle di Pengaturan Transaksi: \"Perbolehkan cetak struk sebelum selesaikan transaksi\". Struk preview tertulis **BELUM DIBAYAR**." },
      { heading: "Cetak ulang struk / invoice", text: "Lainnya → Riwayat transaksi → ketuk transaksi → tombol Cetak thermal / Bagikan PDF / Kirim WA. Invoice format A5 bisa dicetak atau dikirim via email/WA." },
      { heading: "Multi-printer dapur", text: "Jika aktif di Pengaturan Transaksi, order dengan produk ber-flag \"Cetak di dapur\" otomatis diteruskan ke printer dapur terpisah." },
      { heading: "⚠️ Butuh build native", text: "Printer Bluetooth hanya aktif di APK/AAB Android native, **tidak di preview web / Expo Go**. Setelah selesai setting, deploy & generate build dari panel Publish." },
    ],
  },
  {
    id: "operator",
    icon: "person-add-outline",
    title: "Operator & Keamanan",
    short: "Tim kasir, hak akses, admin",
    body: [
      { heading: "Tambah operator", text: "Lainnya → Operator & kewenangan → +. Isi nama, username, password, pilih peran dan centang kewenangan modul." },
      { heading: "Peran default", bullets: [
        "Owner: akses penuh (akun admin).",
        "Manager: akses hampir semua kecuali kelola operator & zona bahaya.",
        "Kasir: fokus penjualan + laporan terbatas.",
        "Dapur: hanya lihat order (kitchen display).",
      ] },
      { heading: "Zona berbahaya (owner)", text: "Reset transaksi, hapus semua produk, dan audit log hanya untuk Owner. Dilindungi password admin dan tercatat di Log Audit." },
      { heading: "Backup & Restore ZIP", text: "Lainnya → Backup & Restore (ZIP). Ekspor file ZIP berisi seluruh data. Restore via file yang sama saat pindah device." },
      { heading: "Autofill Google dinonaktifkan", text: "Form login & password sudah dikonfigurasi agar tidak muncul tawaran \"Save password\" dari Google Password Manager." },
    ],
  },
  {
    id: "faq",
    icon: "help-circle-outline",
    title: "FAQ & Troubleshoot",
    short: "Jawaban pertanyaan umum",
    body: [
      { heading: "Kenapa harus backup?", text: "Semua data cuma di 1 HP (tidak di server). Kehilangan/kerusakan HP = data hilang. Rutin ekspor ZIP ke tempat aman (WA sendiri, email, Google Drive)." },
      { heading: "Printer thermal tidak terdeteksi?", text: "1) Pakai APK Android native (bukan Expo Go). 2) Nyalakan Bluetooth HP + izin lokasi. 3) Pair printer dulu di Pengaturan Bluetooth Android (PIN umum: 0000 / 1234). 4) Buka Lainnya → Printer Bluetooth → Scan → pilih printer → Cetak uji." },
      { heading: "Ganti logo struk?", text: "Lainnya → Pengaturan toko & struk → upload Logo. Format bebas (persegi/persegi panjang). Rekomendasi: PNG background putih, lebar ≥ 300px." },
      { heading: "Share receipt / invoice gagal?", text: "Pastikan WhatsApp / email terinstall. Share PDF untuk invoice, JPEG untuk struk gambar." },
      { heading: "Reset ulang total?", text: "Lainnya → Zona berbahaya → \"Reset Semua Transaksi\" atau \"Hapus Semua Produk\" (butuh password admin). Backup dulu sebelum reset!" },
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
            <Text style={styles.subtitle}>Pelajari semua fitur JTPOIN POS</Text>
          </View>
        </View>

        <View style={styles.greenCard}>
          <Text style={styles.white}>Semua di satu tempat</Text>
          <Text style={styles.bigWhite}>Panduan lengkap · siap offline</Text>
          <Text style={[styles.white, { opacity: 0.9, marginTop: 6 }]}>Ketuk tiap bagian untuk membuka detail. Panduan tersimpan di aplikasi, tidak butuh internet.</Text>
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
            Beberapa fitur hardware (printer Bluetooth, cash drawer, barcode scanner USB) hanya aktif di APK/AAB Android native, bukan preview web / Expo Go. Setelah selesai setting, klik Publish untuk generate build.
          </Text>
        </View>

        <Text style={[styles.muted, { textAlign: "center", marginTop: 24 }]}>JTPOIN POS · Panduan versi 2.0 · Offline Edition</Text>
      </ScrollView>
    </View>
  );
}
