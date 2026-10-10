/**
 * Mini HTTP/1.1 server untuk LAN sync.
 *
 * Dibangun di atas `react-native-tcp-socket`. Hanya handle request JSON
 * sederhana untuk endpoint `/api/*`. Semua request dibungkus `localFetch`
 * (dispatcher ke handler SQLite lokal).
 *
 * Fitur minimal:
 * - Parsing HTTP request (status-line, headers, body)
 * - Serialisasi HTTP response dengan Content-Length tepat
 * - CORS header permisif agar bisa diakses browser dev
 * - Content-Type JSON otomatis
 * - Chunked body handling: 1 request per koneksi (keep-alive OFF)
 * - Body size limit 2MB
 *
 * TIDAK mendukung:
 * - HTTPS/TLS (gunakan Tailscale/VPN untuk enkripsi antar-device)
 * - multipart/form-data (handler tidak membutuhkan)
 * - WebSocket
 */
import { Buffer } from "buffer";
import TcpSocket from "react-native-tcp-socket";

import { localFetch, type LocalResponse } from "@/src/local-backend";

const BODY_LIMIT_BYTES = 2 * 1024 * 1024;

type ServerHandle = {
  server: ReturnType<typeof TcpSocket.createServer>;
  port: number;
  startedAt: number;
};

let active: ServerHandle | null = null;

// Parser lama berbasis Buffer dibuang; sekarang pakai string parser inline
// di dalam socket.on('data'), karena chunk react-native-tcp-socket tidak
// selalu kompatibel dengan Buffer polyfill di Android.

function buildResponse(status: number, body: string, extraHeaders: Record<string, string> = {}): Buffer {
  const bodyBuffer = Buffer.from(body, "utf8");
  const statusText =
    status === 200 ? "OK" :
    status === 204 ? "No Content" :
    status === 400 ? "Bad Request" :
    status === 401 ? "Unauthorized" :
    status === 403 ? "Forbidden" :
    status === 404 ? "Not Found" :
    status === 413 ? "Payload Too Large" :
    status === 500 ? "Internal Server Error" :
    "OK";

  const headers = [
    `HTTP/1.1 ${status} ${statusText}`,
    "Content-Type: application/json; charset=utf-8",
    `Content-Length: ${bodyBuffer.length}`,
    "Connection: close",
    "Access-Control-Allow-Origin: *",
    "Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers: Authorization, Content-Type",
    ...Object.entries(extraHeaders).map(([k, v]) => `${k}: ${v}`),
  ];
  return Buffer.concat([Buffer.from(headers.join("\r\n") + "\r\n\r\n", "utf8"), bodyBuffer]);
}

async function handleRequest(method: string, path: string, headers: Record<string, string>, body: string): Promise<Buffer> {
  // CORS preflight
  if (method === "OPTIONS") {
    return buildResponse(204, "");
  }

  // Health check — no auth
  if (path === "/" || path === "/health" || path === "/api/health") {
    return buildResponse(200, JSON.stringify({ ok: true, service: "jtpoin-lan-sync", version: 1 }));
  }

  // Buang prefix /api
  let apiPath = path;
  if (apiPath.startsWith("/api/")) apiPath = apiPath.slice(4);
  else if (apiPath === "/api") apiPath = "/";

  // Hanya route yang dikenal localFetch yang di-handle; selain itu 404
  const auth = headers["authorization"] || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;

  let parsedBody: unknown = null;
  if (body) {
    try { parsedBody = JSON.parse(body); } catch { parsedBody = body; }
  }

  let res: LocalResponse;
  try {
    res = await localFetch({
      method: (method === "GET" || method === "POST" || method === "PUT" || method === "DELETE") ? method : "GET",
      path: apiPath,
      body: parsedBody,
      token,
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : "Internal error";
    return buildResponse(500, JSON.stringify({ detail }));
  }

  const bodyText = JSON.stringify(res.data ?? null);
  return buildResponse(res.status, bodyText);
}

/**
 * Start mini HTTP server pada port tertentu. Idempotent — kalau sudah
 * running pada port sama, langsung return handle existing.
 */
export async function startLanSyncServer(port: number): Promise<{ port: number }> {
  if (active && active.port === port) return { port: active.port };
  if (active) await stopLanSyncServer();

  return new Promise((resolve, reject) => {
    const server = TcpSocket.createServer((socket: any) => {
      // Minta library decode chunk sebagai UTF-8 string langsung. Lebih
      // reliable dibanding konversi Buffer manual di Android (chunk kadang
      // base64/Uint8Array mentah tergantung versi RN).
      try { socket.setEncoding?.("utf8"); } catch { /* noop */ }

      let accumulated = "";
      let responseSent = false;
      let dispatched = false;

      // Normalisasi chunk apapun → string UTF-8 (dipakai jika setEncoding gagal).
      const chunkToString = (chunk: any): string => {
        if (chunk == null) return "";
        if (typeof chunk === "string") return chunk;
        try {
          if (Buffer.isBuffer(chunk)) return chunk.toString("utf8");
        } catch { /* fall through */ }
        try {
          return Buffer.from(chunk).toString("utf8");
        } catch { /* fall through */ }
        try {
          return String.fromCharCode.apply(null, Array.from(chunk as any));
        } catch {
          return String(chunk);
        }
      };

      const bail = (status: number, msg: string) => {
        if (responseSent) return;
        responseSent = true;
        try {
          socket.end(buildResponse(status, JSON.stringify({ detail: msg })));
        } catch { /* noop */ }
      };

      const sendResponse = (resp: Buffer) => {
        if (responseSent) return;
        responseSent = true;
        try {
          socket.end(resp);
        } catch { /* noop */ }
      };

      // Decode Transfer-Encoding: chunked body ke plain string.
      // Return `null` kalau belum lengkap, string (bisa kosong) kalau selesai.
      const decodeChunkedBody = (raw: string): string | null => {
        let out = "";
        let pos = 0;
        while (pos < raw.length) {
          const crlf = raw.indexOf("\r\n", pos);
          if (crlf < 0) return null;
          const sizeHex = raw.slice(pos, crlf).split(";")[0].trim();
          if (sizeHex.length === 0) return null;
          const size = parseInt(sizeHex, 16);
          if (!Number.isFinite(size) || size < 0) return out;
          pos = crlf + 2;
          if (size === 0) return out;
          if (raw.length < pos + size + 2) return null;
          out += raw.slice(pos, pos + size);
          pos += size;
          if (raw.slice(pos, pos + 2) !== "\r\n") return null;
          pos += 2;
        }
        return null;
      };

      const tryParseAndDispatch = async (final: boolean) => {
        if (responseSent || dispatched) return;
        const sep = accumulated.indexOf("\r\n\r\n");
        if (sep < 0) {
          if (final) bail(400, "Request malformed (header incomplete)");
          return;
        }
        const headText = accumulated.slice(0, sep);
        const bodyRaw = accumulated.slice(sep + 4);
        const firstLineEnd = headText.indexOf("\r\n");
        const statusLine = firstLineEnd < 0 ? headText : headText.slice(0, firstLineEnd);
        const parts = statusLine.split(" ");
        if (parts.length < 2 || !parts[0] || !parts[1]) {
          bail(400, "Request malformed (status line)");
          return;
        }
        const method = parts[0].toUpperCase();
        const path = parts[1];
        const headers: Record<string, string> = {};
        const headerLines = firstLineEnd < 0 ? [] : headText.slice(firstLineEnd + 2).split("\r\n");
        for (const line of headerLines) {
          if (!line) continue;
          const idx = line.indexOf(":");
          if (idx < 0) continue;
          headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
        }

        const clHeader = headers["content-length"];
        const te = (headers["transfer-encoding"] || "").toLowerCase();
        const transferChunked = te.includes("chunked");
        const contentLength: number | null = clHeader !== undefined ? (Number(clHeader) || 0) : null;

        if (contentLength !== null && contentLength > BODY_LIMIT_BYTES) {
          bail(413, "Body terlalu besar");
          return;
        }
        if (bodyRaw.length > BODY_LIMIT_BYTES * 1.5) {
          bail(413, "Request terlalu besar");
          return;
        }

        let body: string;
        if (transferChunked) {
          const decoded = decodeChunkedBody(bodyRaw);
          if (decoded === null) {
            if (!final) return; // tunggu chunk tambahan
            body = bodyRaw; // best-effort kalau terminator belum tiba
          } else {
            body = decoded;
          }
        } else if (contentLength !== null && contentLength > 0) {
          // Pakai byte length agar aman untuk multi-byte UTF-8.
          if (Buffer.byteLength(bodyRaw, "utf8") < contentLength && !final) {
            return; // tunggu data lagi
          }
          body = Buffer.from(bodyRaw, "utf8").subarray(0, contentLength).toString("utf8");
        } else if (contentLength === 0) {
          body = "";
        } else {
          // CL absen & bukan chunked.
          // Untuk method tanpa body yang umum, langsung dispatch dengan body ""
          // (biar GET/HEAD/DELETE/OPTIONS tidak hang menunggu `end`).
          if (method === "GET" || method === "HEAD" || method === "DELETE" || method === "OPTIONS") {
            body = bodyRaw; // biasanya kosong
          } else if (!final) {
            return; // tunggu socket.end
          } else {
            body = bodyRaw;
          }
        }

        dispatched = true;
        try {
          const resp = await handleRequest(method, path, headers, body);
          sendResponse(resp);
        } catch (e) {
          const detail = e instanceof Error ? e.message : "Server error";
          bail(500, detail);
        }
      };

      socket.on("data", async (chunk: any) => {
        try {
          if (responseSent) return;
          accumulated += (typeof chunk === "string" ? chunk : chunkToString(chunk));
          await tryParseAndDispatch(false);
        } catch (e) {
          bail(500, e instanceof Error ? e.message : "Server error");
        }
      });

      socket.on("end", async () => {
        try {
          if (responseSent) return;
          await tryParseAndDispatch(true);
        } catch { /* noop */ }
      });

      // Fallback terakhir di Android: kadang 'end' tidak fire tapi 'close' iya.
      socket.on("close", async () => {
        try {
          if (responseSent) return;
          await tryParseAndDispatch(true);
        } catch { /* noop */ }
      });

      socket.on("error", () => { /* client disconnect */ });
    });

    server.on("error", (err: any) => {
      reject(err instanceof Error ? err : new Error(String(err)));
    });

    server.listen({ port, host: "0.0.0.0" }, () => {
      active = { server, port, startedAt: Date.now() };
      resolve({ port });
    });
  });
}

export async function stopLanSyncServer(): Promise<void> {
  if (!active) return;
  const handle = active;
  active = null;
  return new Promise((resolve) => {
    try {
      handle.server.close(() => resolve());
    } catch {
      resolve();
    }
  });
}

export function getLanSyncServerStatus(): { running: boolean; port: number | null; uptime_ms: number | null } {
  if (!active) return { running: false, port: null, uptime_ms: null };
  return { running: true, port: active.port, uptime_ms: Date.now() - active.startedAt };
}
