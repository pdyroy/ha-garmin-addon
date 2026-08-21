#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// Check the ingress proxy's gate: foreign peers are refused, and the
// per-boot token that Next.js trusts cannot be supplied by the client.
//
// Run with:  node scripts/test-ingress-proxy.js
//
// The foreign-peer case needs a non-loopback address on this machine; it is
// skipped (loudly) when there is none, e.g. in a network-less container.

const assert = require("node:assert");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const PROXY_PATH = path.join(
  __dirname,
  "..",
  "pacer",
  "rootfs",
  "app",
  "ingress-proxy.js",
);
const UPSTREAM_PORT = 34_999;
const PROXY_PORT = 34_998;
const TOKEN = "token-for-the-test-only";

/** First non-internal IPv4 address, or null. */
function foreignAddress() {
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) return address.address;
    }
  }
  return null;
}

function request(host, headers) {
  return new Promise((resolve) => {
    const req = http.request(
      { host, port: PROXY_PORT, path: "/", headers },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on("error", (err) => resolve(`ERR ${err.message}`));
    req.end();
  });
}

async function main() {
  const tokensSeen = [];
  const upstream = http.createServer((req, res) => {
    tokensSeen.push(req.headers["x-pacer-ingress"] ?? null);
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
  });
  await new Promise((resolve) =>
    upstream.listen(UPSTREAM_PORT, "127.0.0.1", resolve),
  );

  const proxy = spawn("node", [PROXY_PATH], {
    env: {
      ...process.env,
      PORT: String(PROXY_PORT),
      NEXT_INTERNAL_PORT: String(UPSTREAM_PORT),
      INGRESS_AUTH_TOKEN: TOKEN,
      INGRESS_TRUSTED_PEERS: "172.30.32.2",
    },
    stdio: ["ignore", "ignore", "ignore"],
  });

  try {
    await new Promise((resolve) => setTimeout(resolve, 700));

    assert.strictEqual(
      await request("127.0.0.1", {}),
      200,
      "loopback must stay allowed — the add-on health-checks itself",
    );
    assert.strictEqual(
      tokensSeen.at(-1),
      TOKEN,
      "the proxy must stamp the ingress token on what it forwards",
    );

    assert.strictEqual(
      await request("127.0.0.1", { "x-pacer-ingress": "forged" }),
      200,
    );
    assert.strictEqual(
      tokensSeen.at(-1),
      TOKEN,
      "a client-supplied ingress token must be replaced, never forwarded",
    );

    const foreign = foreignAddress();
    if (foreign) {
      const before = tokensSeen.length;
      assert.strictEqual(
        await request(foreign, {}),
        403,
        `peer ${foreign} is not the Supervisor and must be refused`,
      );
      assert.strictEqual(
        tokensSeen.length,
        before,
        "a refused request must never reach Next.js",
      );
      console.log("ok — foreign peer refused with 403");
    } else {
      console.log("SKIPPED foreign-peer case: no non-loopback address here");
    }

    console.log("ok — loopback allowed, token stamped, forged token replaced");
  } finally {
    proxy.kill();
    upstream.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
