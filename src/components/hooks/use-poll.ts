'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

/** Fetch a JSON endpoint on mount and (optionally) on an interval. */
export function usePoll<T>(path: string | null, intervalMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const mounted = useRef(true);

  const refresh = useCallback(async (): Promise<void> => {
    if (!path) return;
    try {
      const result = await api.get<T>(path);
      if (!mounted.current) return;
      setData(result);
      setError(null);
    } catch (caught) {
      if (!mounted.current) return;
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    if (intervalMs <= 0) {
      return () => {
        mounted.current = false;
      };
    }
    const timer = setInterval(() => void refresh(), intervalMs);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [refresh, intervalMs]);

  return { data, error, loading, refresh, setData };
}
