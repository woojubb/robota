'use client';

import Script from 'next/script';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import en from '../messages/analytics/en.json';
import ko from '../messages/analytics/ko.json';

type Choice = 'accepted' | 'rejected';
type AnalyticsWindow = Window & {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
};
const storageKey = 'site-analytics-consent-v1';

/** Basic GA4 page views only, with an explicit, revocable visitor choice. */
export function SiteAnalytics({ measurementId, locale }: { measurementId?: string; locale: 'en' | 'ko' }) {
  const pathname = usePathname();
  const [choice, setChoice] = useState<Choice | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [ready, setReady] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const lastView = useRef<string | null>(null);
  const validId = measurementId && /^G-[A-Z0-9]+$/u.test(measurementId) ? measurementId : undefined;

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved === 'accepted' || saved === 'rejected') setChoice(saved);
    } catch { /* Keep the choice in memory when storage is unavailable. */ }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!validId) return;
    const analytics = window as AnalyticsWindow;
    const disabled = analytics as unknown as Record<string, unknown>;
    disabled[`ga-disable-${validId}`] = choice !== 'accepted';
    if (choice !== 'accepted') {
      lastView.current = null;
      analytics.gtag?.('consent', 'update', { analytics_storage: 'denied' });
      return;
    }
    analytics.dataLayer ??= [];
    // gtag expects Arguments objects, rather than arrays of arguments.
    analytics.gtag ??= function () { analytics.dataLayer?.push(arguments); };
    analytics.gtag('consent', 'update', {
      analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied',
    });
    analytics.gtag('js', new Date());
    analytics.gtag('config', validId, {
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      page_location: `${location.origin}${location.pathname}`,
    });
  }, [choice, validId]);

  useEffect(() => {
    if (!validId || choice !== 'accepted' || !ready || lastView.current === pathname) return;
    const analytics = window as AnalyticsWindow;
    // Query strings and fragments can contain personal data. Never include them.
    const pageLocation = `${location.origin}${pathname}`;
    analytics.gtag?.('set', { page_location: pageLocation, page_referrer: document.referrer.split(/[?#]/u)[0] });
    analytics.gtag?.('event', 'page_view', {
      send_to: validId, page_location: pageLocation, page_title: document.title,
    });
    lastView.current = pathname;
  }, [choice, pathname, ready, validId]);

  if (!validId || !loaded) return null;
  const copy = locale === 'ko' ? ko : en;
  function choose(value: Choice) {
    try { localStorage.setItem(storageKey, value); } catch { /* Session choice still applies. */ }
    setChoice(value);
    setSettingsOpen(false);
  }

  return <>
    {choice === 'accepted' && <Script id="site-google-analytics" src={`https://www.googletagmanager.com/gtag/js?id=${validId}`} strategy="afterInteractive" onReady={() => setReady(true)} />}
    <div className="analytics-settings">
      <button type="button" onClick={() => setSettingsOpen(true)}>{copy.settings}</button>
    </div>
    {(choice === null || settingsOpen) && <section className="analytics-choice" aria-label={copy.label}>
      <p>{copy.description}</p>
      <div>
        <button type="button" onClick={() => choose('rejected')}>{copy.reject}</button>
        <button type="button" onClick={() => choose('accepted')}>{copy.accept}</button>
      </div>
    </section>}
  </>;
}
