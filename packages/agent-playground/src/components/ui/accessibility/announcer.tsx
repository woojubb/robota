'use client';

const SCREEN_READER_DELAY_MS = 100;

import { useEffect, useRef } from 'react';

export function Announcer({
  message,
  politeness = 'polite',
}: {
  message: string;
  politeness?: 'polite' | 'assertive';
}) {
  const announcerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (message && announcerRef.current) {
      // Clear previous message before setting the next announcement.
      announcerRef.current.textContent = '';

      setTimeout(() => {
        if (announcerRef.current) {
          announcerRef.current.textContent = message;
        }
      }, SCREEN_READER_DELAY_MS);
    }
  }, [message]);

  return <div ref={announcerRef} aria-live={politeness} aria-atomic="true" className="sr-only" />;
}
