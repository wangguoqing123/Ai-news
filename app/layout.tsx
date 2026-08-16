import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const title = "Signal Desk｜信号台";
  const description = "把分散信号，变成理解、知识与选题";
  const socialImage = `${origin}/og.png`;
  return {
    metadataBase: new URL(origin),
    title,
    description,
    manifest: "/manifest.webmanifest",
    applicationName: "Signal Desk",
    appleWebApp: { capable: true, title: "信号台", statusBarStyle: "default" },
    other: { "theme-color": "#315C45" },
    icons: { icon: "/icon-192.png", shortcut: "/icon-192.png", apple: "/icon-192.png" },
    openGraph: { title, description, type: "website", locale: "zh_CN", siteName: "Signal Desk", images: [{ url: socialImage, width: 1731, height: 909, alt: "Signal Desk 信号台" }] },
    twitter: { card: "summary_large_image", title, description, images: [socialImage] },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
