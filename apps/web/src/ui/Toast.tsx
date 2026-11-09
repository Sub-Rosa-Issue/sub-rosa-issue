// Copyright (c) 2026 Sub Rosa contributors
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useTime } from "../lib/time";

export type ToastTone = "info" | "working" | "success" | "error";

export interface FocusableTarget {
  focus: () => void;
  isConnected?: boolean;
  disabled?: boolean;
  getAttribute?: (name: string) => string | null;
}

export interface ToastPushOptions {
  /**
   * Optional element to return keyboard focus to when the toast is dismissed
   * interactively. Defaults to `document.activeElement` at the time `push` runs.
   */
  returnFocusTo?: FocusableTarget | null;
}

export interface ToastDismissOptions {
  /**
   * When true, returns keyboard focus to the opener element captured when the
   * toast was pushed (if still connected and enabled).
   */
  restoreFocus?: boolean;
}

export interface ToastItem {
  id: string;
  tone: ToastTone;
  title: string;
  detail?: string;
}

interface ToastContextValue {
  push: (
    tone: ToastTone,
    title: string,
    detail?: string,
    options?: ToastPushOptions,
  ) => string;
  dismiss: (id: string, options?: ToastDismissOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function resolveActiveFocusable(): FocusableTarget | null {
  if (typeof document === "undefined") return null;
  const active = document.activeElement as unknown as
    | (FocusableTarget & Element)
    | null;
  if (!active || typeof active.focus !== "function") return null;
  if (
    active === (document.body as unknown) ||
    active === (document.documentElement as unknown)
  ) {
    return null;
  }
  return active;
}

export function canRestoreFocus(
  target: FocusableTarget | null | undefined,
): target is FocusableTarget {
  if (!target || typeof target.focus !== "function") return false;
  if (target.isConnected === false) return false;
  if (target.disabled === true) return false;
  if (target.getAttribute?.("aria-disabled") === "true") return false;
  return true;
}

const TONE_ICON: Record<ToastTone, ReactNode> = {
  info: "i",
  working: <span className="toast-spinner" aria-hidden="true" />,
  success: (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <motion.path
        d="M4 12.5l5 5L20 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
      />
    </svg>
  ),
  error: "!",
};

const TONE_DURATION: Record<ToastTone, number> = {
  info: 5000,
  working: 0,
  success: 5000,
  error: 8000,
};

/**
 * Toast notification provider. Captures the focused trigger element when a
 * toast is pushed and restores keyboard focus to that element when the toast is
 * dismissed interactively via its close button or the `Escape` key. Background
 * auto-dismissal timers never steal focus from the user's active control.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const { scheduler } = useTime();
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const openerMap = useRef<Map<string, FocusableTarget | null>>(new Map());

  const dismiss = useCallback((id: string, options?: ToastDismissOptions) => {
    const opener = openerMap.current.get(id);
    openerMap.current.delete(id);
    setItems((prev) => prev.filter((item) => item.id !== id));
    if (options?.restoreFocus && canRestoreFocus(opener)) {
      opener.focus();
    }
  }, []);

  const push = useCallback(
    (
      tone: ToastTone,
      title: string,
      detail?: string,
      options?: ToastPushOptions,
    ) => {
      const id = `toast-${++seq.current}`;
      const opener =
        options?.returnFocusTo !== undefined
          ? options.returnFocusTo
          : resolveActiveFocusable();
      openerMap.current.set(id, opener ?? null);
      setItems((prev) => [{ id, tone, title, detail }, ...prev].slice(0, 4));
      const ttl = TONE_DURATION[tone];
      if (ttl > 0) {
        scheduler.setTimeout(() => dismiss(id, { restoreFocus: false }), ttl);
      }
      return id;
    },
    [dismiss, scheduler],
  );

  const handleToastKeyDown = useCallback(
    (id: string, event: KeyboardEvent<HTMLElement>) => {
      if (event.key === "Escape") {
        event.preventDefault?.();
        event.stopPropagation?.();
        dismiss(id, { restoreFocus: true });
      }
    },
    [dismiss],
  );

  const value = useMemo(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite">
        <AnimatePresence initial={false}>
          {items.map((item) => (
            <motion.div
              key={item.id}
              layout
              initial={{ opacity: 0, y: 24, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.95, transition: { duration: 0.18 } }}
              transition={{ type: "spring", stiffness: 420, damping: 32 }}
              className={`toast toast-${item.tone}`}
              onKeyDown={(e) => handleToastKeyDown(item.id, e)}
            >
              <span className="toast-icon" aria-hidden="true">
                {TONE_ICON[item.tone]}
              </span>
              <div className="toast-body">
                <strong>{item.title}</strong>
                {item.detail ? <p>{item.detail}</p> : null}
              </div>
              <button
                type="button"
                className="toast-close"
                aria-label={`Dismiss: ${item.title}`}
                onClick={() => dismiss(item.id, { restoreFocus: true })}
              >
                ×
              </button>
              {TONE_DURATION[item.tone] > 0 ? (
                <motion.i
                  key={`${item.id}-bar`}
                  className="toast-bar"
                  initial={{ scaleX: 1 }}
                  animate={{ scaleX: 0 }}
                  transition={{ duration: TONE_DURATION[item.tone] / 1000, ease: "linear" }}
                />
              ) : (
                <i className="toast-bar toast-bar-indeterminate" />
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
