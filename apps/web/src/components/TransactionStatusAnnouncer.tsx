// Copyright (c) 2026 Sub Rosa contributors

/** Polite live region. Pass only text from `transactionStatusAnnouncement`. */
export function TransactionStatusAnnouncer({ message }: { message: string }) {
  return (
    <div
      className="transaction-status-live"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {message}
    </div>
  );
}
