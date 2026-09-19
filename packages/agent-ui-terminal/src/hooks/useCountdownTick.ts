import { useEffect, useState } from 'react';

import { MS_PER_SECOND } from '../attention/time-units.js';

/** SCREEN-1992: one second, the resolution a `in 59s` countdown is read at. */
const COUNTDOWN_TICK_MS = MS_PER_SECOND;

/**
 * The clock a sleeping schedule's countdown is rendered against. Re-renders once a second only while
 * `active` (an entry carries `nextFireAt`) and not in screen-reader mode — a reader would otherwise
 * hear the row change every second.
 */
export function useCountdownTick(active: boolean, screenReader: boolean): Date {
  const ticking = active && !screenReader;
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!ticking) return undefined;
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), COUNTDOWN_TICK_MS);
    return () => clearInterval(timer);
  }, [ticking]);
  return now;
}
