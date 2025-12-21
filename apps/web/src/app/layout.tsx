import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Robota Playground",
  description: "Deployable Playground host for Robota SDK",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full">
        <main className="h-full">{children}</main>
      </body>
    </html>
  );
}
