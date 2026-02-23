// src/app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Avito CRM",
  description: "Avito CRM",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className="min-h-screen bg-zinc-300 text-zinc-900">{children}</body>
    </html>
  );
}
