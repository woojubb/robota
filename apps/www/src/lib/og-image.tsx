import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import React from 'react';
import enOg from '@/messages/og/en.json';
import koOg from '@/messages/og/ko.json';
import { productPublicConfig } from './product-config.generated';

type OgLocale = 'en' | 'ko';

/** The social image's text per locale; the brand comes from the selected product. */
const ogCopy: Record<OgLocale, typeof enOg> = { en: enOg, ko: koOg };

export function getOgCopy(locale: OgLocale) {
  const brand = productPublicConfig.identity.displayName || 'Agent SDK + CLI';
  return { brand, ...ogCopy[locale] };
}

const colors = {
  background: '#0b1711',
  panel: '#11261c',
  border: '#31543e',
  accent: '#83eab9',
  white: '#f0f8f2',
  muted: '#b7c9be',
};

export async function renderOgImage(locale: OgLocale): Promise<ImageResponse> {
  const copy = getOgCopy(locale);
  const font = await readFile(join(process.cwd(), 'src/assets/og-fonts/korean-bold.otf'));

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '54px 66px 49px',
        backgroundColor: colors.background,
        color: colors.white,
        fontFamily: 'OgKorean',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', width: 48, height: 48, padding: 12, border: `2px solid ${colors.accent}`, borderRadius: 10, marginRight: 17 }}>
            <div style={{ width: 5, height: 17, backgroundColor: colors.accent, borderRadius: 2, marginRight: 5 }} />
            <div style={{ width: 5, height: 23, backgroundColor: colors.accent, borderRadius: 2, marginRight: 5 }} />
            <div style={{ width: 5, height: 14, backgroundColor: colors.accent, borderRadius: 2 }} />
          </div>
          <div style={{ fontSize: copy.brand.length > 22 ? 27 : 37, fontWeight: 700, letterSpacing: -1 }}>
            {copy.brand}
          </div>
        </div>
        <div style={{ display: 'flex', padding: '6px 20px', border: `1px solid ${colors.border}`, borderRadius: 18, backgroundColor: colors.panel, color: colors.accent, fontSize: 17 }}>
          {copy.badge}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', marginTop: 48 }}>
        <div style={{ fontSize: locale === 'ko' ? 56 : 62, fontWeight: 700, letterSpacing: -2, lineHeight: 1.18 }}>
          {copy.heading}
        </div>
        <div style={{ color: colors.muted, fontSize: 30, marginTop: 21 }}>
          {copy.subheading}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ width: '100%', height: 2, backgroundColor: colors.border, marginBottom: 34 }} />
        <div style={{ display: 'flex' }}>
          {(['sdk', 'cli'] as const).map((path, index) => (
            <div
              key={path}
              style={{
                display: 'flex',
                flexDirection: 'column',
                width: index === 0 ? 501 : 539,
                height: 131,
                padding: '18px 24px',
                marginRight: index === 0 ? 24 : 0,
                border: `1px solid ${colors.border}`,
                borderRadius: 16,
                backgroundColor: colors.panel,
              }}
            >
              <div style={{ color: colors.accent, fontSize: 17 }}>{`0${index + 1}  ${path.toUpperCase()}`}</div>
              <div style={{ fontSize: 26, marginTop: 13 }}>{copy[path]}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#91bba2', fontSize: 17 }}>
        <div>{copy.footer}</div>
        <div>{copy.license}</div>
      </div>
    </div>,
    {
      width: 1200,
      height: 630,
      fonts: [{ name: 'OgKorean', data: font, weight: 700, style: 'normal' }],
    },
  );
}
