import { useState, useEffect, useRef, useCallback } from "react";

export default function useCachedFetch(key, fetchFn, deps = []) {
  const cacheKey = `cache:${key}`;
  const [data, setData] = useState(() => {
    try {
      const raw = localStorage.getItem(cacheKey);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(data === null);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    // Only show a spinner if we truly have nothing cached yet.
    setLoading((prev) => (data === null ? true : prev));
    try {
      const result = await fetchFn();
      if (!mountedRef.current) return result;
      setData(result);
      setError(null);
      try {
        localStorage.setItem(cacheKey, JSON.stringify(result));
      } catch {
        // storage full / private mode — non-fatal
      }
      return result;
    } catch (e) {
      if (mountedRef.current) setError(e);
      throw e;
    } finally {
      if (mountedRef.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    refresh().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, setData, loading, error, refresh };
}
