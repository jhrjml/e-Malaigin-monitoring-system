// ConfirmModal.jsx
// src/common/ConfirmModal.jsx
//
// Props:
//   open          – boolean, controls visibility
//   title         – string, header text  (optional, defaults to nothing)
//   titleIcon     – FontAwesome class string e.g. "fa-trash" (optional)
//   titleColor    – CSS color for the icon  (optional, defaults to #a65f81)
//   message       – string or JSX, body text
//   confirmText   – string (default "OK")
//   cancelText    – string (default "Cancel")
//   onConfirm     – callback
//   onCancel      – callback (omit to hide Cancel button)
//   confirmColor  – "danger" | "success" | "primary" (default "primary")
//   disabled      – boolean, disables confirm button while processing

import "./ConfirmModal.css";

function ConfirmModal({
  open,
  title,
  titleIcon,
  titleColor,
  message,
  onConfirm,
  onCancel,
  confirmText = "OK",
  cancelText = "Cancel",
  confirmColor = "primary",
  disabled = false,
}) {
  if (!open) return null;

  return (
    <div
      className="cm-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget && onCancel && !disabled) onCancel();
      }}
    >
      <div className="cm-box">
        {/* Header - Now perfectly centered */}
        {title && (
          <div className="cm-header">
            {titleIcon && (
              <div
                className="cm-title-icon-wrap"
                style={
                  titleColor ? { "--cm-icon-color": titleColor } : undefined
                }
              >
                <i className={`fas ${titleIcon} cm-title-icon`}></i>
              </div>
            )}
            <h3 className="cm-title">{title}</h3>
          </div>
        )}

        {/* Body Text */}
        <p className="cm-message">{message}</p>

        {/* Buttons - Now stretching evenly across the bottom */}
        <div className="cm-buttons">
          {onCancel && (
            <button
              className="cm-btn cm-cancel"
              onClick={onCancel}
              disabled={disabled}
            >
              {cancelText}
            </button>
          )}
          <button
            className={`cm-btn cm-confirm cm-confirm--${confirmColor}`}
            onClick={onConfirm}
            disabled={disabled}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmModal;
