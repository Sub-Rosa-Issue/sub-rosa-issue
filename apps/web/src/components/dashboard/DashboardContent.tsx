// Copyright (c) 2026 Sub Rosa contributors
import { motion, type Transition } from "framer-motion";
import type { DashboardState } from "../../hooks/useDashboardData";
import { BidderProgressCard } from "./BidderProgressCard";
import { DashboardEmptyState } from "./DashboardEmptyState";
import { DashboardErrorState } from "./DashboardErrorState";
import { KeeperStatusCard } from "./KeeperStatusCard";
import { RoundStatusCard } from "./RoundStatusCard";
import { SettlementCard } from "./SettlementCard";

function StaleBanner({ fetchedAt }: { fetchedAt: string }) {
  const formatted = new Intl.DateTimeFormat(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(Date.parse(fetchedAt));
  return (
    <div className="dashboard-stale-banner">
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <span>
        Data may be stale. Last fetched:{" "}
        {formatted}
      </span>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="dashboard-loading-state">
      <div className="dashboard-spinner" />
      <p>Loading dashboard...</p>
    </div>
  );
}

// Round data is only reachable in the `ready` branch: narrowing on `status`
// means the loading, empty and error branches have no payload to pass along.
export function DashboardContent({
  state,
  onRetry,
  transition,
}: {
  state: DashboardState;
  onRetry: () => void;
  transition?: Transition;
}) {
  switch (state.status) {
    case "loading":
      return <LoadingState />;
    case "error":
      return <DashboardErrorState code={state.code} onRetry={onRetry} />;
    case "empty":
      return <DashboardEmptyState />;
    case "ready": {
      const { data, stale } = state;
      return (
        <>
          {stale && <StaleBanner fetchedAt={data.meta.fetchedAt} />}
          <motion.div
            className="dashboard-grid"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...transition, delay: 0.1 }}
          >
            <div className="dashboard-column">
              <RoundStatusCard data={data} />
              <SettlementCard data={data} />
            </div>
            <div className="dashboard-column">
              <KeeperStatusCard data={data} />
              <BidderProgressCard data={data} />
            </div>
          </motion.div>
        </>
      );
    }
  }
}
