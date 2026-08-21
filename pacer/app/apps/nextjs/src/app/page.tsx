import { Suspense } from "react";
import { headers } from "next/headers";

import { isSingleUserFallbackAllowed } from "@acme/api/ingress";

import { getSession } from "~/auth/server";
import { PageShell } from "~/components/page-shell";
import { HydrateClient, prefetch, trpc } from "~/trpc/server";
import { AuthShowcase } from "./_components/auth-showcase";
import { DashboardHome } from "./_components/dashboard-home";

const DEV_USER_ID = "seed-user-001";

export default async function HomePage() {
  const session = await getSession();

  // Behind HA ingress (the add-on's single-user mode) and in local
  // development, fall back to the seed user so the app is usable without
  // OAuth. Real auth is required for anything else — see @acme/api/ingress.
  const devFallbackAllowed = isSingleUserFallbackAllowed(await headers());
  const userId = session?.user.id ?? (devFallbackAllowed ? DEV_USER_ID : null);

  if (!userId) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg items-center justify-center px-4">
        <AuthShowcase />
      </main>
    );
  }

  prefetch(trpc.readiness.getToday.queryOptions());
  prefetch(trpc.workout.getToday.queryOptions());
  prefetch(trpc.coach.getDailyRecommendation.queryOptions({ userId }));

  return (
    <HydrateClient>
      <PageShell density="data">
        <Suspense
          fallback={
            <div className="space-y-6">
              <div className="bg-muted h-8 w-48 animate-pulse rounded" />
              <div className="bg-muted h-40 animate-pulse rounded-2xl" />
              <div className="bg-muted h-32 animate-pulse rounded-2xl" />
            </div>
          }
        >
          <DashboardHome userId={userId} />
        </Suspense>
      </PageShell>
    </HydrateClient>
  );
}
