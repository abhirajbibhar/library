import { useCallback, useEffect, useRef, useState } from 'react';

/** Loads once on mount; `reload()` refetches. Only the newest request may update state. */
export function useFetch<T>(fn: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const idRef = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const reload = useCallback(async (silent = false) => {
    const id = ++idRef.current;
    if (!silent) setLoading(true);
    try {
      const result = await fnRef.current();
      if (id !== idRef.current) return;
      setData(result);
      setError(null);
    } catch (err) {
      if (id !== idRef.current) return;
      console.error(err);
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      if (id === idRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, reload };
}
