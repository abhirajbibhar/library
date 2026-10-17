import { useEffect, useRef } from 'react';
import { getLibrary } from '../lib/db';
import { useFetch } from './useFetch';

// Don't hammer the worker (each list call = several R2 operations) when focus/visibility events fire.
const AUTO_REFRESH_MIN_INTERVAL_MS = 15_000;

/** The document list, refreshed quietly when the tab regains focus. */
export function useLibrary() {
  const result = useFetch(() => getLibrary());
  const lastRef = useRef(Date.now());
  const { reload } = result;

  useEffect(() => {
    const refreshIfStale = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastRef.current < AUTO_REFRESH_MIN_INTERVAL_MS) return;
      lastRef.current = Date.now();
      void reload(true);
    };
    document.addEventListener('visibilitychange', refreshIfStale);
    window.addEventListener('focus', refreshIfStale);
    return () => {
      document.removeEventListener('visibilitychange', refreshIfStale);
      window.removeEventListener('focus', refreshIfStale);
    };
  }, [reload]);

  return { documents: result.data ?? [], loaded: result.data !== null, ...result };
}
