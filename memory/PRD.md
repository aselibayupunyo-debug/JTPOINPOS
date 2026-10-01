# KasirKu Pro — Product Requirements

## Ringkasan
Aplikasi kasir Android berbasis Expo React Native + FastAPI + MongoDB. Semua modul (penjualan, pembelian, retur, arus kas, hutang, piutang, laporan) saling terhubung dan tanpa batas jumlah barang/transaksi.

## Fitur Utama (MVP)
- **Auth bisnis**: register pemilik (owner), login dengan JWT 14 hari, me endpoint
- **Produk**: tambah/edit/hapus produk dengan harga pokok (modal), harga jual, stok, min_stock, kategori, barcode/SKU, foto (base64), toggle cetak ke dapur
- **Kasir**: pencarian + scan barcode (expo-camera), kategori chip, keranjang, checkout dengan 5 metode pembayaran (Tunai, Kredit, Transfer Bank, E-Wallet, QRIS)
- **Pembelian**: catat barang masuk dari supplier, kas keluar atau hutang supplier
- **Retur**: retur penjualan & retur pembelian, stok otomatis dikembalikan/ditarik
- **Arus kas**: catat kas masuk/keluar manual, saldo kas real-time, riwayat kronologis
- **Hutang & Piutang**: transaksi kredit otomatis masuk list; catat pelunasan parsial/penuh, auto-record cash entry
- **Riwayat transaksi**: filter semua/penjualan/pembelian/retur, buka struk tiap transaksi
- **Laporan**: harian, bulanan, tahunan — penjualan, laba kotor, pembelian, saldo kas, kas masuk/keluar, piutang, hutang
- **Operator & kewenangan**: owner mendaftarkan operator (cashier/gudang/manajer/dapur) dengan 9 kewenangan yang bisa dicentang (sales, purchases, returns, inventory, reports, cashflow, debts, operators, settings)
- **Pengaturan toko**: logo, alamat, telepon, catatan kaki struk, lebar struk 58/80mm, nomor WhatsApp pengirim
- **Struk**: preview rapi dengan logo, format thermal — share ke WhatsApp (deeplink `whatsapp://`) atau aplikasi lain
- **Import Excel/CSV**: kolom nama/harga/modal/stok/kategori/barcode (header fleksibel ID atau EN)
- **Backup data**: ekspor seluruh bisnis (produk, transaksi, kas) sebagai JSON

## Yang menunggu build Android produksi
- Cetak langsung ke printer Bluetooth 58/80mm (ESC/POS) + logo + multi-printer dapur — hanya aktif di native build
- WhatsApp Cloud API (butuh kredensial Meta) — sekarang pakai share deeplink
- QRIS provider — mode N/A aman, perlu kredensial sandbox

## Arsitektur
- Frontend: Expo Router (file-based) — `app/(tabs)/{index,stok,laporan,lainnya}.tsx`, modal routes untuk product-form, operator-form, purchase, returns, cashflow, debts, operators, history, settings, receipt
- Auth state via `src/auth-context.tsx` (Context + token di secure storage)
- Toast system via `src/toast.tsx` (hindari Alert global)
- Theme tokens dari `src/theme.ts`
- Backend: FastAPI dengan prefix `/api`, Pydantic v2, Motor async MongoDB
- Permission enforcement via `ensure_permission(user, "...")`; owner otomatis punya semua

## Status Integrasi
| Integrasi | Status | Catatan |
|-----------|--------|---------|
| QRIS | Mock | Mode N/A, perlu kredensial provider |
| WhatsApp | Native share deeplink | Meta Cloud API butuh kredensial |
| Bluetooth printer | Aktif di prod build | 58/80mm ESC/POS + logo + multi-printer |
| Barcode scanner | Aktif | expo-camera (butuh izin kamera) |
| Import Excel | Aktif | pandas backend |

## Database
- `users`: id, business_id, business_name, name, username, password_hash, role, permissions, created_at
- `products`: id, business_id, name, sku, barcode, category, price, cost, stock, min_stock, kitchen_print, image_base64, timestamps
- `transactions`: id, business_id, invoice_no, transaction_type, payment_method, items[], total, paid_amount, outstanding, customer_name, note, created_at, created_by_name, payments[]
- `cash_entries`: id, business_id, entry_type, amount, category, note, created_at, created_by
- `business_settings`: business_id, business_name, address, phone, footer_note, logo_base64, receipt_width, whatsapp_number

## Test
Backend: 32/32 pytest tests passed (`/app/backend/tests/test_backend_full.py`).
