// useNetworkStatus.js
// Tracks two things:
//  - isOnline: true/false from the browser's online/offline events
//  - isSlow:   true when the Network Information API reports a slow link
//              (2g/slow-2g or low downlink), or — on browsers that don't
//              support that API (Safari/Firefox) — when a small same-origin
//              request takes too long to come back.
import { useEffect, useRef, useState } from "react";

const SLOW_EFFECTIVE_TYPES = ["slow-2g", "2g"];
const SLOW_DOWNLINK_MBPS = 1; // below this is considered slow
const SLOW_RTT_MS = 2500; // fallback probe: anything slower than this is "slow"
const PROBE_TIMEOUT_MS = 4000;
const PROBE_URL = "/vite.svg"; // any small, always-present static asset
const RECHECK_INTERVAL_MS = 15000;

export default function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isSlow, setIsSlow] = useState(false);
  const intervalRef = useRef(null);

  // Online / offline events
  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => {
      setIsOnline(false);
      setIsSlow(false);
    };
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  // Slow-connection detection
  useEffect(() => {
    const connection =
      navigator.connection ||
      navigator.webkitConnection ||
      navigator.mozConnection;

    const readFromConnectionApi = () => {
      if (!connection) return null; // not supported in this browser
      if (SLOW_EFFECTIVE_TYPES.includes(connection.effectiveType)) return true;
      if (
        typeof connection.downlink === "number" &&
        connection.downlink < SLOW_DOWNLINK_MBPS
      )
        return true;
      return false;
    };

    const probeLatency = async () => {
      if (!navigator.onLine) return;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
      const started = performance.now();
      try {
        await fetch(`${PROBE_URL}?t=${Date.now()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        setIsSlow(performance.now() - started > SLOW_RTT_MS);
      } catch {
        setIsSlow(true); // timed out or failed — treat as slow/unstable
      } finally {
        clearTimeout(timeoutId);
      }
    };

    const checkSlow = () => {
      const fromApi = readFromConnectionApi();
      if (fromApi !== null) {
        setIsSlow(fromApi);
      } else {
        probeLatency();
      }
    };

    checkSlow();
    intervalRef.current = setInterval(checkSlow, RECHECK_INTERVAL_MS);
    if (connection?.addEventListener) {
      connection.addEventListener("change", checkSlow);
    }

    return () => {
      clearInterval(intervalRef.current);
      if (connection?.removeEventListener) {
        connection.removeEventListener("change", checkSlow);
      }
    };
  }, []);

  return { isOnline, isSlow };
}
