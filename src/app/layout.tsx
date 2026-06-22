import type { Metadata } from "next";
import { Fraunces, Hanken_Grotesk, Spline_Sans_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { isRtlLocale, type Locale } from "@/i18n/config";
import "./globals.css";

// Direction éditoriale (docs/design-system/typography.md). next/font self-host
// + subset automatiquement (pas de requête Google au runtime). display:swap
// évite le FOIT. Fraunces = titres/KPI ; Hanken = UI ; Spline Mono = chiffres.
const hankenSans = Hanken_Grotesk({
  variable: "--font-hanken",
  subsets: ["latin"],
  display: "swap",
});

const splineMono = Spline_Sans_Mono({
  variable: "--font-spline",
  subsets: ["latin"],
  display: "swap",
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  display: "swap",
  // La typo n'utilise Fraunces qu'en 600 (titres/KPI) — un seul cut statique
  // au lieu du variable complet, pour limiter le poids. Voir typography.md.
  weight: ["600"],
});

export const metadata: Metadata = {
  title: "Diabeo Backoffice",
  description: "Backoffice de gestion de l'insulinothérapie — Diabeo",
  // Les icônes sont AUTOMATIQUEMENT injectées par Next.js via les fichiers de
  // convention : `src/app/icon.tsx` (PNG 32×32 → `<link rel="icon">`) et
  // `src/app/apple-icon.tsx` (PNG 180×180 → `<link rel="apple-touch-icon">`).
  // Ne PAS déclarer `icons:` ici — cela produirait des doublons dans le `<head>`.
  // `public/logo.svg` a été supprimé (Fix #5) : les hex hardcodés driftaient
  // par rapport à tokens.ts ; le PNG généré par icon.tsx est suffisant.
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale() as Locale;
  const messages = await getMessages();
  const dir = isRtlLocale(locale) ? "rtl" : "ltr";

  return (
    <html
      lang={locale}
      dir={dir}
      className={`${hankenSans.variable} ${splineMono.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
