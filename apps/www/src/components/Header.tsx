'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { productPublicConfig } from '@/lib/product-config.generated';
import { getMarketingLocaleUrl, marketingPath, type MarketingLocale } from '@/lib/marketing';

export function Header() {
  const t = useTranslations('common');
  const requestedLocale = useLocale();
  const locale: MarketingLocale = requestedLocale === 'ko' ? 'ko' : 'en';
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const mobileNav = useRef<HTMLElement>(null);
  const docsUrl = productPublicConfig.identity.docsUrl?.replace(/\/+$/u, '');
  const repoUrl = productPublicConfig.identity.repositoryUrl?.replace(/\/+$/u, '');
  const otherLocale: MarketingLocale = locale === 'en' ? 'ko' : 'en';
  const otherLocaleHref = getMarketingLocaleUrl(pathname, otherLocale);

  useEffect(() => {
    if (!menuOpen) return;
    mobileNav.current?.querySelector<HTMLAnchorElement>('a')?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        menuButton.current?.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [menuOpen]);

  const links = [
    ...(docsUrl ? [
      { href: `${docsUrl}/en/guide/sdk/`, label: t('nav.sdk') },
      { href: `${docsUrl}/${locale}/getting-started/`, label: t('nav.cli') },
    ] : []),
    { href: marketingPath(locale, 'compare'), label: t('nav.whyProduct') },
    { href: marketingPath(locale, 'showcase'), label: t('nav.showcase') },
    { href: marketingPath(locale, 'roadmap'), label: t('nav.roadmap') },
  ];

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <a href={marketingPath(locale)} className="site-brand" aria-label={`${productPublicConfig.identity.displayName} — ${locale === 'ko' ? '홈' : 'home'}`}>
          <span className="site-brand-mark" aria-hidden="true"><span /><span /><span /></span>
          <span>{productPublicConfig.identity.displayName}</span>
          <span className="site-beta">beta</span>
        </a>

        <nav className="site-desktop-nav" aria-label={locale === 'ko' ? '기본 메뉴' : 'Main navigation'}>
          {links.map((link) => <a href={link.href} key={link.href}>{link.label}</a>)}
        </nav>

        <div className="site-header-actions">
          <a className="site-language" href={otherLocaleHref} hrefLang={otherLocale} lang={otherLocale} aria-label={locale === 'ko' ? 'Switch to English' : '한국어로 전환'}>{t(`lang.${otherLocale}`)}</a>
          {repoUrl && <a className="site-repo-link" href={repoUrl}>{t('nav.github')} <span aria-hidden="true">↗</span></a>}
          <button
            ref={menuButton}
            className="site-menu-toggle"
            type="button"
            aria-controls="site-mobile-navigation"
            aria-expanded={menuOpen}
            aria-label={locale === 'ko' ? (menuOpen ? '메뉴 닫기' : '메뉴 열기') : (menuOpen ? 'Close menu' : 'Open menu')}
            onClick={() => setMenuOpen((value) => !value)}
          ><span aria-hidden="true">{menuOpen ? '×' : '☰'}</span></button>
        </div>
      </div>
      <nav
        ref={mobileNav}
        className="site-mobile-nav"
        id="site-mobile-navigation"
        aria-label={locale === 'ko' ? '모바일 메뉴' : 'Mobile navigation'}
        hidden={!menuOpen}
      >
        {links.map((link) => <a href={link.href} key={link.href} onClick={() => setMenuOpen(false)}>{link.label}<span aria-hidden="true">↗</span></a>)}
        {repoUrl && <a href={repoUrl} onClick={() => setMenuOpen(false)}>{t('nav.github')}<span aria-hidden="true">↗</span></a>}
      </nav>
    </header>
  );
}
