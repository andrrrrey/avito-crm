// src/app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";
import AuroraBackground from "@/components/AuroraBackground";

export const metadata: Metadata = {
  title: "AITOCRM — Console",
  description: "Avito CRM с AI-ответами",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className="h-full">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Geist:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="h-full text-zinc-900">
        <AuroraBackground />
        <div style={{ position: "relative", zIndex: 1, height: "100%" }}>
          {children}
        </div>
      </body>
    </html>
  );
}
