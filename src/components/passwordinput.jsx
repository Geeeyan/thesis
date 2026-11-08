import { useEffect, useLayoutEffect, useRef, useState } from "react";

export default function PasswordInput({ className = "", style, disabled = false, ...inputProps }) {
  const [visible, setVisible] = useState(false);
  const inputRef = useRef(null);
  const selectionRef = useRef(null);

  useLayoutEffect(() => {
    if (!selectionRef.current || !inputRef.current) return;
    const { start, end, direction } = selectionRef.current;
    inputRef.current.focus();
    inputRef.current.setSelectionRange(start, end, direction);
    selectionRef.current = null;
  }, [visible]);

  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return undefined;
    const hidePassword = () => setVisible(false);
    form.addEventListener("submit", hidePassword, true);
    return () => form.removeEventListener("submit", hidePassword, true);
  }, []);

  function toggleVisibility() {
    if (disabled) return;
    const input = inputRef.current;
    if (input) {
      selectionRef.current = {
        start: input.selectionStart ?? input.value.length,
        end: input.selectionEnd ?? input.value.length,
        direction: input.selectionDirection ?? "none",
      };
    }
    setVisible((current) => !current);
  }

  return (
    <span className="password-input-control">
      <input
        {...inputProps}
        ref={inputRef}
        type={visible ? "text" : "password"}
        disabled={disabled}
        className={`password-input-field${className ? ` ${className}` : ""}`}
        style={{ ...style, paddingRight: "3rem" }}
      />
      <button
        type="button"
        className="password-input-toggle"
        onPointerDown={(event) => event.preventDefault()}
        onClick={toggleVisibility}
        disabled={disabled}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
      >
        <i className={`bi ${visible ? "bi-eye-slash" : "bi-eye"}`} aria-hidden="true" />
      </button>
    </span>
  );
}
