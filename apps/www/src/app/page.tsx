'use client';
import { useEffect } from 'react';

export default function RootPage() {
  useEffect(() => {
    const lang = navigator.language.startsWith('ko') ? 'ko' : 'en';
    window.location.replace(`/${lang}`);
  }, []);
  return null;
}
