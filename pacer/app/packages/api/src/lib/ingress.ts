import { timingSafeEqual } from "node:crypto";

/**
 * Proof that a request arrived through Home Assistant ingress.
 *
 * The add-on runs single-user: there is no login, and the app treats every
 * request as the one athlete. That is only safe if every request really did
 * come from Home Assistant. It used to be assumed — `DEV_BYPASS_AUTH=true`
 * disabled the session guard outright — but the ingress proxy listens on
 * `0.0.0.0:3000` inside the shared hassio bridge network, so any other
 * add-on could reach it directly and read the entire health history or
 * overwrite the Garmin tokens without a credential.
 *
 * Now the proxy is the only trusted entry point: it rejects peers that are
 * not the Supervisor, strips any client-supplied copy of this header, and
 * stamps the per-boot token from `INGRESS_AUTH_TOKEN` onto what it forwards.
 * Next.js itself binds to 127.0.0.1, so nothing else in the network can
 * produce a request carrying a valid token.
 *
 * Fails closed: no token configured means no trust.
 */
export const INGRESS_AUTH_HEADER = "x-pacer-ingress";

/** Constant-time compare, so the token cannot be guessed byte by byte. */
function secureEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function isTrustedIngressRequest(
  headers: Headers | null | undefined,
): boolean {
  // eslint-disable-next-line no-restricted-properties
  const expected = process.env.INGRESS_AUTH_TOKEN?.trim();
  if (!expected || !headers) return false;
  const provided = headers.get(INGRESS_AUTH_HEADER);
  if (!provided) return false;
  return secureEquals(provided, expected);
}

/**
 * Whether the single-user session fallback may be used for this request.
 *
 * Three ways in, in descending order of trust:
 *  - the request came through HA ingress (the add-on's normal path),
 *  - `NODE_ENV !== "production"` (local development, e2e),
 *  - `DEV_BYPASS_AUTH=true`, an explicit opt-in for running the container
 *    outside Home Assistant (see `scripts/build-local.sh`). The add-on no
 *    longer sets this; it exists so a developer can deliberately turn the
 *    guard off, not as a production default.
 */
export function isSingleUserFallbackAllowed(
  headers: Headers | null | undefined,
): boolean {
  if (isTrustedIngressRequest(headers)) return true;
  // eslint-disable-next-line no-restricted-properties
  if (process.env.NODE_ENV !== "production") return true;
  // eslint-disable-next-line no-restricted-properties
  return process.env.DEV_BYPASS_AUTH === "true";
}
