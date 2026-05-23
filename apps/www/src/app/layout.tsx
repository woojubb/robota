import type { Metadata } from 'next';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Robota — Open-Source AI Agent SDK',
    template: '%s | Robota',
  },
  description:
    'Open-source AI agent SDK and CLI. Multi-provider BYOK — Anthropic, OpenAI, DeepSeek, Gemini, or local models. MIT licensed.',
  metadataBase: new URL('https://www.robota.io'),
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://www.robota.io',
    siteName: 'Robota',
    title: 'Robota — Open-Source AI Agent SDK',
    description:
      'Open-source AI agent SDK and CLI. Multi-provider BYOK — Anthropic, OpenAI, DeepSeek, Gemini, or local models. MIT licensed.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Robota — Open-Source AI Agent SDK',
    description:
      'Open-source AI agent SDK and CLI. Multi-provider BYOK — Anthropic, OpenAI, DeepSeek, Gemini, or local models. MIT licensed.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Header />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
}
