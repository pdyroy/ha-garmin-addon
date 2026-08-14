import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { cn } from "@acme/ui";
import { ThemeProvider, ThemeToggle } from "@acme/ui/theme";
import { Toaster } from "@acme/ui/toast";

import { AppNav } from "~/app/_components/app-nav";
import { IngressProvider } from "~/app/_components/ingress-provider";
import { env } from "~/env";
import { TRPCReactProvider } from "~/trpc/react";

import "~/app/styles.css";

export const metadata: Metadata = {
  metadataBase: new URL(
    env.VERCEL_ENV === "production"
      ? "https://pacer.app"
      : "http://localhost:3000",
  ),
  title: "Pacer — Dein persönlicher Trainingscoach",
  description:
    "WHOOP-ähnliche Coaching-App auf Basis deiner Garmin-Daten. Tägliche Readiness-Werte, personalisierte Workouts und smarte Trainingsempfehlungen.",
  openGraph: {
    title: "Pacer",
    description:
      "Tägliche Readiness-Werte + personalisierte Workouts aus deinen Garmin-Daten",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "white" },
    { media: "(prefers-color-scheme: dark)", color: "black" },
  ],
};

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});
const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export default function RootLayout(props: { children: React.ReactNode }) {
  return (
    <html lang="de" suppressHydrationWarning>
      <body
        className={cn(
          "bg-background text-foreground min-h-screen font-sans antialiased",
          geistSans.variable,
          geistMono.variable,
        )}
      >
        <ThemeProvider>
          <IngressProvider>
            <AppNav />
            <TRPCReactProvider>{props.children}</TRPCReactProvider>
          </IngressProvider>
          <div className="absolute right-4 bottom-4">
            <ThemeToggle />
          </div>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
