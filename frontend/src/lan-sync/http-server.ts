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
      // Pakai string buffer alih-alih Buffer karena chunk yang diterima
      // dari react-native-tcp-socket di Android bisa jadi Uint8Array mentah
      // yang tidak compatible dengan Buffer.indexOf/Buffer.concat polyfill.
      // String concat selalu bekerja di platform manapun.
      let accumulated = "";
      let headParsed = false;
      let contentLength: number | null = null; // null = Content-Length absen
      let transferChunked = false;
      let method = "";
      let path = "";
      let headers: Record<string, string> = {};

      // Normalisasi chunk apapun → string UTF-8.
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
        try {
          socket.end(buildResponse(status, JSON.stringify({ detail: msg })));
        } catch { /* noop */ }
      };

      let responseSent = false;
      const sendResponse = (resp: Buffer) => {
        if (responseSent) return;
        responseSent = true;
        try {
          // CRITICAL: pakai `socket.end(buffer)` BUKAN `write()` + `end()` terpisah.
          socket.end(resp);
        } catch { /* noop */ }
      };

      // Decode Transfer-Encoding: chunked body ke plain string.
      // Format: `<hex-size>\r\n<data>\r\n...0\r\n\r\n`.
      // Return `null` kalau belum lengkap (0-sized chunk + CRLF terakhir belum tiba).
      const decodeChunkedBody = (raw: string): string | null => {
        let out = "";
        let pos = 0;
        while (pos < raw.length) {
          const crlf = raw.indexOf("\r\n", pos);
          if (crlf < 0) return null;
          const sizeHex = raw.slice(pos, crlf).split(";")[0].trim();
          if (sizeHex.length === 0) return null;
          const size = parseInt(sizeHex, 16);
          if (!Number.isFinite(size) || size < 0) return "";
          pos = crlf + 2;
          if (size === 0) {
            // Terakhir — abaikan trailer headers kalau ada
            return out;
          }
          if (raw.length < pos + size + 2) return null; // belum lengkap
          out += raw.slice(pos, pos + size);
          pos += size;
          // Harus diikuti CRLF setelah data chunk
          if (raw.slice(pos, pos + 2) !== "\r\n") return null;
          pos += 2;
        }
        return null;
      };

      const dispatch = async (bodyStr: string) => {
        if (responseSent) return;
        try {
          const resp = await handleRequest(method, path, headers, bodyStr);
          sendResponse(resp);
        } catch (e) {
          const detail = e instanceof Error ? e.message : "Server error";
          bail(500, detail);
        }
      };

      socket.on("data", async (chunk: any) => {
        try {
          if (responseSent) return;
          accumulated += chunkToString(chunk);
          if (accumulated.length > 64 * 1024 && !headParsed) {
            bail(413, "Header terlalu besar");
            return;
          }

          if (!headParsed) {
            const sep = accumulated.indexOf("\r\n\r\n");
            if (sep < 0) return; // tunggu chunk berikutnya
            const headText = accumulated.slice(0, sep);
            const bodyStart = accumulated.slice(sep + 4);
            // Parse status line
            const firstLineEnd = headText.indexOf("\r\n");
            const statusLine = firstLineEnd < 0 ? headText : headText.slice(0, firstLineEnd);
            const parts = statusLine.split(" ");
            if (parts.length < 2 || !parts[0] || !parts[1]) {
              bail(400, "Request malformed (status line)");
              return;
            }
            method = parts[0].toUpperCase();
            path = parts[1];
            headers = {};
            const headerLines = firstLineEnd < 0 ? [] : headText.slice(firstLineEnd + 2).split("\r\n");
            for (const line of headerLines) {
              if (!line) continue;
              const idx = line.indexOf(":");
              if (idx < 0) continue;
              headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
            }
            headParsed = true;
            const clHeader = headers["content-length"];
            contentLength = clHeader !== undefined ? (Number(clHeader) || 0) : null;
            const te = (headers["transfer-encoding"] || "").toLowerCase();
            transferChunked = te.includes("chunked");
            if (contentLength !== null && contentLength > BODY_LIMIT_BYTES) {
              bail(413, "Body terlalu besar");
              return;
            }
            // Simpan sisa setelah header sebagai mulai body
            accumulated = bodyStart;

            // GET/DELETE/OPTIONS tanpa body yang eksplisit — langsung dispatch
            // kalau tidak ada CL dan tidak chunked (biasanya method tanpa body)
            // supaya tidak hang menunggu `end`.
            if (contentLength === null && !transferChunked && (method === "GET" || method === "DELETE" || method === "OPTIONS" || method === "HEAD")) {
              await dispatch(accumulated);
              return;
            }
          }

          // Transfer-Encoding: chunked — coba decode setiap kali ada data baru.
          if (transferChunked) {
            if (accumulated.length > BODY_LIMIT_BYTES) {
              bail(413, "Body terlalu besar");
              return;
            }
            const decoded = decodeChunkedBody(accumulated);
            if (decoded !== null) {
              await dispatch(decoded);
            }
            return;
          }

          // Content-Length path klasik
          if (contentLength !== null) {
            if (Buffer.byteLength(accumulated, "utf8") >= contentLength) {
              const bodyStr = contentLength > 0
                ? Buffer.from(accumulated, "utf8").subarray(0, contentLength).toString("utf8")
                : "";
              await dispatch(bodyStr);
            }
            return;
          }

          // CL absen & bukan chunked → tunggu socket.end sebagai delimiter.
          if (accumulated.length > BODY_LIMIT_BYTES) {
            bail(413, "Body terlalu besar");
          }
        } catch (e) {
          const detail = e instanceof Error ? e.message : "Server error";
          bail(500, detail);
        }
      });

      socket.on("end", async () => {
        try {
          if (responseSent) return;
          if (!headParsed) return; // koneksi putus sebelum header lengkap
          // Fallback: Content-Length absen & bukan chunked → semua data terkumpul = body.
          if (contentLength === null && !transferChunked) {
            await dispatch(accumulated);
          }
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
