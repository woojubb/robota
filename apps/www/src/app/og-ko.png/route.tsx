import { renderOgImage } from '@/lib/og-image';

export const dynamic = 'force-static';
export const runtime = 'nodejs';

export function GET() {
  return renderOgImage('ko');
}
