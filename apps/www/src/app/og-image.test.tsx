import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/product-config.generated', () => ({
  productPublicConfig: { identity: { displayName: 'Selected Product' } },
}));

import { getOgCopy } from '@/lib/og-image';
import { GET as englishImage, dynamic as englishMode } from './og-en.png/route';
import { GET as koreanImage, dynamic as koreanMode } from './og-ko.png/route';

describe('localized exported social images', () => {
  it('uses the selected product identity in both locales', () => {
    expect(getOgCopy('en').brand).toBe('Selected Product');
    expect(getOgCopy('ko').brand).toBe('Selected Product');
    expect(getOgCopy('ko').heading).toContain('에이전트');
    expect(getOgCopy('en').footer).toContain('Provider charges');
    expect(getOgCopy('ko').license).toContain('상업용 라이선스');
  });

  it.each([
    ['en', englishImage, englishMode],
    ['ko', koreanImage, koreanMode],
  ] as const)('exports a %s 1200 × 630 PNG', async (_locale, render, mode) => {
    expect(mode).toBe('force-static');
    const response = await render();
    expect(response.headers.get('content-type')).toContain('image/png');
    const buffer = Buffer.from(await response.arrayBuffer());
    expect(buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(buffer.readUInt32BE(16)).toBe(1200);
    expect(buffer.readUInt32BE(20)).toBe(630);
  });
});
