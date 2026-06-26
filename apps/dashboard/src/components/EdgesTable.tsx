/**
 * Edges & positions ledger — the agent's staked predicates and where they landed:
 * fixture, human-readable predicate, stake, price, status, and P&L. A control-room
 * panel.
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
    <section className="panel" aria-labelledby="edges-title">
      <div className="panel__head">
        <h3 id="edges-title" className="panel__title">
          Edges &amp; positions
        </h3>
        <span className="panel__summary">
          {positions.length}
          <small>staked</small>
        </span>
      </div>

      {positions.length === 0 ? (
        <p className="panel__empty">
          No edges yet. Run the demo above to drive the pipeline and stake a predicate.
        </p>
      ) : (
        <div className="ledger-wrap">
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
