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

## Session 2026-10 (Iter 10) — Fase 1 Delivered
27. **Diskon per-item di kasir**: tombol "+ Tambah diskon" per cart line → modal dengan opsi Nominal (Rp) atau Persen (%). Preview diskon aktual sebelum apply. Field `manual_discount` di CartItem dipisahkan dari promo discount untuk kompatibilitas.
28. **Custom date range di Laporan**: chip "Custom periode" membuka modal date range picker dengan preset chips (7 hari / 30 hari / Bulan lalu) + input manual YYYY-MM-DD. Berlaku untuk semua 5 endpoint laporan.
29. **Backend custom period**: 5 endpoint `/reports/*` menerima `period=custom&start=YYYY-MM-DD&end=YYYY-MM-DD` lewat helper `_date_filter` + `_period_range`.
30. **Export Excel Laporan multi-sheet**: `GET /api/reports/export?period=…&start=&end=` streams xlsx dengan 6 sheets (Ringkasan, Per Produk, Per Pelanggan, Per Operator, Detail Barang, Detail Transaksi). Tombol "Export Excel" di Laporan.
31. **Buku Panduan Manual (in-app help)**: `/manual` route — 9 bagian collapsible: Mulai, Kasir, Stok, Laporan, Arus Kas, Struk, Offline, Operator, FAQ. Linked dari menu Lainnya.

Backend testing: 191/191 PASS (168 regression + 23 new custom range/export tests).

## Session 2026-10 (Iter 11) — Bluetooth Printer Fix
32. **Bluetooth Thermal Printer ESC/POS (REAL)**: Mengganti placeholder "butuh build" dengan implementasi nyata menggunakan `react-native-thermal-printer-driver@0.1.1` (TurboModule, New Architecture). Mendukung Bluetooth Classic + BLE + TCP, 58mm & 80mm paper, QR, barcode, image dithering, cash drawer kick.
    - Utility `/app/frontend/src/bt-printer.ts` dengan lazy dynamic import — web/Expo Go tidak crash, hanya menampilkan pesan "butuh build APK".
    - Screen `/app/frontend/app/bluetooth-printer.tsx` untuk scan, pair, test cetak, lepas printer. Pilihan tersimpan di SecureStore (per-device).
    - Tombol **"Cetak struk sekarang"** di `/receipt` memanggil `printReceipt(tx, settings)` dengan ESC/POS text builder lengkap (header, items, totals, footer, cash drawer).
    - Toggle **"Buka laci kas otomatis"** di Pengaturan toko (ESC/POS cash drawer kick).
    - Permission Android: BLUETOOTH, BLUETOOTH_ADMIN, BLUETOOTH_SCAN, BLUETOOTH_CONNECT, ACCESS_FINE_LOCATION, ACCESS_COARSE_LOCATION.
    - **PENTING**: User HARUS Publish & generate APK Android baru untuk mengaktifkan fitur ini (TurboModule tidak jalan di Expo Go).

## Session 2026-10 (Iter 11b) — Laporan Crash Fix
33. **Fix crash Laporan di APK Android**: Tab Laporan sebelumnya menyebabkan app exit saat dibuka di HP native. Penyebab + perbaikan:
    - **Promise.all throw** → ganti dengan wrapper `safely<T>()` per-endpoint, satu error tidak membatalkan semua.
    - **Double-fetch race** antara `useFocusEffect` + `useEffect` (keduanya memanggil `load` dengan dep yang sama) → gabung jadi 1 fetch via useFocusEffect.
    - **Dep `toast` di useCallback** memicu re-render infinite kalau ToastProvider setState → dihapus.
    - **`new Date(bad).toISOString()`** throw RangeError untuk string tanggal invalid → bungkus try/catch + validasi regex YYYY-MM-DD.
    - **500 transaksi diparse+render** = Hermes OOM di HP RAM rendah → turunkan ke limit=300, slice(0, 200) untuk render.
    - **Null field crash** (`t.items.length`, `o.name.slice(…)`, `c.customer_name.slice(…)`) kalau dokumen rusak → tambah `?? "-"`/`?? 0`/`Array.isArray` guard di setiap render.
