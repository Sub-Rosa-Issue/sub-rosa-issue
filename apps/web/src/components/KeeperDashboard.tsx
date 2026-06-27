import React, { useEffect, useState } from "react";

interface RoundStatus {
  roundId: string;
  status: "pending" | "processing" | "settled" | "failed";
  attempts: number;
  addedAt: string;
  lastAttempt?: string;
  error?: string;
}

interface DashboardData {
  ok: boolean;
  updatedAt: string;
  rounds: RoundStatus[];
  summary: {
    total: number;
    pending: number;
    processing: number;
    settled: number;
    failed: number;
  };
}

const STATUS_COLORS: Record<RoundStatus["status"], string> = {
  pending:    "bg-yellow-100 text-yellow-800 border-yellow-200",
  processing: "bg-blue-100   text-blue-800   border-blue-200",
  settled:    "bg-green-100  text-green-800  border-green-200",
  failed:     "bg-red-100    text-red-800    border-red-200",
};

const POLL_INTERVAL_MS = 10_000;

/**
 * KeeperDashboard — polls the /status endpoint from the keeper status API
 * and renders round state, keeper actions, and settlement results.
 */
export function KeeperDashboard({ apiUrl = "http://localhost:7373" }: { apiUrl?: string }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastPoll, setLastPoll] = useState<Date | null>(null);

  const poll = async () => {
    try {
      const res = await fetch(`${apiUrl}/status`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: DashboardData = await res.json();
      setData(json);
      setError(null);
      setLastPoll(new Date());
    } catch (err) {
      setError(String(err));
    }
  };

  useEffect(() => {
    poll();
    const timer = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [apiUrl]);

  if (error) return (
    <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
      <p className="text-red-700 font-medium">Keeper API unreachable</p>
      <p className="text-red-500 text-sm mt-1">{error}</p>
      <p className="text-xs text-gray-400 mt-2">Polling {apiUrl}/status</p>
    </div>
  );

  if (!data) return (
    <div className="p-4 text-gray-500 text-sm">Loading keeper status...</div>
  );

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-4 gap-3">
        {Object.entries(data.summary).filter(([k]) => k !== "total").map(([key, val]) => (
          <div key={key} className="bg-white border rounded-lg p-3 text-center shadow-sm">
            <div className="text-2xl font-bold text-gray-800">{val}</div>
            <div className="text-xs text-gray-500 capitalize mt-1">{key}</div>
          </div>
        ))}
      </div>

      {/* Rounds table */}
      <div className="bg-white border rounded-lg overflow-hidden shadow-sm">
        <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50">
          <h2 className="font-semibold text-gray-700 text-sm">Rounds ({data.summary.total})</h2>
          {lastPoll && <span className="text-xs text-gray-400">Updated {lastPoll.toLocaleTimeString()}</span>}
        </div>
        {data.rounds.length === 0 ? (
          <div className="p-4 text-center text-gray-400 text-sm">No rounds tracked yet</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="px-4 py-2 text-left">Round ID</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-left">Attempts</th>
                <th className="px-4 py-2 text-left">Last Activity</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.rounds.map(r => (
                <tr key={r.roundId} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-mono text-xs text-gray-600 truncate max-w-xs">{r.roundId}</td>
                  <td className="px-4 py-2">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLORS[r.status]}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-gray-500">{r.attempts}</td>
                  <td className="px-4 py-2 text-gray-400 text-xs">
                    {r.lastAttempt ? new Date(r.lastAttempt).toLocaleString() : new Date(r.addedAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default KeeperDashboard;
