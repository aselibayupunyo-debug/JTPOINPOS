/**
 * Normalisasi input kuantitas desimal (max 2 angka di belakang koma).
 *
 * - Menerima koma (`,`) atau titik (`.`) sebagai pemisah desimal
 * - Memangkas karakter non-numerik
 * - Mendukung draft "2," atau "0," saat user masih mengetik
 * - Mengembalikan `value: null` jika input kosong atau tidak valid parsial
 *
 * Pakai pola ini di TextInput controlled:
 *   const { display, value } = normalizeQtyInput(text);
 *   setDraft(display);
 *   if (value !== null && value > 0) commit(value);
 */
export function normalizeQtyInput(raw: string): { display: string; value: number | null } {
  let s = String(raw ?? "").replace(/[^\d.,]/g, "");

  const firstSep = s.search(/[.,]/);
  if (firstSep >= 0) {
    const head = s.slice(0, firstSep).replace(/[.,]/g, "");
    const tail = s
      .slice(firstSep + 1)
      .replace(/[.,]/g, "")
      .slice(0, 2);
    s = tail.length > 0 ? `${head},${tail}` : `${head},`;
  }

  // Cegah leading zero berlebih tapi izinkan "0" dan "0,"
  if (/^0\d/.test(s)) s = s.replace(/^0+/, "");
  if (s === "") return { display: "", value: null };

  const numeric = Number(s.replace(",", "."));
  return { display: s, value: Number.isFinite(numeric) ? numeric : null };
}

/** Format qty number → string id-ID (max 2 desimal, trailing zero di-strip). */
export function formatQtyID(q: number): string {
  const n = Number(q);
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("id-ID", { maximumFractionDigits: 2 });
}
