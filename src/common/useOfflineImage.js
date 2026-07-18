import { useState, useEffect } from "react";

export default function useOfflineImage(url) {
  const cacheKey = `img-cache:${url}`;
  const [src, setSrc] = useState(() => localStorage.getItem(cacheKey) || url);

  useEffect(() => {
    let cancelled = false;
    fetch(url)
      .then((res) => res.blob())
      .then(
        (blob) =>
          new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          }),
      )
      .then((dataUrl) => {
        if (cancelled) return;
        setSrc(dataUrl);
        try {
          localStorage.setItem(cacheKey, dataUrl);
        } catch {
          // storage full / private mode — non-fatal
        }
      })
      .catch(() => {}); // offline + nothing cached yet — falls back to raw url
    return () => {
      cancelled = true;
    };
  }, [url]);

  return src;
}
