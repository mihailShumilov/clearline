/**
 * ClearLine — explainer-first scrollytelling page.
 *
 * One scroll takes a non-technical judge from "why trust a bookmaker?" to a real
 * on-chain settlement they can verify on Solana Explorer. The narrative is light;
 * the live machinery (RPC health, ledger, P&L, activity) flips to a dark control
 * room at the foot. The data layer is unchanged: RPC health polls every 4s and
 * events arrive over SSE, both through the typed Zod client. A transport failure
 * flips a friendly state rather than crashing.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { HealthSnapshot, LiveEvent, Position, ReplayResult, Settlement } from "./api/client";
import { api, ApiError, subscribeEvents } from "./api/client";
import { EdgesTable } from "./components/EdgesTable";
import { EventTicker } from "./components/EventTicker";
import { PnlSummary } from "./components/PnlSummary";
import { ReplayControl } from "./components/ReplayControl";
import { RpcHealth } from "./components/RpcHealth";

/** How often to re-poll RPC health (ms) — frequent enough to show failover live. */
const HEALTH_INTERVAL_MS = 4000;
/** Cap the in-memory event buffer so a long session stays bounded. */
const MAX_EVENTS = 60;

const REPO_URL = "https://github.com/mihailShumilov/clearline";

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Reveal-on-scroll: fade/translate sections into place via IntersectionObserver.
 *
 * The observer is created lazily on first use so it already exists when React
 * runs the ref callbacks (which fire before effects). A small visible sliver
 * triggers the reveal, so even sections taller than the viewport land reliably.
 * When the user prefers reduced motion, sections are shown immediately with no
 * transform or transition.
 */
function useReveal(): (el: HTMLElement | null) => void {
  const observer = useRef<IntersectionObserver | null>(null);

  const getObserver = useCallback((): IntersectionObserver | null => {
    if (typeof IntersectionObserver === "undefined") return null;
    if (observer.current === null) {
      observer.current = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              entry.target.classList.add("is-in");
              observer.current?.unobserve(entry.target);
            }
          }
        },
        { threshold: 0.08 },
      );
    }
    return observer.current;
  }, []);

  useEffect(() => () => observer.current?.disconnect(), []);

  return useCallback(
    (el: HTMLElement | null): void => {
      if (el === null) return;
      const obs = getObserver();
      if (prefersReducedMotion() || obs === null) {
        el.classList.add("is-in");
        return;
      }
      obs.observe(el);
    },
    [getObserver],
  );
}

export function App(): React.JSX.Element {
  const [health, setHealth] = useState<HealthSnapshot | null>(null);
  const [apiDown, setApiDown] = useState(false);
  const [positions, setPositions] = useState<Position[]>([]);
  const [, setSettlements] = useState<Settlement[]>([]);
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [streamConnected, setStreamConnected] = useState(false);
  const reveal = useReveal();

  /** Re-fetch the agent-state data (positions, settlements). */
  const refreshData = useCallback(async (): Promise<void> => {
    try {
      const [pos, setl] = await Promise.all([api.positions(), api.settlements()]);
      setPositions(pos);
      setSettlements(setl);
      setApiDown(false);
    } catch (err) {
      if (err instanceof ApiError) setApiDown(true);
    }
  }, []);

  const onReplayComplete = useCallback(
    (_result: ReplayResult): void => {
      void refreshData();
    },
    [refreshData],
  );

  // Poll RPC health on an interval; tolerate failures (disconnected state).
  useEffect(() => {
    let cancelled = false;
    const poll = async (): Promise<void> => {
      try {
        const res = await api.health();
        if (cancelled) return;
        setHealth(res.rpc);
        setApiDown(false);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError) {
          setApiDown(true);
          setHealth(null);
        }
      }
    };
    void poll();
    const id = window.setInterval(() => void poll(), HEALTH_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // Initial data load.
  useEffect(() => {
    void refreshData();
  }, [refreshData]);

  // SSE subscription for the live event stream.
  useEffect(() => {
    const unsubscribe = subscribeEvents({
      onOpen: () => setStreamConnected(true),
      onError: () => setStreamConnected(false),
      onEvent: (event) => {
        setEvents((prev) => {
          // De-duplicate by SSE frame id (reconnects must not double-append).
          if (event.id !== undefined && prev.some((e) => e.id === event.id)) return prev;
          const next = [...prev, event];
          return next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next;
        });
      },
    });
    return unsubscribe;
  }, []);

  return (
    <div className="page">
      <a className="skip-link" href="#demo">
        Skip to the live demo
      </a>

      <nav className="nav" aria-label="Primary">
        <a className="nav__brand" href="#top">
          <span className="nav__mark" aria-hidden="true" />
          ClearLine
        </a>
        <div className="nav__links">
          <a href="#how">How it works</a>
          <a href="#live">Live machinery</a>
          <a className="nav__cta" href="#demo">
            See it settle ↓
          </a>
        </div>
      </nav>

      <main id="top">
        {/* 1 — Hero */}
        <header className="section hero">
          <div className="wrap">
            <p className="eyebrow">Trustless sports settlement · Solana devnet</p>
            <h1 className="hero__h1">Why trust a bookmaker? You shouldn&apos;t have to.</h1>
            <p className="hero__sub">
              ClearLine settles a sports bet the moment the match ends — and the result is proven on
              Solana with a cryptographic proof from the TxLINE oracle. No reporter to bribe, no
              payout to dispute.
            </p>
            <div className="hero__actions">
              <a className="btn btn--primary" href="#demo">
                See it settle ↓
              </a>
              <a className="btn btn--ghost" href="#how">
                How it works
              </a>
            </div>
            <p style={{ marginTop: "1.6rem" }}>
              <span className={"chip" + (apiDown ? " chip--off" : "")}>
                <span
                  className={"chip__dot" + (apiDown ? " chip__dot--off" : "")}
                  aria-hidden="true"
                />
                {apiDown ? "Reconnecting to devnet" : "Live on devnet"}
              </span>
            </p>
          </div>
        </header>

        {/* 2 — The problem */}
        <section className="section" aria-labelledby="problem-title">
          <div className="wrap reveal" ref={reveal}>
            <p className="eyebrow">The problem</p>
            <h2 id="problem-title" className="section__h2">
              Every bet ends the same way: &ldquo;trust me.&rdquo;
            </h2>
            <p className="lead">
              Today, settling a wager means trusting a middleman to report the score and pay out.
              They can stall, make a mistake, or quietly rig it — and you have no way to check.
            </p>
            <div className="contrast">
              <article className="card card--old">
                <p className="card__kicker">The old way</p>
                <h3>Trust the bookmaker</h3>
                <ul className="list">
                  <li>
                    <span className="list__icon" aria-hidden="true">
                      ✕
                    </span>
                    A middleman decides what the score was.
                  </li>
                  <li>
                    <span className="list__icon" aria-hidden="true">
                      ✕
                    </span>
                    Payouts can stall, err, or be quietly rigged.
                  </li>
                  <li>
                    <span className="list__icon" aria-hidden="true">
                      ✕
                    </span>
                    You can&apos;t independently verify the result.
                  </li>
                </ul>
              </article>
              <article className="card card--new">
                <p className="card__kicker">ClearLine</p>
                <h3>Verify the proof</h3>
                <ul className="list">
                  <li>
                    <span className="list__icon" aria-hidden="true">
                      ✓
                    </span>
                    The score is anchored on-chain by the TxLINE oracle.
                  </li>
                  <li>
                    <span className="list__icon" aria-hidden="true">
                      ✓
                    </span>
                    Solana itself settles the bet — no human in the path.
                  </li>
                  <li>
                    <span className="list__icon" aria-hidden="true">
                      ✓
                    </span>
                    Anyone can check the proof on Solana Explorer.
                  </li>
                </ul>
              </article>
            </div>
          </div>
        </section>

        {/* 3 — How it works */}
        <section id="how" className="section" aria-labelledby="how-title">
          <div className="wrap reveal" ref={reveal}>
            <p className="eyebrow">The proof</p>
            <h2 id="how-title" className="section__h2">
              Three steps, no middleman.
            </h2>
            <ol className="steps">
              <li className="step">
                <span className="step__num" aria-hidden="true">
                  1
                </span>
                <div>
                  <h3>The score goes on-chain</h3>
                  <p>
                    TxLINE anchors every World Cup score to Solana as a tamper-evident Merkle root —
                    a fingerprint of the result that can&apos;t be quietly changed.
                  </p>
                </div>
              </li>
              <li className="step">
                <span className="step__num" aria-hidden="true">
                  2
                </span>
                <div>
                  <h3>The agent takes a position</h3>
                  <p>
                    ClearLine watches the live feed and stakes a precise edge — a concrete claim
                    about the match, priced and recorded.
                  </p>
                </div>
              </li>
              <li className="step">
                <span className="step__num" aria-hidden="true">
                  3
                </span>
                <div>
                  <h3>Solana settles it</h3>
                  <p>
                    At full time, ClearLine submits a Merkle proof to the on-chain{" "}
                    <code className="mono">validate_stat</code>, and Solana itself returns TRUE or
                    FALSE. The bookmaker is gone.
                  </p>
                </div>
              </li>
            </ol>
          </div>
        </section>

        {/* 4 — See it live (the climax) */}
        <section id="demo" className="section demo" aria-labelledby="demo-title">
          <div className="wrap reveal" ref={reveal}>
            <p className="eyebrow">See it live</p>
            <h2 id="demo-title" className="section__h2">
              Watch a real World Cup result settle itself.
            </h2>
            <p className="lead">
              Press the button. The pipeline runs the full settlement, then Solana returns the
              verdict — with a proof you can open on Explorer yourself.
            </p>
            <ReplayControl onComplete={onReplayComplete} />
          </div>
        </section>

        {/* 5 — Under the hood, live (dark control room) */}
        <section id="live" className="section control" aria-labelledby="live-title">
          <div className="wrap reveal" ref={reveal}>
            <p className="eyebrow">Live</p>
            <h2 id="live-title" className="section__h2">
              Under the hood — and it&apos;s alive.
            </h2>
            <p className="lead">
              The same machinery, running right now against Solana devnet. This isn&apos;t a mock-up
              — these readouts poll and stream live.
            </p>
            <div className="control-grid">
              <RpcHealth snapshot={health} disconnected={apiDown} />
              <div className="control-stack">
                <PnlSummary positions={positions} />
                <EventTicker events={events} connected={streamConnected && !apiDown} />
              </div>
            </div>
            <div style={{ marginTop: "1.25rem" }}>
              <EdgesTable positions={positions} />
            </div>
          </div>
        </section>
      </main>

      {/* 6 — Footer */}
      <footer className="footer">
        <div className="footer__inner">
          <div className="footer__links">
            <a href={REPO_URL} target="_blank" rel="noreferrer">
              GitHub repo ↗
            </a>
            <a href="#demo">Verify the settlement on Solana Explorer</a>
          </div>
          <p className="footer__built">
            Built on Solana · TxLINE oracle · solana-resilience-kit · devnet
          </p>
        </div>
      </footer>
    </div>
  );
}
