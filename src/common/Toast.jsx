// Toast.jsx
// src/common/Toast.jsx
//
// Renders the same toast used in Archive.jsx, now reusable anywhere.
// Pair with the useToast() hook below for the simplest usage:
//
//   const { toast, showToast } = useToast();
//   ...
//   <Toast toast={toast} />
//   ...
//   showToast("Saved!");          // success (green)
//   showToast("Failed.", true);   // error (red)

import "./Toast.css";

export function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div className={`app-toast ${toast.error ? "error" : "success"}`}>
      <i
        className={`fas ${toast.error ? "fa-exclamation-circle" : "fa-check-circle"}`}
      ></i>
      <span>{toast.message}</span>
    </div>
  );
}

export default Toast;
