/**
 * Settlement card — the trust anchor. Stamps the verdict (TRUE/FALSE), names the
 * source, and surfaces the full on-chain provenance: the Solana Explorer link, the
 * `daily_scores_roots` PDA, the program id, and the verdict source — all in mono so
 * the cryptographic evidence reads as evidence (§7 Phase 7).
 */
import type { Position, Settlement, ReplayOnChain } from "../api/client";
import { describePredicate, formatClock, formatSol, signOf, truncateMid } from "../format";

interface Props {
  readonly settlement: Settlement;
  /** The position this settlement resolves, for predicate + P&L context. */
  readonly position: Position | undefined;
  /** On-chain proof from the most recent replay, when this is the live verdict. */
  readonly onchain: ReplayOnChain | null;
}

/** A labelled monospace evidence row with a copy-friendly full value. */
function Evidence({
  label,
  value,
  href,
}: {
  label: string;
  value: string | null;
  href?: string | null;
}): React.JSX.Element {
  return (
    <div className="evidence">
      <span className="evidence__label">{label}</span>
      {value === null ? (
        <span className="evidence__val mono evidence__val--empty">not recorded</span>
      ) : href ? (
        <a
          className="evidence__val mono evidence__link"
          href={href}
          target="_blank"
          rel="noreferrer"
          title={value}
        >
          {truncateMid(value, 8, 8)} ↗
        </a>
      ) : (
        <span className="evidence__val mono" title={value}>
          {truncateMid(value, 10, 10)}
        </span>
      )}
    </div>
  );
}

export function SettlementCard({ settlement, position, onchain }: Props): React.JSX.Element {
  const holds = settlement.holds;
  const pnl = position?.pnlLamports ?? null;
  const pnlSign = pnl === null ? 0 : signOf(pnl);

  return (
    <article className={"verdict" + (holds ? " verdict--true" : " verdict--false")}>
      <div
        className="verdict__stamp"
        aria-label={holds ? "Predicate holds: TRUE" : "Predicate holds: FALSE"}
      >
        <span className="verdict__word">{holds ? "TRUE" : "FALSE"}</span>
        <span className="verdict__sub">predicate verdict</span>
      </div>

      <div className="verdict__body">
        <div className="verdict__line">
          <span className="verdict__eyebrow">Fixture {position?.fixtureId ?? "—"}</span>
          <span className={"src-tag src-tag--" + settlement.source}>{settlement.source}</span>
        </div>

        <p className="verdict__predicate mono">
          {position ? describePredicate(position.predicate) : "predicate unavailable"}
        </p>

        {pnl !== null ? (
          <p className={"verdict__pnl" + (pnlSign > 0 ? " is-win" : pnlSign < 0 ? " is-loss" : "")}>
            <span className="verdict__eyebrow">settled P&amp;L</span>
            <span className="mono">{formatSol(pnl)}</span>
          </p>
        ) : null}

        <div className="evidence-grid">
          <Evidence label="explorer" value={settlement.explorerUrl} href={settlement.explorerUrl} />
          <Evidence
            label="daily_scores_roots PDA"
            value={settlement.rootPda ?? onchain?.dailyScoresRootsPda ?? null}
          />
          <Evidence label="program id" value={settlement.programId ?? onchain?.programId ?? null} />
          <Evidence label="signature" value={settlement.signature} />
          <div className="evidence">
            <span className="evidence__label">verdict source</span>
            <span className="evidence__val mono">
              {onchain?.verdictSource ??
                (settlement.source === "onchain" ? "onchain-recorded" : "local")}
            </span>
          </div>
          <div className="evidence">
            <span className="evidence__label">settled at</span>
            <span className="evidence__val mono">{formatClock(settlement.createdAtMs)}</span>
          </div>
        </div>
      </div>
    </article>
  );
}
