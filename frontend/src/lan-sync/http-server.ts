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

function parseRequestHead(headBuffer: Buffer): { method: string; path: string; headers: Record<string, string> } | null {
  const text = headBuffer.toString("utf8");
  const firstLineEnd = text.indexOf("\r\n");
  if (firstLineEnd < 0) return null;
  const statusLine = text.slice(0, firstLineEnd);
  const [method, path] = statusLine.split(" ");
  if (!method || !path) return null;

  const headers: Record<string, string> = {};
  const headerText = text.slice(firstLineEnd + 2);
  for (const line of headerText.split("\r\n")) {
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const k = line.slice(0, idx).trim().toLowerCase();
    const v = line.slice(idx + 1).trim();
    headers[k] = v;
  }
  return { method: method.toUpperCase(), path, headers };
}

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
      let headBuffer = Buffer.alloc(0);
      let bodyBuffer = Buffer.alloc(0);
      let headParsed = false;
      let contentLength = 0;
      let method = "";
      let path = "";
      let headers: Record<string, string> = {};

      const bail = (status: number, msg: string) => {
        try {
          // Pakai `end(buffer)` agar atomic — tulis + close setelah flush.
          socket.end(buildResponse(status, JSON.stringify({ detail: msg })));
        } catch { /* noop */ }
      };

      // Flag agar response hanya dikirim 1x (hindari race antar chunk).
      let responseSent = false;

      const sendResponse = (resp: Buffer) => {
        if (responseSent) return;
        responseSent = true;
        try {
          // CRITICAL: pakai `socket.end(buffer)` BUKAN `write()` + `end()` terpisah.
          // react-native-tcp-socket write adalah async; kalau end() dipanggil
          // sebelum data ter-flush, Android akan dapat "unexpected end of stream".
          socket.end(resp);
        } catch { /* noop */ }
      };

      socket.on("data", async (chunk: Buffer) => {
        try {
          if (responseSent) return;
          if (!headParsed) {
            headBuffer = Buffer.concat([headBuffer, chunk]);
            if (headBuffer.length > 64 * 1024) {
              bail(413, "Header terlalu besar");
              return;
            }
            const sep = headBuffer.indexOf("\r\n\r\n");
            if (sep < 0) return; // tunggu chunk berikutnya
            const headPart = headBuffer.subarray(0, sep);
            const bodyStart = headBuffer.subarray(sep + 4);
            const parsed = parseRequestHead(headPart);
            if (!parsed) { bail(400, "Request malformed"); return; }
            method = parsed.method;
            path = parsed.path;
            headers = parsed.headers;
            headParsed = true;
            contentLength = Number(headers["content-length"] || "0");
            if (contentLength > BODY_LIMIT_BYTES) { bail(413, "Body terlalu besar"); return; }
            bodyBuffer = bodyStart;
          } else {
            bodyBuffer = Buffer.concat([bodyBuffer, chunk]);
            if (bodyBuffer.length > BODY_LIMIT_BYTES) { bail(413, "Body terlalu besar"); return; }
          }

          if (headParsed && bodyBuffer.length >= contentLength) {
            const bodyStr = contentLength > 0 ? bodyBuffer.subarray(0, contentLength).toString("utf8") : "";
            const resp = await handleRequest(method, path, headers, bodyStr);
            sendResponse(resp);
          }
        } catch (e) {
          const detail = e instanceof Error ? e.message : "Server error";
          bail(500, detail);
        }
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
