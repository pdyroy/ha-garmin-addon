/**
 * HA Ingress Proxy — rewrites Next.js HTML to work behind HA ingress.
 *
 * Problem: HA ingress serves the addon at /api/hassio_ingress/<token>/
 * but Next.js emits absolute paths like /_next/static/... which the
 * browser resolves against the HA host, bypassing ingress → 404.
 *
 * Solution: This proxy sits between HA ingress (port 3000) and Next.js
 * (port 3001). For HTML responses, it rewrites absolute paths to include
 * the ingress prefix from the X-Ingress-Path header. Non-HTML responses
 * (JS, CSS, images, API) pass through unchanged.
 */
const http = require("http");

const NEXT_PORT = parseInt(process.env.NEXT_INTERNAL_PORT || "3001", 10);
const LISTEN_PORT = parseInt(process.env.PORT || "3000", 10);

/**
 * This port sits on the shared hassio bridge network, so every other add-on
 * can dial it. Home Assistant ingress only protects the path *through* the
 * Supervisor — it does not stop a neighbour from connecting here directly,
 * and Next.js behind this proxy runs without a login (single-user model).
 *
 * So the proxy is the gate, in two steps:
 *   1. the peer must be the Supervisor (or loopback, for the add-on's own
 *      health checks). Everything else gets 403 before it reaches Next.js;
 *   2. requests that pass are stamped with the per-boot INGRESS_AUTH_TOKEN,
 *      after any client-supplied copy of that header is stripped. Next.js
 *      binds to 127.0.0.1 and grants its single-user session only to
 *      requests carrying the token, so the stamp cannot be forged from
 *      outside.
 *
 * INGRESS_TRUSTED_PEERS overrides the allowlist (comma-separated). The
 * literal value "any" disables the peer check — for running the container
 * outside Home Assistant, see scripts/build-local.sh. Without a token the
 * proxy still forwards, and Next.js then requires a real session.
 */
const SUPERVISOR_IP = "172.30.32.2";
const INGRESS_AUTH_HEADER = "x-pacer-ingress";
const INGRESS_AUTH_TOKEN = (process.env.INGRESS_AUTH_TOKEN || "").trim();
const TRUSTED_PEERS_RAW = (
  process.env.INGRESS_TRUSTED_PEERS || SUPERVISOR_IP
).trim();
const ALLOW_ANY_PEER = TRUSTED_PEERS_RAW === "any";
const TRUSTED_PEERS = new Set(
  TRUSTED_PEERS_RAW.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .concat(["127.0.0.1", "::1"]),
);

/** "::ffff:172.30.32.2" and "172.30.32.2" are the same peer. */
function normalizePeer(address) {
  if (!address) return "";
  return address.startsWith("::ffff:") ? address.slice(7) : address;
}

function isTrustedPeer(address) {
  return ALLOW_ANY_PEER || TRUSTED_PEERS.has(normalizePeer(address));
}

/**
 * Escape a string for safe insertion into a double-quoted HTML attribute.
 * The ingress path comes from the X-Ingress-Path request header, which is
 * attacker-controllable if the proxy port is reached directly (bypassing HA),
 * so it must be escaped before being reflected into the page.
 */
function escapeHtmlAttr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const server = http.createServer((clientReq, clientRes) => {
  const peer = normalizePeer(clientReq.socket.remoteAddress);
  if (!isTrustedPeer(peer)) {
    console.warn(
      `[ingress-proxy] refused ${clientReq.method} ${clientReq.url} from ${peer} ` +
        `(not in INGRESS_TRUSTED_PEERS=${TRUSTED_PEERS_RAW})`,
    );
    clientRes.writeHead(403, { "content-type": "text/plain" });
    clientRes.end("Forbidden: requests must arrive through Home Assistant ingress\n");
    return;
  }

  // The ingress path is supplied by the X-Ingress-Path header. It is only
  // trustworthy when HA sets it; if the proxy port is reached directly the
  // value is attacker-controlled. Accept only a well-formed path so it can be
  // safely reflected into the rewritten HTML/URLs below; otherwise ignore it.
  const rawIngressPath = clientReq.headers["x-ingress-path"] || "";
  const ingressPath = /^\/[A-Za-z0-9_\-/]*$/.test(rawIngressPath)
    ? rawIngressPath
    : "";

  // Strip ingress prefix from incoming URL before forwarding to Next.js
  let forwardPath = clientReq.url;
  if (ingressPath && forwardPath.startsWith(ingressPath)) {
    forwardPath = forwardPath.substring(ingressPath.length) || "/";
  }

  // Strip accept-encoding so Next.js returns uncompressed HTML
  const headers = { ...clientReq.headers };
  if (ingressPath) {
    delete headers["accept-encoding"];
  }

  // Drop any client-supplied ingress token before stamping our own. Node
  // lower-cases incoming header names, but delete defensively by comparison
  // so a future change of that behaviour cannot reopen the hole.
  for (const name of Object.keys(headers)) {
    if (name.toLowerCase() === INGRESS_AUTH_HEADER) delete headers[name];
  }
  if (INGRESS_AUTH_TOKEN) headers[INGRESS_AUTH_HEADER] = INGRESS_AUTH_TOKEN;

  const proxyOpts = {
    hostname: "127.0.0.1",
    port: NEXT_PORT,
    path: forwardPath,
    method: clientReq.method,
    headers: headers,
  };

  const proxyReq = http.request(proxyOpts, (proxyRes) => {
    const ct = proxyRes.headers["content-type"] || "";
    const isHtml = ct.includes("text/html");

    // Rewrite /_next/ in ALL text-based responses, not just HTML.
    // Next.js emits /_next/ references in many response types:
    //   - HTML: <script src>, <link href>, RSC inline data
    //   - JS: turbopack runtime base path, dynamic import paths
    //   - CSS: @font-face url() references
    //   - RSC flight responses (text/x-component): module references
    //   - text/plain: fallback content-type for some Next.js responses
    // Rewriting only HTML leaves JS/CSS/RSC with raw /_next/ paths that
    // bypass ingress → 404 → React hydration fails.
    const isText =
      ct.includes("text/") ||
      ct.includes("javascript") ||
      ct.includes("json") ||
      ct.includes("x-component");
    const needsRewrite = ingressPath && isText;

    console.log(
      `[ingress-proxy] ${clientReq.method} ${clientReq.url} → fwd:${forwardPath} → ${proxyRes.statusCode} (${ct.split(";")[0]}${needsRewrite ? " REWRITE" : ""})`,
    );

    if (needsRewrite) {
      // Buffer response and rewrite /_next/ paths
      const chunks = [];
      proxyRes.on("data", (c) => chunks.push(c));
      proxyRes.on("end", () => {
        let body = Buffer.concat(chunks).toString("utf-8");

        // Core rewrite: prefix all /_next/ with ingress path.
        // Safe because /_next/ is a unique Next.js prefix that only appears
        // in URL references. The proxy always receives raw content from
        // Next.js (never already-rewritten content), so no double-prefix risk.
        body = body.replaceAll("/_next/", ingressPath + "/_next/");

        if (isHtml) {
          // HTML-specific: rewrite href/src/action attributes for non-_next
          // absolute paths. Uses regex to only match HTML attributes, NOT
          // inline script/JSON content (avoids corrupting RSC payloads).
          const escaped = ingressPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const attrRegex = new RegExp(
            `((?:src|href|action)=["'])(/)(?!/|${escaped.slice(1)}|_next/)`,
            "g",
          );
          body = body.replace(attrRegex, `$1${ingressPath}/`);

          // Inject ingress path into a meta tag so client JS can read it
          body = body.replace(
            "<head>",
            `<head><meta name="ingress-path" content="${escapeHtmlAttr(ingressPath)}">`,
          );
        }

        const resHeaders = { ...proxyRes.headers };
        delete resHeaders["content-length"];
        delete resHeaders["transfer-encoding"];
        resHeaders["content-length"] = Buffer.byteLength(body);

        clientRes.writeHead(proxyRes.statusCode, resHeaders);
        clientRes.end(body);
      });
    } else {
      // Pass through binary/non-text responses unchanged (images, fonts, etc.)
      clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(clientRes);
    }
  });

  proxyReq.on("error", (err) => {
    console.error("[ingress-proxy] upstream error:", err.message);
    if (!clientRes.headersSent) {
      clientRes.writeHead(502);
      clientRes.end("Bad Gateway: Next.js not ready");
    }
  });

  clientReq.pipe(proxyReq);
});

server.listen(LISTEN_PORT, "0.0.0.0", () => {
  console.log(
    `[ingress-proxy] Listening on 0.0.0.0:${LISTEN_PORT} → Next.js :${NEXT_PORT}`,
  );
  console.log(
    `[ingress-proxy] Trusted peers: ${ALLOW_ANY_PEER ? "any (peer check disabled)" : [...TRUSTED_PEERS].join(", ")}`,
  );
  if (!INGRESS_AUTH_TOKEN) {
    console.warn(
      "[ingress-proxy] INGRESS_AUTH_TOKEN is unset — Next.js will require a real session",
    );
  }
});
