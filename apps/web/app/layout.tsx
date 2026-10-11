import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kronika 9:16",
  description: "Archiwa w formacie, który ludzie naprawdę oglądają.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pl">
      <body>{children}</body>
    </html>
  );
}
