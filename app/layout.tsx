import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "附近喝什麼｜定位抽一杯",
  description: "選擇附近 1、3、5 公里，搜尋飲料品項，隨機抽一杯和店家提供的糖冰選項。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <body className="antialiased">{children}</body>
    </html>
  );
}
