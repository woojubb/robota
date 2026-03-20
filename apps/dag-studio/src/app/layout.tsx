import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Space_Grotesk, Fira_Code } from "next/font/google";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-sans",
});

const firaCode = Fira_Code({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Robota Playground",
  description: "Deployable Playground host for Robota SDK",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className={`h-full ${spaceGrotesk.variable} ${firaCode.variable}`}>
        <main className="h-full">{children}</main>
      </body>
    </html>
  );
}
