import "server-only";

import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { isSingleUserFallbackAllowed } from "@acme/api/ingress";

import { getSession } from "~/auth/server";

/**
 * Session guard for operational Garmin API routes (auth/sync/recompute).
 *
 * Mirrors the tRPC protected-procedure fallback (packages/api/src/trpc.ts):
 * inside the HA add-on there is no app session, because Home Assistant
 * ingress is the authentication layer. The proxy proves that a request came
 * through ingress by stamping a per-boot token header on it; without that
 * proof a caller inside the hassio network could otherwise trigger Garmin
 * logins, import or delete tokens, and start syncs unauthenticated.
 *
 * @returns a 401 response to short-circuit with, or `null` when allowed.
 */
export async function requireSession(): Promise<NextResponse | null> {
  if (isSingleUserFallbackAllowed(await headers())) return null;

  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { success: false, message: "Unauthorized" },
      { status: 401 },
    );
  }
  return null;
}
