import type { Metadata } from "next";
import { Space_Grotesk } from "next/font/google";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { NavBar } from "@/components/NavBar";

/* Display/headline font: Space Grotesk — geometric with quirky terminals */
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
});

export const metadata: Metadata = {
  title: "Cornerstone",
  description: "NBA skill evaluation and roster builder",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} ${spaceGrotesk.variable}`}
    >
      <body id="app-body" className="font-sans antialiased">
        {/* Global navigation — shown on all pages */}
        <NavBar />
        <div id="page-content">{children}</div>
      </body>
    </html>
  );
}
