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
  // L'icône PNG 32×32 (`/icon`) et l'apple-touch-icon (`/apple-icon`) sont
  // AUTOMATIQUEMENT injectés en `<link rel>` par Next.js depuis les fichiers
  // de convention `src/app/icon.tsx` + `src/app/apple-icon.tsx`. Pas la peine
  // de les redéclarer ici (ça produirait des doublons dans le `<head>`).
  //
  // On ajoute uniquement les éléments NON couverts par la convention :
  //  - Un favicon SVG vectoriel comme alternative (sera préféré par les
  //    browsers modernes — vector, infiniment scalable, ~600 octets).
  icons: {
    icon: { url: "/logo.svg", type: "image/svg+xml" },
  },
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
