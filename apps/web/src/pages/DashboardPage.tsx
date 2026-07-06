import { motion, useReducedMotion } from "framer-motion";
import { useDashboardData } from "../hooks/useDashboardData";
import { LOGO_SRC } from "../lib/chain";
import {
  RoundStatusCard,
  KeeperStatusCard,
  BidderProgressCard,
  SettlementCard,
  DashboardEmptyState,
  DashboardErrorState,
} from "../components/dashboard";

function StaleBanner({ fetchedAt }: { fetchedAt: string }) {
  const date = new Date(fetchedAt);
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
        {date.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}
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

export function DashboardPage({ goHome }: { goHome: () => void }) {
  const reduce = useReducedMotion();
  const { data, loading, error, stale, refetch } = useDashboardData();

  const transition = reduce
    ? { duration: 0 }
    : { duration: 0.5, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] };

  return (
    <main className="dashboard-page">
      <motion.nav
        className="dashboard-nav"
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      >
        <button type="button" className="brand-link" onClick={goHome}>
          <img src={LOGO_SRC} alt="" />
          <span>Sub Rosa</span>
        </button>
        <div className="dashboard-nav-actions">
          <button
            type="button"
            className="secondary-action compact"
            onClick={refetch}
            disabled={loading}
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
          <button type="button" className="secondary-action compact" onClick={goHome}>
            Back to home
          </button>
        </div>
      </motion.nav>

      <motion.header
        className="dashboard-header"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={transition}
      >
        <h1>Monitoring Dashboard</h1>
        <p>Real-time keeper actions and settlement status</p>
      </motion.header>

      {stale && data && <StaleBanner fetchedAt={data.meta.fetchedAt} />}

      {loading && !data ? (
        <LoadingState />
      ) : error ? (
        <DashboardErrorState error={error} onRetry={refetch} />
      ) : !data ? (
        <DashboardEmptyState />
      ) : (
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
      )}
    </main>
  );
}
