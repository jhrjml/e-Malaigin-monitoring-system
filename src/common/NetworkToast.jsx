// NetworkToast.jsx
// Mount this once near the top of your app (e.g. in App.jsx):
//   import NetworkToast from "./NetworkToast";
//   ...
//   <NetworkToast />
// It pops up whenever the browser goes offline or the connection is
// detected as slow, then automatically shows a "restored" message when the
// connection comes back. Each state auto-hides after 5 seconds.
import React, { useEffect, useRef, useState } from "react";
import useNetworkStatus from "./useNetworkStatus";
import "./NetworkToast.css";

const AUTO_HIDE_MS = 5000;

const VARIANTS = {
  offline: {
    message: "Currently Offline",
    icon: "fa-wifi",
    className: "error",
  },
  slow: {
    message: "Slow Internet Connection",
    icon: "fa-exclamation-triangle",
    className: "warning",
  },
  restored: {
    message: "Internet Connection Restored",
    icon: "fa-check-circle",
    className: "success",
  },
};

const NetworkToast = () => {
  const { isOnline, isSlow } = useNetworkStatus();
  const [visible, setVisible] = useState(false);
  const [variant, setVariant] = useState("offline");
  const timerRef = useRef(null);
  const wasBadRef = useRef(false); // tracks whether we were previously offline/slow

  const showToast = (key) => {
    setVariant(key);
    setVisible(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(false), AUTO_HIDE_MS);
  };

  useEffect(() => {
    const isBad = !isOnline || isSlow;

    if (isBad) {
      // Offline takes priority over slow if both are somehow true
      showToast(!isOnline ? "offline" : "slow");
      wasBadRef.current = true;
    } else if (wasBadRef.current) {
      // Connection just recovered from a bad state
      showToast("restored");
      wasBadRef.current = false;
    }
  }, [isOnline, isSlow]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const handleClose = () => {
    clearTimeout(timerRef.current);
    setVisible(false);
  };

  if (!visible) return null;

  const { message, icon, className } = VARIANTS[variant];

  return (
    <div className={`network-toast ${className}`} role="alert">
      <i className={`fas ${icon} network-toast-icon`}></i>
      <span className="network-toast-message">{message}</span>
      <button
        className="network-toast-close"
        onClick={handleClose}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
};

export default NetworkToast;
