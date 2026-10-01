# KasirKu Pro — Product Requirements

## Ringkasan
Aplikasi kasir Android berbasis Expo React Native + FastAPI + MongoDB. Semua modul (penjualan, pembelian, retur, arus kas, hutang, piutang, pelanggan, supplier, laporan) saling terhubung, **tanpa batas** jumlah produk/transaksi, dengan **cache SQLite offline-first** + mode **LAN** (satu perangkat jadi server, lainnya terhubung via Wi-Fi lokal).

## Modul Utama
- **Auth bisnis**: register pemilik, login JWT 14 hari
- **Produk**: tambah/edit/hapus, foto, barcode, harga pokok, stok, min_stock, kategori, kitchen print toggle, **multi-harga per level (level harga)**, **multi-satuan**
- **Kasir**: pencarian, scan barcode, keranjang, **park/antri transaksi**, **batal transaksi**, **ubah harga manual** oleh kasir, filter kategori + filter level harga
- **Checkout detail**: 
  - Metode pembayaran customizable (default: Tunai, Kredit, QRIS Statis) + bisa tambah/edit/hapus metode kustom
  - **QRIS statis** tampil gambar QR yang di-upload admin
  - Pembayaran tunai: default uang diterima = total; **pilihan cepat 50k/100k/150k/200k/250k/300k/uang pas** + input manual
  - Diskon per-item + diskon global (% atau nominal) + pajak % + ongkir
  - Pilih pelanggan (dengan default level harga pelanggan auto-apply)
  - Tombol Park & Batal langsung di checkout
- **Pembelian**: pilih supplier dari daftar, catat barang masuk, cash/kredit
- **Retur**: retur penjualan & retur pembelian
- **Arus kas**: kas masuk/keluar manual, saldo real-time
- **Hutang & Piutang**: list kredit aktif, pelunasan parsial/penuh, auto-record cash entry
- **Pelanggan**: CRUD + statistik otomatis + **default price_level_id**
- **Supplier**: CRUD + statistik
- **Antrian transaksi**: list parked transactions, lanjutkan atau hapus
- **Riwayat transaksi**: filter per jenis + **tombol cetak ulang struk**
- **Kategori barang**: CRUD customizable
- **Metode pembayaran**: CRUD; QRIS statis upload gambar; toggle enabled; default pm_cash/pm_credit/pm_qris terkunci dari delete
- **Pengaturan transaksi**: pajak default, ongkir default, label pajak, toggle allow_price_edit, toggle confirm_cancel, toggle auto_park_on_cancel, toggle cashdrawer, toggle multi_printer, kelola level harga
- **Operator & kewenangan**: 9 permissions
- **Backup & Restore (ZIP)**: ekspor semua data termasuk settings & payment methods ke .zip; restore ganti seluruh data
- **Pengaturan toko & struk**: logo, lebar 58/80mm, WhatsApp, nomor pengirim
- **Struk**: preview rapi dengan rincian subtotal/diskon/pajak/ongkir/total; share WhatsApp deeplink / share lainnya
- **Import Excel/CSV**: kolom fleksibel ID atau EN

## Laporan
- **Ringkasan**: harian/bulanan/tahunan — penjualan, laba kotor, pembelian, saldo kas, piutang, hutang
- **Per Produk**: quantity, revenue, laba (sorted by laba desc)
- **Per Pelanggan**: jumlah transaksi, total belanja, outstanding, laba
- **Per Operator/Karyawan**: jumlah transaksi, total penjualan, laba

## Offline + LAN Mode
- SQLite cache lokal (`expo-sqlite`) untuk semua GET endpoints
- Antrian mutasi lokal saat offline; flush otomatis via NetInfo listener + timer 30 detik
- Backend FastAPI bind di `0.0.0.0:8001` → **bisa diakses dari device lain di LAN/Wi-Fi** (user hanya perlu mengarahkan EXPO_PUBLIC_BACKEND_URL ke IP lokal perangkat server)
- Tanpa batas waktu/jumlah data lokal — hanya dibatasi storage perangkat

## Yang menunggu build Android produksi (hardware)
- Cetak Bluetooth 58/80mm (ESC/POS) + logo + **multi-printer dapur/invoice** 
- **Cash drawer** (ESC/POS pulse code) — toggle sudah tersedia di Pengaturan transaksi
- **Barcode print** & **label pengiriman print**
- Mode **invoice PDF** & **struk JPEG** untuk kirim via email/WhatsApp
- WhatsApp Cloud API & email provider

## Arsitektur Backend
- FastAPI `/api/*`, Pydantic v2, Motor async MongoDB
- Permission gating via `ensure_permission()`
- Payment method **id→kind resolver** untuk validasi cash/credit yang customizable
- Debt filter via `outstanding > 0` (lebih akurat & tahan terhadap method kustom)
- Backup v2 + Restore owner-only

## Database
- `users`, `products` (prices dict + units array), `transactions` (full breakdown fields), `cash_entries`
- `customers` (price_level_id), `suppliers`
- `categories`, `payment_methods` (seed otomatis), `parked_transactions`
- `business_settings` (price_levels, tax, shipping, hardware toggles, QRIS static)

## Test
Backend: **86/86 pytest passed** (iter 1-4). Lihat `/app/backend/tests/`.
