import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { isRtlLocale, type Locale } from "@/i18n/config";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
