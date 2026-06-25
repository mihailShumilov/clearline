/**
 * RPC Health panel — the resilience-kit instrument rail (§11b, headline panel).
 *
 * Each endpoint is a "live readout": name, healthy state, slot odometer, latency
 * bar, error rate, consecutive failures, and a FRESHEST tag on the lead node.
 * Failover is made legible — an unhealthy node desaturates and shows its failure
 * streak, so killing an endpoint during the demo reads instantly.
 */
import type { HealthSnapshot } from "../api/client";
import { formatLatency, formatRate } from "../format";

/** Cap the latency bar so a slow node fills the track without overflowing. */
const LATENCY_FULL_MS = 400;

function latencyPct(ms: number): number {
  return Math.max(4, Math.min(100, (ms / LATENCY_FULL_MS) * 100));
}

interface Props {
  readonly snapshot: HealthSnapshot | null;
  readonly disconnected: boolean;
}

export function RpcHealth({ snapshot, disconnected }: Props): React.JSX.Element {
  const healthy = snapshot?.healthyCount ?? 0;
  const total = snapshot?.totalCount ?? 0;
  const allDown = total > 0 && healthy === 0;

  return (
    <section className="rail-panel" aria-labelledby="rpc-health-title">
      <header className="rail-panel__head">
        <h2 id="rpc-health-title" className="rail-panel__title">
          RPC Health
        </h2>
        <span
          className={
            "rpc-summary" +
            (disconnected ? " rpc-summary--off" : allDown ? " rpc-summary--down" : "")
          }
        >
          {disconnected ? "—" : `${healthy}/${total}`}
          <small>{disconnected ? "no API" : "healthy"}</small>
        </span>
      </header>

      {disconnected ? (
        <p className="rail-panel__empty">
          API unreachable. The dashboard reconnects automatically — start the worker with{" "}
          <code>wrangler dev</code>.
        </p>
      ) : !snapshot || snapshot.endpoints.length === 0 ? (
        <p className="rail-panel__empty">No endpoints reported.</p>
      ) : (
        <ul className="node-list" role="list">
          {snapshot.endpoints.map((ep) => (
            <li
              key={ep.name}
              className={"node" + (ep.healthy ? "" : " node--down")}
              data-freshest={ep.freshest}
            >
              <div className="node__top">
                <span className="node__dot" aria-hidden="true" />
                <span className="node__name">{ep.name}</span>
                {ep.freshest && ep.healthy ? (
                  <span className="node__freshest" title="Highest observed slot">
                    FRESHEST
                  </span>
                ) : null}
                <span
                  className={
                    "node__state" + (ep.healthy ? " node__state--up" : " node__state--down")
                  }
                >
                  {ep.healthy ? "HEALTHY" : "DOWN"}
                </span>
              </div>

              <div className="node__slot mono">
                <span className="node__label">slot</span>
                {ep.slot ?? "—"}
              </div>

              <div className="node__metrics">
                <div className="metric">
                  <span className="node__label">latency</span>
                  <div className="latbar" aria-hidden="true">
                    <span
                      className="latbar__fill"
                      style={{ width: `${latencyPct(ep.latencyMs)}%` }}
                    />
                  </div>
                  <span className="mono metric__val">{formatLatency(ep.latencyMs)}</span>
                </div>
                <div className="metric metric--inline">
                  <span className="node__label">errors</span>
                  <span className="mono metric__val">{formatRate(ep.errorRate)}</span>
                </div>
                {ep.consecutiveFailures > 0 ? (
                  <div className="metric metric--inline metric--alarm">
                    <span className="node__label">streak</span>
                    <span className="mono metric__val">{ep.consecutiveFailures}✕</span>
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
