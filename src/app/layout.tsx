import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Veto — Policy Gate for AI Agents on Sui",
  description:
    "Every proposed transaction is checked against a deterministic, human-defined rule book — in plain code, not another model's opinion — before it touches the chain.",
  keywords: ["Sui", "AI agents", "policy", "guardrails", "Sui Overflow 2026"],
  authors: [{ name: "Veto" }],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <SonnerToaster position="bottom-right" richColors closeButton />
      </body>
    </html>
  );
}
