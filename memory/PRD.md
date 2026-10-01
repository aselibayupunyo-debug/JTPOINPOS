# KasirKu Pro — Product Requirements (Updated 2026-10)

Free Android POS app in Bahasa Indonesia. Offline-first (SQLite + sync queue to FastAPI/MongoDB).

## Features implemented
- **Core POS**: Sales, Purchases, Sale/Purchase Returns, Cashflow, Stock, Debts (receivable/payable).
- **Transactions**: cash/credit/custom payment methods, static QRIS image, discounts (%/Rp), tax, shipping, per-item discount, parked (antrian), **cancel transaction (void) with stock revert and report exclusion**.
- **Products**: name, SKU, barcode, categories (custom), image, HPP cost, selling price, price levels, min stock. **New: product_type (Barang/Jasa) — services skip stock. base_unit + multi-unit (Dus/Lusin) with factor conversion; stock stored in base unit.**
- **Customers & Suppliers**: with reporting, outstanding tracking, **price_level_id linked to customer (auto-applies at Kasir).**
- **Antrian (Parked)**: **wajib nama pelanggan**, cetak **struk antrian** thermal (nomor besar), hanya hilang bila dilanjutkan atau dibatalkan (tombol eksplisit).
- **Reports**: Daily/Monthly/Yearly summary (**metric tappable → detail modal**), per-product, per-customer, per-operator (**operator tappable → list barang terjual**), **detail barang terjual (tanggal+jam)**, send PDF per report, WhatsApp text share.
- **Receipt**: thermal 58/80mm, **header 4 baris + footer 4 baris**, logo, kirim via WhatsApp, **kirim sebagai JPEG** (view-shot), kirim text.
- **Invoice**: PDF A4 via expo-print + email/WhatsApp.
- **Barcode**: cetak lembar label dengan bwip-js.
- **Shift Kasir**: open/close shift dengan saldo awal/akhir.
- **Promo Paket**: Buy X Get Y, bundle, diskon qty.
- **Export/Import Produk**: **Export Excel .xlsx** (openpyxl/xlsxwriter) + Import CSV/XLSX.
- **Backup/Restore**: ZIP full backup JSON.
- **Users**: Owner/Manager/Cashier dengan permission granular.

## Tech
- Backend: FastAPI + MongoDB (motor) + pandas/openpyxl/xlsxwriter for Excel export + JWT auth + bcrypt.
- Frontend: Expo SDK, expo-router, expo-sqlite (offline), expo-print (PDF), expo-camera (barcode scan), bwip-js (barcode render), react-native-view-shot (JPEG), expo-sharing, @react-native-community/netinfo.

## Session 2026-10 Delivered (Iter 5–7)
1. Produk Jasa (goods/service)
2. Multi-satuan dengan konversi dasar (kasir & pembelian)
3. Price Level linked to Customer
4. Batal transaksi kasir (clear cart via Modal confirm)
5. Antrian wajib nama + edit mode (resume → ubah qty → re-park, guard dari reset loop)
6. Header struk 4 baris + Footer struk 4 baris
7. Kirim struk JPEG
8. Export produk Excel .xlsx
9. Metric ringkasan tappable → detail
10. Operator tappable → barang terjual
11. Detail barang terjual (date/time)
12. Semua laporan → PDF via share sheet (WA/Email/dll)
13. Profil & Password admin (nama + username unik + password baru)
14. Reset semua transaksi (password admin, kecuali produk/pelanggan/supplier)
15. Hapus semua produk (password admin)
16. **Audit Log Admin** (owner-only, pencatat setiap reset/hapus permanen)
17. Invoice jadi A5 (CSS @page + width 420×595 pt)
18. Hapus tombol Batal Transaksi di Riwayat
19. Multi-satuan dialog pilihan dibuat Modal
20. Hapus "Batalkan" & "Cetak Struk" di layar Antrian (hanya "Lanjutkan")
21. Preview / Cetak Struk SEBELUM simpan (tombol di checkout, berlabel ** PREVIEW **)
22. Hapus "Invoice PDF A5" di Riwayat
23. Tab baru **Detail Transaksi** di Laporan (per-tx PDF + WA + Email langsung dari list)
24. Metode pembayaran di Hutang/Piutang + **Cetak Tanda Terima** setelah pelunasan (thermal) + Share WA
25. Metode pembayaran di Pembelian mengambil dari daftar metode kustom
26. Fix Invoice A5 blank page (viewport meta + remove fixed `width: 148mm`)
