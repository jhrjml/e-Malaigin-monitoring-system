// useSubmitGuard.js
// Prevents duplicate submissions from double-clicks/double-taps.
// A synchronous ref lock is required (not just React state) because a
// second click event can fire before React re-renders to hide/disable
// the button — this is exactly what caused duplicate offline saves.
import { useRef, useCallback } from "react";

export default function useSubmitGuard(cooldownMs = 1200) {
  const lockRef = useRef(false);

  const guard = useCallback(
    (fn) => {
      if (lockRef.current) return false; // ignore double click/tap
      lockRef.current = true;
      setTimeout(() => {
        lockRef.current = false;
      }, cooldownMs);
      fn();
      return true;
    },
    [cooldownMs],
  );

  return guard;
}
