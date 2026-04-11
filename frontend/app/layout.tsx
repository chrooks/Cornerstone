import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { NavBar } from "@/components/NavBar";

// Inter is a reliable system font available in Next.js 14 via next/font/google
const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Cornerstone",
  description: "NBA analytics platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={inter.variable}>
      <body id="app-body" className="font-sans antialiased">
        {/* Global navigation — shown on all pages */}
        <NavBar />
        <div id="page-content">{children}</div>
      </body>
    </html>
  );
}
