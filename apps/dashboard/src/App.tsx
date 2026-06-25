/**
 * ClearLine — Proof-of-Edge dashboard (§7 Phase 7).
 *
 * A "settlement terminal": a status rail (RPC Health, P&L, demo replay) beside the
 * settlement verdicts and the edges ledger, with the live event ticker pinned at
 * the foot. All data is fetched through the typed Zod client; a transport failure
 * flips a disconnected banner rather than crashing the UI. RPC health polls on an
 * interval (so failover is visible live); events arrive over SSE.
 */
import { useCallback, useEffect, useState } from "react";
import type {
  AgentStatus,
  HealthSnapshot,
  LiveEvent,
  Position,
  ReplayOnChain,
  ReplayResult,
  Settlement,
} from "./api/client";
import { api, ApiError, subscribeEvents } from "./api/client";
import { EdgesTable } from "./components/EdgesTable";
import { EventTicker } from "./components/EventTicker";
import { PnlSummary } from "./components/PnlSummary";
import { ReplayControl } from "./components/ReplayControl";
import { RpcHealth } from "./components/RpcHealth";
import { SettlementCard } from "./components/SettlementCard";

/** How often to re-poll RPC health (ms) — frequent enough to show failover live. */
const HEALTH_INTERVAL_MS = 4000;
/** Cap the in-memory event buffer so a long session stays bounded. */
const MAX_EVENTS = 60;

export function App(): React.JSX.Element {
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [apiDown, setApiDown] = useState(false);
  const [positions, setPositions] = useState<Position[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [agent, setAgent] = useState<AgentStatus | null>(null);
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [streamConnected, setStreamConnected] = useState(false);
  const [onchain, setOnchain] = useState<ReplayOnChain | null>(null);

  /** Re-fetch the agent-state data (positions, settlements, status). */
  const refreshData = useCallback(async (): Promise<void> => {
    try {
      const [pos, setl, status] = await Promise.all([
        api.positions(),
        api.settlements(),
        api.agentStatus(),
      ]);
      setPositions(pos);
      setSettlements(setl);
      setAgent(status);
      setApiDown(false);
    } catch (err) {
      if (err instanceof ApiError) setApiDown(true);
    }
  }, []);

  // Capture the on-chain proof from the replay so the live verdict card can show
  // full provenance even when the persisted settlement omits some fields, then
  // refresh the persisted positions/settlements.
  const onReplayComplete = useCallback(
    (result: ReplayResult): void => {
      if (result.onchain) setOnchain(result.onchain);
      void refreshData();
    },
    [refreshData],
  );

  // Poll RPC health on an interval; tolerate failures (disconnected state).
  useEffect(() => {
    let cancelled = false;
    const poll = async (): Promise<void> => {
      try {
        const res = await api.health();
        if (cancelled) return;
        setHealth(res.rpc);
        setApiDown(false);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError) {
          setApiDown(true);
          setHealth(null);
        }
      }
    };
    void poll();
    const id = window.setInterval(() => void poll(), HEALTH_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // Initial data load.
  useEffect(() => {
    void refreshData();
  }, [refreshData]);

  // SSE subscription for the live event stream.
  useEffect(() => {
    const unsubscribe = subscribeEvents({
      onOpen: () => setStreamConnected(true),
      onError: () => setStreamConnected(false),
      onEvent: (event) => {
        setEvents((prev) => {
          const next = [...prev, event];
          return next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next;
        });
      },
    });
    return unsubscribe;
  }, []);

  // Index positions by their stable replay id (`fixture:<id>`) so each settlement
  // card can pair with its position for predicate + P&L context.
  const positionById = new Map(positions.map((p) => [p.id, p]));

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true" />
          <span className="brand__name">ClearLine</span>
          <span className="brand__tag mono">proof-of-edge · devnet</span>
        </div>
        <p className="topbar__thesis">
          Autonomous sports-edge settlement, verified against an on-chain Merkle root. No trusted
          reporter in the path.
        </p>
        {apiDown ? (
          <span className="conn-badge conn-badge--off" role="status">
            API disconnected
          </span>
        ) : (
          <span className="conn-badge conn-badge--on" role="status">
            API live
          </span>
        )}
      </header>

      <div className="layout">
        <aside className="rail">
          <RpcHealth snapshot={health} disconnected={apiDown} />
          <PnlSummary positions={positions} />
          <ReplayControl onComplete={onReplayComplete} agent={agent} />
        </aside>

        <main className="main">
          <section className="block" aria-labelledby="settlements-title">
            <header className="block__head">
              <h2 id="settlements-title" className="block__title">
                Settlements
              </h2>
              <span className="block__count mono">{settlements.length}</span>
            </header>
            {settlements.length === 0 ? (
              <p className="block__empty">
                No settlements yet. Run a demo replay — the settled verdict appears here with its
                Explorer link and the root it was proven against.
              </p>
            ) : (
              <div className="verdict-stack">
                {settlements.map((s) => (
                  <SettlementCard
                    key={s.id}
                    settlement={s}
                    position={positionById.get(s.positionId)}
                    onchain={onchain}
                  />
                ))}
              </div>
            )}
          </section>

          <EdgesTable positions={positions} />
        </main>
      </div>

      <EventTicker events={events} connected={streamConnected && !apiDown} />
    </div>
  );
}
