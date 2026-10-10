# JTPOIN POS — Product Requirements (Updated 2026-10, Offline Migration)

Free Android POS app in Bahasa Indonesia. **100% offline — semua data tersimpan di perangkat user via SQLite. Tidak ada koneksi server/cloud.**

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
- **Backend: NONE (fully offline).** Semua auth + endpoint API dirutekan ke `src/local-backend/` yang menyimpan data di SQLite perangkat via `expo-sqlite`. Server FastAPI/MongoDB sudah ditinggalkan.
- Frontend: Expo SDK, expo-router, expo-sqlite (data persist), expo-crypto (PBKDF2-like password hashing), expo-print (PDF), expo-camera (barcode scan), bwip-js (barcode render), react-native-view-shot (JPEG), expo-sharing, `rn-bluetooth-classic-printer` (ESC/POS Bluetooth SPP).

## Session 2026-10 Offline Migration (Iter 8)
- **Full Offline Migration**: Semua API call (`apiRequest`, `cachedGet`, `syncMutation`) dirutekan ke `local-backend/index.ts` yang mem-dispatch ke handler lokal.
- **Auth**: Password hashing via SHA-256 iterated (10k rounds) + per-user random salt. Session token acak dari `expo-crypto`.
- **Seed Admin**: `admin` / `admin` auto-dibuat saat pertama kali app launch (jika tabel users kosong).
- **Local DB Schema**: `users, sessions, business_settings, products, categories, payment_methods, contacts (customer+supplier), transactions_t, cash_entries, debts, parked, shifts, promos, audit_logs, counters` — semua idempotent `CREATE TABLE IF NOT EXISTS`.
- **Decommissioned Sync**: `SyncProvider` jadi no-op; `flushQueue`/`pendingSyncCount` return 0; FastAPI backend tidak lagi dipanggil.
- **Export Excel offline**: `/products/export` dan `/reports/export` sekarang generate CSV (buka di Excel/WPS) langsung dari SQLite tanpa server.

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

## Session 2026-10 (Iter 12) — Native Crash + Direct BT Printing Fix
34. **Hapus `react-native-thermal-printer-driver` (TurboModule)**: Library ini menyebabkan "JTPOIN POS terus berhenti" di APK karena pendaftaran TurboModule gagal pada arsitektur bawaan Expo build. Semua referensi di app.json plugins & kode dihapus.
35. **Pakai `rn-bluetooth-classic-printer@0.2.1`**: Menggunakan `expo-modules-core` (auto-link, OLD architecture compatible) → tidak crash saat APK startup. Mendukung Bluetooth Classic SPP (standar printer thermal POS Indonesia: Bellav, Panda, Xprinter, Rongta, dll).
36. **Direct cetak tanpa helper app**: Printer dipair di Pengaturan Bluetooth Android, aplikasi JTPOIN POS langsung konek & kirim ESC/POS raw bytes via SPP. User tidak perlu RawBT atau aplikasi lain.
37. **Rewrite `/app/frontend/src/bt-printer.ts`**: Lazy `require()` modul (tidak diload di web/Expo Go), `scanPrinters` (paired + discovery), `connectPrinter`, `savePairedPrinter` (SecureStore), `testPrint`, `printReceipt` (58/80mm + cash drawer), `openCashDrawerOnly`, `openBluetoothSettings` (Intent BLUETOOTH_SETTINGS).
38. **Permission handling Android**: `PermissionsAndroid.requestMultiple` auto-detect SDK level (31+ pakai BLUETOOTH_SCAN/CONNECT, lama pakai ACCESS_FINE_LOCATION). NEVER_ASK_AGAIN → arahkan user ke app settings.

**PENTING UNTUK USER**: APK yang sekarang di HP masih berisi library lama yang crash. Harus **Publish ulang** dari aplikasi lalu **generate APK baru** untuk pakai library yang stabil.

## Session 2026-10 (Iter 13) — Crash Fix + Retur Password + Decimal Qty
39. **🔴 Root cause crash Laporan + Cetak Barcode**: `/app/frontend/src/pdf.ts` import `bwip-js` di module scope — `bwip-js` indirectly load `react-zlib-js` yang crash native di beberapa HP Android. Semua screen yang import pdf.ts (Laporan, Cetak Barcode, Riwayat, Debts) ikut crash. **FIX**: Pindah `require("bwip-js")` ke dalam fungsi `barcodeSvg()` dengan try/catch — hanya di-load saat barcode benar2 digenerate.
40. **Quantity desimal di kasir**: Backend `TransactionItem.quantity` ganti dari `int` ke `float`. Frontend: cart line qty bisa diketuk → TextInput decimal-pad, auto-handle koma/titik, hingga 3 digit desimal (ex: 0.5 kg, 2.25 liter). Format display pakai `.toLocaleString("id-ID")`.
41. **Preview button → direct cetak thermal**: Tombol "Preview / Cetak Struk" di checkout sekarang: (a) jika printer thermal terpasang → langsung cetak via `printReceipt()`; (b) jika tidak → fallback ke preview PDF via `expo-print`. Membangun fake TransactionDoc dari cart items + totals.
42. **Retur dengan password admin**: Backend `TransactionInput.admin_password` wajib untuk `sale_return`/`purchase_return`. Verifikasi via `bcrypt.checkpw` terhadap user dengan role owner/admin di business yang sama. Password salah → 401.
43. **Cegah double retur**: Backend menyimpan `returned`, `returned_at`, `return_transaction_id` di transaksi asli saat retur dibuat. Retur kedua kalinya → 400 "sudah pernah diretur". Frontend `returns.tsx` filter `!tx.returned && tx.status !== "cancelled"` dari list.
44. **Modal password konfirmasi retur**: Frontend `returns.tsx` buka modal password sebelum call API. Peringatan: "Transaksi tidak dapat diretur lebih dari satu kali".

Backend testing: **219/219 PASS** (191 regression + 28 new iter-11 tests mencakup decimal qty, retur password workflow, returned flag).

**TODO (sesi berikutnya)**:
- Logo on struk thermal (ESC/POS raster image command)
- Logo flexible aspect ratio (persegi / persegi panjang)
- Price level toggle (checkbox pakai level harga atau tidak)
- Multi-printer dapur routing
- **Full offline migration**: Rewrite auth + semua endpoint API ke SQLite murni (butuh dedicated session, major arch change).

## Session 2026-10 (Iter 14) — Logo Struk + Multi-Printer Dapur + Toggle Level Harga
45. **Logo tercetak di struk thermal**: Backend endpoint baru `GET /api/settings/logo-escpos?width=58mm|80mm&max_height=180` → mengembalikan ESC/POS raster command (base64) dari `logo_base64` di BusinessSettings. Pakai Pillow (Floyd-Steinberg dither, aspect-ratio preserved, flat white background, max height cap). Mendukung logo persegi maupun persegi panjang.
46. **Frontend logo cache**: `bt-printer.ts` auto-fetch logo bytes 1x per sesi (cache 1 jam via SecureStore), prepend ke tiap `printReceipt`. Cache otomatis invalidate saat user save settings baru lewat `invalidateLogoCache()`.
47. **Multi-printer dapur**: Printer kedua tersimpan di key `jtpoin_bt_kitchen_printer`. UI `bluetooth-printer.tsx` sekarang punya 2 tab: "Printer Struk" vs "Printer Dapur". Fungsi `printKitchenOrder(tx, settings)` kirim mini-struk ke printer dapur (hanya item dengan `kitchen_print=true`, bold item names, catatan transaksi). Auto-trigger di akhir checkout kasir kalau ada item tag dapur.
48. **Toggle level harga per-produk**: Backend `ProductInput.use_price_levels: bool = False`. Frontend product-form sudah ada Switch "Pakai level harga". Logika di kasir: `priceOf(product)` hanya pakai `product.prices[priceLevel]` kalau `product.use_price_levels !== false` (backward compat: produk lama tanpa field → tetap pakai). Produk baru dengan toggle OFF akan selalu pakai `product.price` tunggal.

Backend testing: **236/236 PASS** (219 carry-over + 17 new iter-12 tests).

**TODO (sesi berikutnya)**:
- **Full offline migration**: Rewrite auth + semua endpoint API ke SQLite murni (butuh dedicated session besar).


## Session 2026-10 (Iter 15) — Hapus Logo + Omit Logo pada Preview Berbarengan Dapur
49. **Tombol Hapus Logo di Pengaturan Toko**: `app/settings.tsx` dapat menghapus logo via tombol merah (`testID="remove-logo"`) di card "Identitas toko" dengan konfirmasi `Alert.alert`. Setelah konfirm → `logo_base64` di state di-set `null`; user tekan "Simpan pengaturan" seperti biasa untuk persist. Cache logo printer di-invalidate otomatis saat save.
50. **Tombol Hapus Logo di Preview Struk**: `app/receipt.tsx` menampilkan tombol "Hapus logo dari struk" (`testID="receipt-remove-logo"`, hanya muncul kalau logo ada) di bawah ViewShot. Konfirmasi `Alert.alert` → PUT `/settings` dengan `logo_base64: null` → invalidate logo cache → toast sukses. Tombol di luar ViewShot agar tidak ikut tercapture saat kirim JPEG.
51. **Omit Logo di Preview Berbarengan Dapur**: `printReceipt(tx, settings, opts)` menambahkan opsi `omitLogo?: boolean`. Di `app/(tabs)/index.tsx` tombol "Preview / Cetak Struk" pada checkout mengirim `omitLogo: settings.kitchen_print_timing === "with_preview"` → saat user memilih "cetak dapur berbarengan preview", logo besar tidak ikut tercetak di struk preview (hemat kertas; dapur sudah pakai header kecil terpisah). Mode normal (print setelah transaksi) tetap mencetak logo.


## Session 2026-10 (Iter 16) — LAN Sync + Tailscale (Multi-perangkat)
52. **Mode perangkat baru** di `src/lan-sync/device-mode.ts`: `mandiri` (default, offline penuh) | `server` (HP ini pusat data) | `client` (ambil data dari server via HTTP). Config disimpan di AsyncStorage, cache in-memory.
53. **Mini HTTP server embedded** di `src/lan-sync/http-server.ts`: dibangun dari `react-native-tcp-socket`, parse HTTP/1.1 request secara manual, body limit 2MB, bungkus `localFetch` sehingga semua 50+ endpoint `local-backend/handlers.ts` otomatis exposed via `http://host:8787/api/*`. Auth via Bearer token. Endpoint `/health` publik untuk ping. Keep-alive OFF.
54. **Remote HTTP client** di `src/lan-sync/http-client.ts`: `remoteFetch({method, path, body, token})` kompatibel signature dengan `localFetch`, pakai `fetch()` standard + timeout 15s + `AbortController`. Throw `LanOfflineError` kalau server tak reachable.
55. **mDNS discovery** di `src/lan-sync/discovery.ts`: pakai `expo-zeroconf`. Mode server publish service `jtpoin._tcp` port 8787. Mode client `scan(timeout=4.5s)` → daftar `DiscoveredServer[]`. Fallback aman kalau native modul tak tersedia.
56. **Dynamic routing di `src/api.ts`**: `apiRequest` cek `getLanConfig().mode` — kalau `client`, rute ke `remoteFetch`; else pakai `localFetch`. Semua layar POS otomatis bekerja via HTTP tanpa perubahan.
57. **Auto-start server di boot**: `AuthProvider` panggil `startLanSyncServer()` + `publishLanService()` saat mode = `server` (dibungkus timeout 3s agar tidak block login kalau native module gagal).
58. **Layar `app/lan-sync.tsx`**: UI pemilihan mode, status server real-time (polling 2s), input nama device + port, scan mDNS tap-to-connect, tes koneksi, konfirmasi `Alert.alert`. Diakses dari tab "Lainnya" → "Sinkronisasi Jaringan" (owner-only).
59. **Layar `app/tailscale-guide.tsx`**: panduan 5 langkah Tailscale (install, catat IP 100.x.x.x, konfig JTPOIN, troubleshoot), link eksternal, section alternatif (ZeroTier/Radmin).
60. **Permissions `app.json`**: Android +`INTERNET,ACCESS_NETWORK_STATE,ACCESS_WIFI_STATE,CHANGE_WIFI_MULTICAST_STATE`, `usesCleartextTraffic: true`. iOS +`NSLocalNetworkUsageDescription`, `NSBonjourServices: ["_jtpoin._tcp"]`. Plugin `expo-zeroconf` auto-added.
61. **Pola keamanan**: Login username/password seperti biasa, token di Authorization header. Mode `client` tanpa server hidup → throw `LanOfflineError` → kasir tidak bisa jualan (data konsisten > fleksibilitas).

**Catatan**: Fitur ini **HANYA jalan di build APK/IPA native** — `react-native-tcp-socket` dan `expo-zeroconf` adalah native modules.

## Session 2026-10 (Iter 17) — USB Barcode Scanner Global Capture
62. **Komponen `UsbScannerListener`** di `src/hooks/use-usb-scanner.tsx`: menangkap input dari USB barcode scanner secara global tanpa user perlu memberi fokus ke kolom pencarian.
    - **Native (Android/iOS)**: hidden TextInput (`position:absolute`, opacity 0, 1x1 px) dengan `autoFocus` + `showSoftInputOnFocus=false` (Android-only prop). `onSubmitEditing` → trigger `onScan(code)` + clear input + re-focus untuk scan berikutnya. `onBlur` tidak merebut focus kalau ada TextInput lain aktif (`TextInput.State.currentlyFocusedInput()`).
    - **Web**: `document.addEventListener("keydown")` dengan timing-based detection (gap antar-tombol <100ms = scanner, Enter → emit scan). Dilewati kalau user sedang di `<input>/<textarea>/contenteditable`.
63. **Integrasi di kasir**: `(tabs)/index.tsx` mount `<UsbScannerListener active={!scanner && !checkout && !parkPromptOpen && !cancelConfirmOpen && !unitPicker} onScan={onBarcode} />` — nonaktif otomatis saat modal apapun terbuka agar tidak menabrak input modal.
64. **`onBarcode()` ditingkatkan**: setelah berhasil match produk → `addToCart(match)` + `setSearch("")` agar scan berikutnya langsung bersih. Trim whitespace & abaikan code kosong.

**Catatan**: USB scanner connected via OTG → bertindak sebagai HID keyboard di Android, langsung bekerja dengan hidden TextInput. Tidak butuh library tambahan.


## Session 2026-10 (Iter 18) — Beep Audio + Scanner Toggle
65. **Audio feedback** di `src/scanner-feedback.ts`: `playScanSuccess()` (2000Hz 90ms sine, soft envelope) & `playScanError()` (300Hz+250Hz dual tone 280ms) via `expo-audio` `createAudioPlayer`. Player instance di-cache (lazy init) agar replay instan tanpa delay. WAV digenerate via Python script (Attack 4ms, Release 30ms envelope untuk hilang click).
66. **Inline base64 audio** di `src/scanner-feedback-sources.ts`: dua data URI base64 untuk WAV sources. Metro web bundling tidak bisa resolve `require('../../assets/sounds/*.wav')` → workaround pakai `{ uri: 'data:audio/wav;base64,...' }` yang kompatibel semua platform.
67. **Toggle scanner** di header kasir (`(tabs)/index.tsx`): tombol dengan icon `barcode-outline` (aktif) / `barcode` + garis coret merah (nonaktif), posisi di sebelah tombol antrian. State di-persist via AsyncStorage key `jtpoin_scanner_enabled_v1` dengan getter/setter `getScannerEnabled()`/`setScannerEnabled()`. Default: aktif.
68. **Integrasi feedback**: `onBarcode()` panggil `playScanSuccess()` saat match ditemukan & `playScanError()` saat barcode tak terdaftar. Toggle on/off juga memainkan beep konfirmasi & toast info.
69. **UsbScannerListener dependency**: prop `active` sekarang digabung `scannerEnabled && !modal-apapun`. Kalau toggle off, hidden TextInput unmount → user bisa tap kolom pencarian & muncul soft keyboard untuk ketik manual tanpa gangguan scanner.


## Session 2026-10 (Iter 19) — USB Scanner Fix: Direct-to-Cart
70. **Masalah lama**: UsbScannerListener hidden TextInput tidak reliabel karena search field "merebut" fokus — scanner input menumpuk di kolom pencarian tanpa auto-submit ke keranjang. User harus hapus manual tiap scan.
71. **Pendekatan baru**: Jadikan kolom pencarian itu sendiri target scanner. Hidden listener dihapus; `(tabs)/index.tsx` sekarang punya `searchRef` dengan:
    - `autoFocus={scannerEnabled}` — langsung siap scan saat screen dibuka
    - `blurOnSubmit={false}` — Enter dari scanner tidak melepas fokus
    - `onSubmitEditing` → cari match → add ke keranjang → `setSearch("")` → refocus (30ms setelah event)
    - `onBlur` → refocus kalau tidak ada TextInput lain aktif (via `TextInput.State.currentlyFocusedInput`)
72. **Enhanced barcode lookup**: match 3-level:
    1. `products[].barcode` / `products[].sku` → `addToCart(product)` (buka unit picker kalau multi-unit)
    2. `products[].units[].barcode` → **direct `addLineToCart`** dengan unit & harga spesifik, skip picker
    3. Tidak match → `playScanError()`, teks tetap di search utk filter manual
73. **Multi-scan accumulation**: 1 scan = +1 qty. `addLineToCart` sudah inkremen qty untuk line_id yang sudah ada → scan barcode sama berkali-kali otomatis naik qty.
74. **Toggle refocus**: Ketika scanner di-enable, `searchRef.focus()` dipanggil langsung; di-disable, `searchRef.blur()` agar user bisa interaksi normal.
75. **UsbScannerListener dropped**: komponen hidden `src/hooks/use-usb-scanner.tsx` tidak di-import lagi di cashier (masih ada di repo kalau dibutuhkan nanti).


## Session 2026-10 (Iter 20) — Fix CLEARTEXT HTTP Android (LAN Sync)
76. **Error nyata di device**: `java.net.UnknownServiceException: CLEARTEXT communication to 10.150.43.172 not permitted by network security policy`. Android 9+ (API 28+) memblokir koneksi HTTP non-TLS secara default.
77. **Root cause**: Field `expo.android.usesCleartextTraffic: true` di app.json **tidak diterapkan** oleh Expo prebuild di SDK modern — hanya field di dalam `expo-build-properties` plugin yang di-tulis ke `AndroidManifest.xml` saat generate build native.
78. **Fix**: Install `expo-build-properties` + konfigurasi di `plugins` dalam bentuk array `["expo-build-properties", { "android": { "usesCleartextTraffic": true } }]`. Ini meng-set `android:usesCleartextTraffic="true"` pada tag `<application>` di manifest build Android baru.
79. **Install `buffer` package**: `src/lan-sync/http-server.ts` pakai `import { Buffer } from "buffer"` untuk parse HTTP request/response. Yarn Expo install menambahkan `buffer@6.0.3` ke dependencies agar bundling eksplisit (sebelumnya mengandalkan RN polyfill implisit).
80. **Dampak**: APK berikutnya yang di-generate dari Publish akan dapat berkomunikasi HTTP ke IP LAN (`192.168.x.x`) & IP Tailscale (`100.x.x.x`). HTTPS tetap preferred utk production, tapi utk LAN internal + Tailscale (yang sudah encrypted end-to-end di layer VPN) cleartext aman.

**Catatan**: Fix ini butuh **generate build APK baru** — tidak cukup redeploy. Prebuild Expo akan menulis ulang AndroidManifest.xml dengan flag cleartext.



## Session 2026-06 (Iter 21) — Fix APK Install & Device Mode Indicator
81. **Fix APK "paket tampaknya tidak valid"**: Dihapus duplikat `usesCleartextTraffic` di app.json (satu di `android` root, satu lagi di dalam `expo-build-properties` plugin). Deployment agent memvalidasi `expo_native_config_ok: true`. User perlu generate build APK baru via Publish untuk fix berlaku.
82. **Device Mode Indicator** (P1): Komponen `LanModeBanner` baru (`src/components/lan-mode-banner.tsx`) + hook reaktif `useLanMode` (`src/lan-sync/use-lan-mode.ts`). Di-inject di header layar Kasir di bawah SyncBanner.
    - Mode **SERVER**: Badge hijau brand + port + status "Aktif/Mati" (ambil dari `getLanSyncServerStatus()` tiap 15s)
    - Mode **KASIR TERHUBUNG**: Badge biru info + host:port + dot status (hijau=terhubung, kuning=cek, merah=terputus); ping `/health` tiap 10s via `pingLanSyncServer`
    - Mode **MANDIRI**: Banner disembunyikan agar tampilan tetap bersih (default)
    - Re-poll config saat app jadi aktif (AppState listener) agar user yang ganti mode di settings langsung ter-refleksi.
