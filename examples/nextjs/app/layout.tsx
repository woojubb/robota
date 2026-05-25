import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Robota SDK — Next.js Chat Example',
  description: 'Streaming AI chat powered by @robota-sdk/agent-framework',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif' }}>{children}</body>
    </html>
  );
}
