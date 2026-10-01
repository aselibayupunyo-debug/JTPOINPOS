# KasirKu Pro — Product Requirements

## Ringkasan
Aplikasi kasir Android berbasis Expo React Native + FastAPI + MongoDB dengan **cache SQLite offline-first** di perangkat. Semua modul (penjualan, pembelian, retur, arus kas, hutang, piutang, pelanggan, supplier, laporan) saling terhubung dan **tanpa batas** jumlah produk/transaksi/waktu.

## Modul Utama
- **Auth bisnis**: register pemilik, login, JWT 14 hari, me endpoint
- **Produk**: tambah/edit/hapus dengan harga pokok (modal), harga jual, stok, min_stock, kategori, barcode/SKU, foto, toggle cetak ke dapur
- **Kasir**: pencarian, scan barcode, keranjang, checkout 5 metode (Tunai/Kredit/Bank/E-Wallet/QRIS), pilih pelanggan terdaftar atau Umum
- **Pembelian**: catat barang masuk, pilih supplier terdaftar, stok otomatis bertambah
- **Retur**: retur penjualan & retur pembelian, stok auto-reverse
- **Arus kas**: catat kas masuk/keluar manual, saldo kas real-time
- **Hutang & Piutang**: list transaksi kredit aktif; pelunasan parsial/penuh dengan auto cash entry
- **Pelanggan** (baru): CRUD database pelanggan (nama, telp, alamat, catatan) + statistik otomatis (jumlah transaksi, total belanja, piutang berjalan)
- **Supplier** (baru): CRUD database supplier + statistik total pembelian & hutang berjalan
- **Riwayat transaksi**: filter semua/penjualan/pembelian/retur
- **Operator & kewenangan**: owner tambah operator dengan 9 kewenangan yang bisa dicentang
- **Pengaturan toko**: logo, alamat, telepon, lebar struk 58/80mm, WhatsApp
- **Struk**: preview + kirim via WhatsApp (deeplink) atau share lainnya
- **Import Excel/CSV**: kolom nama/harga/modal/stok/kategori/barcode
- **Backup data**: ekspor seluruh bisnis (products, transactions, cash_entries, customers, suppliers) sebagai JSON

## Laporan (ditingkatkan)
- **Ringkasan**: harian/bulanan/tahunan — penjualan, laba kotor, pembelian, saldo kas, piutang, hutang
- **Per Produk** (baru): tiap produk dengan quantity_sold, revenue, **laba** — diurut dari laba terbesar
- **Per Pelanggan** (baru): jumlah transaksi, total belanja, laba, outstanding — top customers
- **Per Operator/Karyawan** (baru): jumlah transaksi, total penjualan, laba — kinerja tim

## Offline (baru)
- **SQLite cache** via `expo-sqlite` menyimpan hasil GET untuk Kasir, Pelanggan, Laporan, dll — tetap bisa dibuka tanpa internet
- **Antrian mutasi**: POST transaksi saat offline masuk antrian lokal, otomatis di-flush saat koneksi kembali (NetInfo listener + timer 30 detik)
- **SyncBanner**: menampilkan status offline / jumlah antrian yang menunggu sync di tiap screen
- **Tanpa batas** waktu/jumlah data lokal — SQLite dibatasi hanya oleh storage perangkat

## Yang butuh build Android produksi
- Cetak Bluetooth 58/80mm (ESC/POS) + logo + multi-printer dapur
- WhatsApp Cloud API (butuh kredensial Meta) — sekarang pakai deeplink share
- QRIS provider — mode N/A aman, perlu kredensial sandbox

## Arsitektur
- Frontend: Expo Router — tabs (`index`, `stok`, `laporan`, `lainnya`) + modal routes untuk form/transaksi
- Context: `auth-context.tsx` (session), `sync-context.tsx` (online status + queue), `toast.tsx` (notifikasi)
- Local DB: `src/local-db.ts` wrapper expo-sqlite dengan tabel `cache` dan `queue`
- API: `src/api.ts` dengan `cachedGet()` (cache-first fallback) & `syncMutation()` (queue bila offline)
- Backend: FastAPI prefix `/api`, Pydantic v2, Motor async MongoDB
- Permission: `ensure_permission(user, "...")`, owner otomatis all

## Database
- `users`, `products`, `transactions` (dengan `customer_id`, `supplier_id`), `cash_entries`
- `customers` (baru): id, business_id, name, phone, address, note, timestamps
- `suppliers` (baru): id, business_id, name, phone, address, note, timestamps
- `business_settings`

## Test
Backend: **56/56 pytest** passed (iter-1 32 + iter-2 24). Lihat `/app/backend/tests/`.
