/**
 * RPC Health panel — control-room readout of the resilience-kit (§11b).
 *
 * "The data feed never blinks": solana-resilience-kit keeps the oracle connection
 * alive across providers and fails over automatically. Each endpoint shows its
 * live slot, latency, error rate, and failure streak; an unhealthy node
 * desaturates and a backup is revealed picking up the load.
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
  const summaryClass = disconnected
    ? " panel__summary--off"
    : allDown
      ? " panel__summary--down"
      : "";

  return (
    <section className="panel" aria-labelledby="rpc-health-title">
      <div className="panel__head">
        <h3 id="rpc-health-title" className="panel__title">
          RPC health
        </h3>
        <span className={"panel__summary" + summaryClass}>
          {disconnected ? "—" : `${healthy}/${total}`}
          <small>{disconnected ? "no API" : "endpoints live"}</small>
        </span>
      </div>
      <p className="panel__note">
        The data feed never blinks — solana-resilience-kit keeps the oracle connection alive across
        providers, failing over automatically.
      </p>

      {disconnected ? (
        <p className="panel__empty">
          API unreachable. The dashboard reconnects automatically — start the worker with{" "}
          <code>wrangler dev</code>.
        </p>
      ) : !snapshot || snapshot.endpoints.length === 0 ? (
        <p className="panel__empty">No endpoints reported.</p>
      ) : (
        <ul className="nodes" role="list">
          {snapshot.endpoints.map((ep) => (
            <li key={ep.name} className={"node" + (ep.healthy ? "" : " node--down")}>
              <div className="node__top">
                <span className="node__dot" aria-hidden="true" />
                <span className="node__name">{ep.name}</span>
                {ep.freshest && ep.healthy ? (
                  <span className="node__freshest" title="Highest observed slot">
                    freshest
                  </span>
                ) : null}
                <span
                  className={
                    "node__state" + (ep.healthy ? " node__state--up" : " node__state--down")
                  }
                >
                  {ep.healthy ? "HEALTHY" : ep.freshest ? "FAILOVER" : "DOWN"}
                </span>
              </div>

              <div className="node__slot mono">
                <span className="node__label">slot</span>
                {ep.slot ?? "—"}
              </div>

              <div className="node__metrics">
                <div className="metric">
                  <span className="node__label">latency</span>
                  <span className="latbar" aria-hidden="true">
                    <span
                      className="latbar__fill"
                      style={{ width: `${latencyPct(ep.latencyMs)}%` }}
                    />
                  </span>
                  <span className="mono metric__val">{formatLatency(ep.latencyMs)}</span>
                </div>
                <div className="metric">
                  <span className="node__label">errors</span>
                  <span className="mono metric__val">{formatRate(ep.errorRate)}</span>
                </div>
                {ep.consecutiveFailures > 0 ? (
                  <div className="metric metric--alarm">
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
