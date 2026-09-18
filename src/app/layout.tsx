import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MediVault - Secure Medical Document Management",
  description: "Scan, store, and manage patient medical documents securely. Built for clinic doctors with offline support.",
  keywords: ["MediVault", "medical documents", "clinic", "doctor", "patient records", "document scanner", "HIPAA"],
  authors: [{ name: "MediVault" }],
  icons: {
    icon: "/icon-192.png",
    apple: "/icon-192.png",
  },
  openGraph: {
    title: "MediVault",
    description: "Secure Medical Document Management for Clinic Doctors",
    type: "website",
  },
  manifest: "/manifest.json",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#10b981" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        {/* FEATURE D: apply the persisted locale's lang/dir BEFORE first paint
            (SPA in WKWebView — prevents an LTR flash for Arabic users). The
            provider re-applies on mount; suppressHydrationWarning covers the
            attribute diff. Mirrors src/i18n/index.tsx (same storage key). */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var l=localStorage.getItem('medivault-language');if(l==='ar'||l==='en'){document.documentElement.lang=l;document.documentElement.dir=(l==='ar'?'rtl':'ltr')}}catch(e){}})()",
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
