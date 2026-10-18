import { useEffect, useRef } from 'react';
import { logReading } from '../lib/db';
import { localDay } from '../lib/format';

const IDLE_AFTER_MS = 60_000; // no touch / key / scroll for a minute = not reading
const FLUSH_EVERY_S = 30;

/**
 * Counts the seconds you really spend with a document open (tab visible and focused, recent activity)
 * and sends them to the Worker every 30 seconds and when you leave.
 */
export function useReadingTimer(id: string | undefined, enabled: boolean): void {
  const pending = useRef(0);
  const day = useRef(localDay());

  useEffect(() => {
    if (!id || !enabled) return;
    let lastActivity = Date.now();
    pending.current = 0;
    day.current = localDay();

    const flush = (keepalive = false) => {
      const seconds = Math.min(300, Math.floor(pending.current));
      if (seconds < 1) return;
      pending.current -= seconds;
      logReading(id, seconds, day.current, { keepalive }).catch(() => {
        pending.current += seconds; // try again with the next flush
      });
    };

    const touch = () => {
      lastActivity = Date.now();
    };
    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;
    events.forEach((e) => window.addEventListener(e, touch, { passive: true, capture: true }));

    const tick = setInterval(() => {
      const active = document.visibilityState === 'visible' && document.hasFocus() && Date.now() - lastActivity < IDLE_AFTER_MS;
      if (!active) return;
      const today = localDay();
      if (today !== day.current) {
        flush(); // midnight: bank the old day first
        day.current = today;
      }
      pending.current += 1;
      if (pending.current >= FLUSH_EVERY_S) flush();
    }, 1000);

    const onHide = () => {
      if (document.visibilityState === 'hidden') flush(true);
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide as () => void);

    return () => {
      clearInterval(tick);
      events.forEach((e) => window.removeEventListener(e, touch, { capture: true }));
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide as () => void);
      flush(true);
    };
  }, [id, enabled]);
}
