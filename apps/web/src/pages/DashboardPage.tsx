// Copyright (c) 2026 Sub Rosa contributors
import { motion, useReducedMotion } from "framer-motion";
import { useDashboardData } from "../hooks/useDashboardData";
import { LOGO_SRC } from "../lib/chain";
import { DashboardContent } from "../components/dashboard";

export function DashboardPage({ goHome }: { goHome: () => void }) {
  const reduce = useReducedMotion();
  const dashboard = useDashboardData();
  const { refreshing, refetch } = dashboard;
  const { data, loading, error, stale, refetch, snapshot } = useDashboardData();

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
            disabled={refreshing}
          >
            {refreshing ? "Refreshing..." : "Refresh"}
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

      <DashboardContent state={dashboard} onRetry={refetch} transition={transition} />
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
            <RoundStatusCard data={data} snapshot={snapshot!} />
            <SettlementCard data={data} />
          </div>
          <div className="dashboard-column">
            <KeeperStatusCard data={data} snapshot={snapshot!} />
            <BidderProgressCard data={data} />
          </div>
        </motion.div>
      )}
    </main>
  );
}
