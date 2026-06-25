/**
 * Running P&L — summed net result across settled positions, plus open/won/lost
 * tallies. Sits in the status rail beside RPC Health, in the instrument register.
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
    <section className="rail-panel pnl" aria-labelledby="pnl-title">
      <header className="rail-panel__head">
        <h2 id="pnl-title" className="rail-panel__title">
          Running P&amp;L
        </h2>
      </header>
      <p className={"pnl__value mono" + (sign > 0 ? " is-win" : sign < 0 ? " is-loss" : "")}>
        {formatSol(total)}
      </p>
      <dl className="pnl__tallies">
        <div>
          <dt>won</dt>
          <dd className="mono is-win">{won}</dd>
        </div>
        <div>
          <dt>lost</dt>
          <dd className="mono is-loss">{lost}</dd>
        </div>
        <div>
          <dt>open</dt>
          <dd className="mono">{open}</dd>
        </div>
      </dl>
    </section>
  );
}
