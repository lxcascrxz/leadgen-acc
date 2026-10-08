import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ACC Telecom — Gerador de Leads",
  description: "Gerador de leads de empresas por bairro e cidade",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
