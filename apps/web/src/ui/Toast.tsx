// Copyright (c) 2026 Sub Rosa contributors
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { motionEnabled } from "../lib/reduced-motion";
import { useTime } from "../lib/time";

export type ToastTone = "info" | "working" | "success" | "error";

export interface ToastItem {
  id: string;
  tone: ToastTone;
  title: string;
  detail?: string;
}

interface ToastContextValue {
  push: (tone: ToastTone, title: string, detail?: string) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

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

function isFocusableElement(value: unknown): value is HTMLElement {
  return (
    typeof HTMLElement !== "undefined" &&
    value instanceof HTMLElement &&
    typeof value.focus === "function"
  );
}

function resolveDocument(): Document | null {
  return typeof document === "undefined" ? null : document;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const { scheduler } = useTime();
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const stackRef = useRef<HTMLDivElement | null>(null);
  const triggersRef = useRef(new Map<string, HTMLElement>());
  const itemsRef = useRef(items);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const restoreFocusFor = useCallback((id: string, focusInsideToast: boolean) => {
    const trigger = triggersRef.current.get(id);
    triggersRef.current.delete(id);
    if (!focusInsideToast || !isFocusableElement(trigger) || !trigger.isConnected) return;
    trigger.focus();
  }, []);

  const dismiss = useCallback((id: string, focusInsideToast = false) => {
    restoreFocusFor(id, focusInsideToast);
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, [restoreFocusFor]);

  const push = useCallback(
    (tone: ToastTone, title: string, detail?: string) => {
      const id = `toast-${++seq.current}`;
      const doc = resolveDocument();
      const active = doc?.activeElement;
      const stack = stackRef.current;
      if (isFocusableElement(active) && (!stack || !stack.contains(active))) {
        triggersRef.current.set(id, active);
      }
      setItems((prev) => [{ id, tone, title, detail }, ...prev].slice(0, 4));
      const ttl = TONE_DURATION[tone];
      if (ttl > 0) {
        scheduler.setTimeout(() => {
          const docAtDismiss = resolveDocument();
          const activeAtDismiss = docAtDismiss?.activeElement;
          const toastEl = docAtDismiss?.getElementById(id);
          const focusInsideToast = Boolean(
            toastEl && activeAtDismiss instanceof Node && toastEl.contains(activeAtDismiss),
          );
          if (itemsRef.current.some((item) => item.id === id)) dismiss(id, focusInsideToast);
        }, ttl);
      }
      return id;
    },
    [dismiss, scheduler],
  );

  const dismissFromKeyboard = useCallback((id: string) => {
    dismiss(id, true);
  }, [dismiss]);

  const handleToastKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>, id: string) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    dismissFromKeyboard(id);
  }, [dismissFromKeyboard]);

  const value = useMemo(() => ({ push, dismiss: (id: string) => dismiss(id) }), [push, dismiss]);
  const decorativeMotion = motionEnabled("nonessential", useReducedMotion());
  const toastTransition = decorativeMotion
    ? { type: "spring" as const, stiffness: 420, damping: 32 }
    : { duration: 0 };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite" ref={stackRef}>
        <AnimatePresence initial={false}>
          {items.map((item) => (
            <motion.div
              key={item.id}
              id={item.id}
              layout
              initial={decorativeMotion ? { opacity: 0, y: 24, scale: 0.9 } : false}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={
                decorativeMotion
                  ? { opacity: 0, y: 12, scale: 0.95, transition: { duration: 0.18 } }
                  : { opacity: 1, transition: { duration: 0 } }
              }
              transition={toastTransition}
              className={`toast toast-${item.tone}`}
              onKeyDown={(event) => handleToastKeyDown(event, item.id)}
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
                onClick={(event) => {
                  const currentTarget = event.currentTarget as unknown;
                  const active = resolveDocument()?.activeElement;
                  const focusInsideToast =
                    isFocusableElement(currentTarget) &&
                    (active === currentTarget ||
                      (active instanceof Node && currentTarget.contains(active)));
                  dismiss(item.id, focusInsideToast);
                }}
              >
                ×
              </button>
              {TONE_DURATION[item.tone] > 0 ? (
                <motion.i
                  key={`${item.id}-bar`}
                  className="toast-bar"
                  initial={{ scaleX: 1 }}
                  animate={{ scaleX: 0 }}
                  transition={
                    decorativeMotion
                      ? { duration: TONE_DURATION[item.tone] / 1000, ease: "linear" }
                      : { duration: 0 }
                  }
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
