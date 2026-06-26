/**
 * Live activity ticker — the SSE tail. Newest events first; each row is a
 * timestamp + kind + compact payload. A small lamp shows whether the stream is
 * live. A control-room panel.
 */
import type { LiveEvent } from "../api/client";
import { formatClock } from "../format";

interface Props {
  readonly events: LiveEvent[];
  readonly connected: boolean;
}

/** Render an event payload as a single compact, safe-to-display line. */
function summarize(data: unknown): string {
  if (data === null || data === undefined) return "";
  if (typeof data === "object") {
    const entries = Object.entries(data as Record<string, unknown>);
    return entries
      .filter(([, v]) => v !== null && typeof v !== "object")
      .map(([k, v]) => `${k}=${String(v)}`)
      .join("  ");
  }
  return String(data);
}

export function EventTicker({ events, connected }: Props): React.JSX.Element {
  const ordered = [...events].reverse();
  return (
    <section className="panel" aria-labelledby="ticker-title" aria-live="polite">
      <div className="panel__head">
        <span className={"lamp" + (connected ? " lamp--on" : " lamp--off")} aria-hidden="true" />
        <h3 id="ticker-title" className="panel__title">
          Live activity
        </h3>
        <span className="panel__summary">
          {connected ? "streaming" : "reconnecting"}
          <small>SSE feed</small>
        </span>
      </div>
      <ol className="ticker__list" role="list">
        {ordered.length === 0 ? (
          <li className="ticker__empty">Waiting for events from the agent…</li>
        ) : (
          ordered.map((ev, i) => (
            <li key={`${ev.ts}-${ev.kind}-${i}`} className="ticker__row">
              <span className="ticker__time mono">{formatClock(ev.ts)}</span>
              <span className="ticker__kind">{ev.kind}</span>
              <span className="ticker__payload mono">{summarize(ev.data)}</span>
            </li>
          ))
        )}
      </ol>
    </section>
  );
}
