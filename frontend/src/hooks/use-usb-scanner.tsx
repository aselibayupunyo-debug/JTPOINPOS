/**
 * UsbScannerListener — menangkap input USB barcode scanner secara global
 * tanpa user perlu meletakkan kursor di kotak pencarian.
 *
 * USB barcode scanner umumnya bertindak sebagai HID keyboard: mengetik
 * karakter barcode dengan sangat cepat lalu menekan Enter. Komponen ini:
 *
 * **Native (Android/iOS)**: menampilkan TextInput tak kasat mata yang
 * auto-fokus. Soft keyboard disembunyikan (`showSoftInputOnFocus=false`
 * di Android) agar scanner HID tetap bisa mengetik tanpa muncul keyboard
 * virtual. Kalau fokus pindah ke input lain (user tap kolom pencarian /
 * modal checkout), hidden input tidak melawan — hanya re-focus bila tidak
 * ada input lain yang aktif.
 *
 * **Web (dev preview)**: pasang `document.addEventListener('keydown')`.
 * Pakai timing-based detection (gap antar-tombol <100ms = scanner,
 * >100ms = manual typing diabaikan). Kalau user sedang di input lain,
 * event dilewati.
 */
import { useEffect, useRef } from "react";
import { Platform, TextInput } from "react-native";

type Props = {
  /** Aktifkan listener? Set false kalau modal lain terbuka. */
  active: boolean;
  /** Dipanggil saat scanner mengirim Enter dan buffer berisi >= 3 karakter. */
  onScan: (code: string) => void;
};

const MIN_CODE_LEN = 3;
/** Gap maksimum antar-tombol untuk dianggap scanner (ms). */
const SCANNER_KEY_GAP_MS = 100;
/** Delay refocus setelah blur, agar tidak merebut focus dari input lain. */
const REFOCUS_DELAY_MS = 300;

export function UsbScannerListener({ active, onScan }: Props) {
  const inputRef = useRef<TextInput>(null);
  const bufferRef = useRef<string>("");
  const lastKeyRef = useRef<number>(0);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  // ---- Web path: global document keydown ---------------------------------
  useEffect(() => {
    if (!active || Platform.OS !== "web") return;
    if (typeof document === "undefined") return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Lewati kalau user sedang di input/textarea/contenteditable
      const el = (typeof document !== "undefined" ? document.activeElement : null) as HTMLElement | null;
      if (el) {
        const tag = el.tagName;
        const isTextField = tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
        if (isTextField) return;
      }

      const now = Date.now();
      if (now - lastKeyRef.current > SCANNER_KEY_GAP_MS) bufferRef.current = "";
      lastKeyRef.current = now;

      if (e.key === "Enter") {
        const code = bufferRef.current.trim();
        bufferRef.current = "";
        if (code.length >= MIN_CODE_LEN) {
          e.preventDefault();
          onScanRef.current(code);
        }
      } else if (e.key.length === 1) {
        bufferRef.current += e.key;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [active]);

  // ---- Native path: hidden auto-focus TextInput --------------------------
  useEffect(() => {
    if (!active || Platform.OS === "web") return;
    // Beri waktu layar render dulu baru focus
    const t = setTimeout(() => {
      try { inputRef.current?.focus(); } catch { /* ignore */ }
    }, 150);
    return () => clearTimeout(t);
  }, [active]);

  if (Platform.OS === "web") return null;

  if (!active) return null;

  return (
    <TextInput
      ref={inputRef}
      value=""
      autoFocus
      caretHidden
      // Android-only prop — React Native tipenya longgar, cast lewat any
      // untuk menghindari error TS pada platform lain.
      {...({ showSoftInputOnFocus: false } as any)}
      blurOnSubmit={false}
      autoCorrect={false}
      autoCapitalize="none"
      spellCheck={false}
      onChangeText={(t) => {
        // Append ke buffer; TextInput sendiri selalu di-clear di submit.
        bufferRef.current += t;
      }}
      onSubmitEditing={() => {
        const code = bufferRef.current.trim();
        bufferRef.current = "";
        try { inputRef.current?.clear(); } catch { /* ignore */ }
        if (code.length >= MIN_CODE_LEN) {
          onScanRef.current(code);
        }
        // Re-focus untuk scan berikutnya
        setTimeout(() => {
          try { inputRef.current?.focus(); } catch { /* ignore */ }
        }, 20);
      }}
      onBlur={() => {
        // Re-focus hanya kalau tidak ada input lain yang aktif.
        setTimeout(() => {
          try {
            const current = (TextInput as any).State?.currentlyFocusedInput?.();
            if (current && current !== inputRef.current) return; // input lain aktif
            if (!active) return;
            inputRef.current?.focus();
          } catch { /* ignore */ }
        }, REFOCUS_DELAY_MS);
      }}
      // Posisikan di luar layar supaya tidak terlihat / mengganggu layout.
      style={{
        position: "absolute",
        top: -1000,
        left: -1000,
        width: 1,
        height: 1,
        opacity: 0,
      }}
    />
  );
}
