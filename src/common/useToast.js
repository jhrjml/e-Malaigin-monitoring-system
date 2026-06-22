// useToast.js
// src/common/useToast.js
//
// Tiny hook that gives any component the exact toast behavior from Archive.jsx.
//
// Usage:
//   const { toast, showToast } = useToast();
//   <Toast toast={toast} />
//   showToast("Teacher added successfully!");
//   showToast("Something went wrong.", true);  // error styling

import { useState, useRef, useCallback, useEffect } from "react";

export function useToast(duration = 3500) {
  const [toast, setToast] = useState(null);
  const timerRef = useRef(null);

  const showToast = useCallback(
    (message, error = false) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setToast({ message, error });
      timerRef.current = setTimeout(() => setToast(null), duration);
    },
    [duration],
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { toast, showToast };
}

export default useToast;
