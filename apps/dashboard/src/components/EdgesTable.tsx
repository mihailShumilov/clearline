/**
 * Edges / Positions table — the agent's staked predicates and where they landed:
 * fixture, human-readable predicate, stake, price, status, and P&L (§7 Phase 7).
 */
import type { Position } from "../api/client";
import { describePredicate, formatBps, formatSol, signOf } from "../format";

interface Props {
  readonly positions: Position[];
}

function StatusPill({ status }: { status: Position["status"] }): React.JSX.Element {
  return <span className={"pill pill--" + status}>{status}</span>;
}

export function EdgesTable({ positions }: Props): React.JSX.Element {
  return (
    <section className="block" aria-labelledby="edges-title">
      <header className="block__head">
        <h2 id="edges-title" className="block__title">
          Edges &amp; Positions
        </h2>
        <span className="block__count mono">{positions.length}</span>
      </header>

      {positions.length === 0 ? (
        <p className="block__empty">
          No edges yet. Run a demo replay to drive the pipeline and stake a predicate.
        </p>
      ) : (
        <div className="table-wrap">
          <table className="ledger">
            <thead>
              <tr>
                <th scope="col">Fixture</th>
                <th scope="col">Predicate</th>
                <th scope="col" className="num">
                  Stake
                </th>
                <th scope="col" className="num">
                  Price
                </th>
                <th scope="col">Status</th>
                <th scope="col" className="num">
                  P&amp;L
                </th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => {
                const sign = signOf(p.pnlLamports);
                return (
                  <tr key={p.id}>
                    <td className="mono">{p.fixtureId}</td>
                    <td className="mono ledger__pred">{describePredicate(p.predicate)}</td>
                    <td className="num mono">{formatSol(p.stakeLamports)}</td>
                    <td className="num mono">{formatBps(p.priceBps)}</td>
                    <td>
                      <StatusPill status={p.status} />
                    </td>
                    <td
                      className={"num mono" + (sign > 0 ? " is-win" : sign < 0 ? " is-loss" : "")}
                    >
                      {p.status === "open" ? "—" : formatSol(p.pnlLamports)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
