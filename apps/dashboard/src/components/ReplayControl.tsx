/**
 * Demo-replay control — the single confident action. Fires `POST /api/demo-replay`,
 * then asks the parent to refresh positions/settlements/events. Shows running,
 * success (with verdict count), and error states inline; never crashes the UI.
 */
import { useState } from "react";
import type { AgentStatus, ReplayResult } from "../api/client";
import { api, ApiError } from "../api/client";

interface Props {
  /** Called with the replay result so the parent can refresh + capture proof. */
  readonly onComplete: (result: ReplayResult) => void;
  readonly agent: AgentStatus | null;
}

type Phase =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "done"; positions: number; settlements: number }
  | { kind: "error"; message: string };

export function ReplayControl({ onComplete, agent }: Props): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  async function run(): Promise<void> {
    setPhase({ kind: "running" });
    try {
      const result = await api.runReplay();
      setPhase({
        kind: "done",
        positions: result.positions.length,
        settlements: result.settlements.length,
      });
      onComplete(result);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err);
      setPhase({ kind: "error", message });
    }
  }

  const running = phase.kind === "running";

  return (
    <section className="rail-panel replay" aria-labelledby="replay-title">
      <header className="rail-panel__head">
        <h2 id="replay-title" className="rail-panel__title">
          Demo Replay
        </h2>
        <span className={"agent-state agent-state--" + (agent?.state ?? "idle")}>
          {agent?.state ?? "idle"}
        </span>
      </header>
      <p className="replay__hint">
        Replays a real World Cup fixture deterministically through the full pipeline.
      </p>
      <button
        type="button"
        className="run-btn"
        onClick={() => void run()}
        disabled={running}
        aria-busy={running}
      >
        {running ? "Replaying…" : "Run demo replay"}
      </button>
      {phase.kind === "done" ? (
        <p className="replay__result is-ok" role="status">
          Settled {phase.settlements} verdict{phase.settlements === 1 ? "" : "s"} across{" "}
          {phase.positions} position{phase.positions === 1 ? "" : "s"}.
        </p>
      ) : null}
      {phase.kind === "error" ? (
        <p className="replay__result is-err" role="alert">
          Replay failed: {phase.message}
        </p>
      ) : null}
    </section>
  );
}
