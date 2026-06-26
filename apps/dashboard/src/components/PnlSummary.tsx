/**
 * Running P&L — net result across settled positions, plus won/lost/open tallies.
 * A control-room panel; money is summed exactly with BigInt, never float-math (§4).
 */
import type { Position } from "../api/client";
import { formatSol, signOf } from "../format";

interface Props {
  readonly positions: Position[];
}

/** Sum lamports strings exactly with BigInt — never float-math money (§4). */
function totalPnl(positions: Position[]): string {
  let sum = 0n;
  for (const p of positions) {
    if (p.status === "open" || p.status === "void") continue;
    try {
      sum += BigInt(p.pnlLamports);
    } catch {
      // skip unparseable rows rather than crash the summary
    }
  }
  return sum.toString();
}

export function PnlSummary({ positions }: Props): React.JSX.Element {
  const total = totalPnl(positions);
  const sign = signOf(total);
  const won = positions.filter((p) => p.status === "won").length;
  const lost = positions.filter((p) => p.status === "lost").length;
  const open = positions.filter((p) => p.status === "open").length;

  return (
    <section className="panel" aria-labelledby="pnl-title">
      <div className="panel__head">
        <h3 id="pnl-title" className="panel__title">
          Running P&amp;L
        </h3>
      </div>
      <p className={"pnl__value mono" + (sign > 0 ? " is-win" : sign < 0 ? " is-loss" : "")}>
        {formatSol(total)}
      </p>
      <dl className="pnl__tallies">
        <div>
          <dt>won</dt>
          <dd className="is-win">{won}</dd>
        </div>
        <div>
          <dt>lost</dt>
          <dd className="is-loss">{lost}</dd>
        </div>
        <div>
          <dt>open</dt>
          <dd>{open}</dd>
        </div>
      </dl>
    </section>
  );
}
