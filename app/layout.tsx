import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RAG Book Assistant",
  description: "Ask questions against your PDF library.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
