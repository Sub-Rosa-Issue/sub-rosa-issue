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

export interface ToastItem {
  id: string;
  tone: ToastTone;
  title: string;
  detail?: string;
}

export interface FocusableElement {
  focus(): void;
  isConnected?: boolean;
  contains?(node: unknown): boolean;
}

export interface FocusEnvironment {
  readonly activeElement: FocusableElement | null;
  readonly body?: FocusableElement | null;
}

export interface DismissToastOptions {
  restoreFocus?: boolean;
}

interface ToastContextValue {
  push: (tone: ToastTone, title: string, detail?: string) => string;
  dismiss: (id: string, options?: DismissToastOptions) => void;
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

function defaultFocusEnvironment(): FocusEnvironment | undefined {
  if (typeof document === "undefined") return undefined;
  return {
    get activeElement() {
      const el = document.activeElement as unknown as FocusableElement | null;
      return el && typeof el.focus === "function" ? el : null;
    },
    get body() {
      const el = document.body as unknown as FocusableElement | null;
      return el && typeof el.focus === "function" ? el : null;
    },
  };
}

export function ToastProvider({
  children,
  focusEnv,
}: {
  children: ReactNode;
  focusEnv?: FocusEnvironment;
}) {
  const { scheduler } = useTime();
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const openersRef = useRef<Map<string, FocusableElement>>(new Map());
  const toastNodesRef = useRef<Map<string, FocusableElement>>(new Map());
  const lastOpenerRef = useRef<FocusableElement | null>(null);

  const getEnv = useCallback(
    () => focusEnv ?? defaultFocusEnvironment(),
    [focusEnv],
  );

  const isInsideAnyToast = useCallback((target: FocusableElement | null): boolean => {
    if (!target) return false;
    for (const node of toastNodesRef.current.values()) {
      if (node === target || (typeof node.contains === "function" && node.contains(target))) {
        return true;
      }
    }
    return false;
  }, []);

  const dismiss = useCallback(
    (id: string, options?: DismissToastOptions) => {
      const env = getEnv();
      const active = env?.activeElement ?? null;
      const toastNode = toastNodesRef.current.get(id) ?? null;
      const focusInsideToast =
        toastNode != null &&
        active != null &&
        (toastNode === active ||
          (typeof toastNode.contains === "function" && toastNode.contains(active)));
      const shouldRestoreFocus = Boolean(options?.restoreFocus) || focusInsideToast;

      const opener = openersRef.current.get(id) ?? lastOpenerRef.current;
      openersRef.current.delete(id);
      toastNodesRef.current.delete(id);

      setItems((prev) => prev.filter((item) => item.id !== id));

      if (shouldRestoreFocus && opener && opener.isConnected !== false) {
        opener.focus();
      }
    },
    [getEnv],
  );

  const push = useCallback(
    (tone: ToastTone, title: string, detail?: string) => {
      const id = `toast-${++seq.current}`;
      const env = getEnv();
      const active = env?.activeElement ?? null;
      const isBody = active != null && env?.body != null && active === env.body;
      const candidate =
        active && !isBody && !isInsideAnyToast(active) ? active : lastOpenerRef.current;

      if (candidate) {
        openersRef.current.set(id, candidate);
        lastOpenerRef.current = candidate;
      }

      setItems((prev) => [{ id, tone, title, detail }, ...prev].slice(0, 4));
      const ttl = TONE_DURATION[tone];
      if (ttl > 0) scheduler.setTimeout(() => dismiss(id), ttl);
      return id;
    },
    [dismiss, getEnv, isInsideAnyToast, scheduler],
  );

  const handleToastKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>, id: string) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
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
              ref={(node: HTMLElement | null) => {
                if (node) {
                  toastNodesRef.current.set(item.id, node);
                } else {
                  toastNodesRef.current.delete(item.id);
                }
              }}
              layout
              initial={{ opacity: 0, y: 24, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.95, transition: { duration: 0.18 } }}
              transition={{ type: "spring", stiffness: 420, damping: 32 }}
              className={`toast toast-${item.tone}`}
              tabIndex={-1}
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
