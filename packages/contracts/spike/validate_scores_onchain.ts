/**
 * ClearLine Phase-4 on-chain spike (THROWAWAY, devnet only).
 *
 * Proves a trader predicate on real TxLINE World-Cup score data via the three-stage
 * Merkle proof + the on-chain TxLINE `validate_stat` instruction, against the published
 * `daily_scores_roots` PDA. Mirrors the official tx-on-chain example, but:
 *   - targets the DEVNET host + DEVNET program/mint (txoracle.devnet.json),
 *   - calls validate_stat as a read-only `.view()` (returns bool; no fee, no signature),
 *   - runs it TWICE with a predicate that should hold (TRUE) and one that should fail
 *     (FALSE) to prove the on-chain verification discriminates correctly.
 *
 * This is an isolated spike (NOT shipped product code — the product's
 * OnChainSettlementProvider will use @clearline/chain + Codama; see DECISIONS ADR-0006).
 *
 * Requires env SPIKE_KEYPAIR=<path to devnet keypair json>.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  Keypair,
  SystemProgram,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import * as nacl from "tweetnacl";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// Devnet-patched IDL (generated from idl/txoracle.json): address ->
// 6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J, TXLINE_MINT/USDT_MINT -> devnet mints,
// and validate_stat.returns -> "bool" (the deployed program returns a bool via Solana
// return-data; the mainnet IDL omitted `returns`, which blocks Anchor's `.view()`).
import idl from "./txoracle.devnet.json";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");

const API_BASE = "https://txline-dev.txodds.com";
const RPC_URL = "https://api.devnet.solana.com";
const KEYPAIR_PATH = process.env.SPIKE_KEYPAIR!;
const SELECTED_LEAGUES: number[] = [];
const EXPLORER = (sig: string) =>
  `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const constant = (name: string): string =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (idl as any).constants.find((c: any) => c.name === name).value as string;

const SUBSCRIPTION_TOKEN_MINT = new PublicKey(constant("TXLINE_MINT"));

function loadKeypair(path: string): Keypair {
  const secret = Uint8Array.from(JSON.parse(readFileSync(path, "utf8")));
  return Keypair.fromSecretKey(secret);
}

// The devnet feed returns 32-byte roots/hashes as JSON number[] arrays already (NOT the
// base64 strings the mainnet OpenAPI `format: binary` implied). Normalise either form to
// a number[32] for the Anchor [u8;32] / ProofNode shapes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toBytes = (v: any): number[] =>
  Array.isArray(v) ? (v as number[]) : Array.from(Buffer.from(String(v), "base64"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toProof = (nodes: any[] | null | undefined) =>
  (nodes ?? []).map((n) => ({
    hash: toBytes(n.hash),
    isRightSibling: n.isRightSibling,
  }));

interface StatValidation {
  ts: number;
  statToProve: { key: number; value: number; period: number };
  eventStatRoot: string;
  summary: {
    fixtureId: number;
    updateStats: { updateCount: number; minTimestamp: number; maxTimestamp: number };
    eventStatsSubTreeRoot: string;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  statProof: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  subTreeProof: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mainTreeProof: any[];
}

async function jget(
  base: string,
  path: string,
  headers: Record<string, string>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const r = await fetch(base + path, { headers });
  const text = await r.text();
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

async function main() {
  const log = (...a: unknown[]) => console.log(...a);
  const kp = loadKeypair(KEYPAIR_PATH);
  const connection = new Connection(RPC_URL, "confirmed");
  const wallet = new anchor.Wallet(kp);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const program = new Program(idl as any, provider);

  log("=== STEP 1: sanity ===");
  log("wallet:", kp.publicKey.toBase58());
  log("program:", program.programId.toBase58());
  log("balance (SOL):", (await connection.getBalance(kp.publicKey)) / 1e9);

  log("\n=== STEP 2: guest auth (devnet host) ===");
  const authResp = await fetch(`${API_BASE}/auth/guest/start`, { method: "POST" });
  const jwt = (await authResp.json()).token as string;
  log(`auth ${authResp.status}; JWT length ${jwt.length}`);

  log("\n=== STEP 3: TxL Token-2022 ATA ===");
  const userTokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    kp,
    SUBSCRIPTION_TOKEN_MINT,
    kp.publicKey,
    false,
    "confirmed",
    undefined,
    TOKEN_2022_PROGRAM_ID
  );
  log("user TxL ATA:", userTokenAccount.address.toBase58());

  // NOTE: devnet program requires weeks to be a multiple of 4 (error 6041 InvalidWeeks
  // on weeks=1, despite the example's subscribe(1,1)). SL1 price is 0 so 4wk is still free.
  const WEEKS = 4;
  log(`\n=== STEP 4: subscribe(serviceLevel=1, weeks=${WEEKS}) ===`);
  const [pricingMatrixPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pricing_matrix")],
    program.programId
  );
  const [tokenTreasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_treasury_v2")],
    program.programId
  );
  const tokenTreasuryVault = getAssociatedTokenAddressSync(
    SUBSCRIPTION_TOKEN_MINT,
    tokenTreasuryPda,
    true,
    TOKEN_2022_PROGRAM_ID
  );

  // Confirm free-tier cost from on-chain pricing_matrix before subscribing.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pm = await (program.account as any).pricingMatrix.fetch(pricingMatrixPda);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sl1 = (pm.rows as any[]).find((r) => r.rowId === 1);
  log("SL1 price_per_week_token:", sl1 ? sl1.pricePerWeekToken.toString() : "<none>");

  const txSig = await program.methods
    .subscribe(1, WEEKS)
    .accounts({
      user: kp.publicKey,
      pricingMatrix: pricingMatrixPda,
      tokenMint: SUBSCRIPTION_TOKEN_MINT,
      userTokenAccount: userTokenAccount.address,
      tokenTreasuryVault,
      tokenTreasuryPda,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  log("subscribe txSig:", txSig);
  log("Explorer:", EXPLORER(txSig));

  log("\n=== STEP 5: sign + activate ===");
  const messageString = `${txSig}:${SELECTED_LEAGUES.join(",")}:${jwt}`;
  const signatureBytes = nacl.sign.detached(
    new TextEncoder().encode(messageString),
    kp.secretKey
  );
  const walletSignature = Buffer.from(signatureBytes).toString("base64");
  const actResp = await fetch(`${API_BASE}/api/token/activate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ txSig, walletSignature, leagues: SELECTED_LEAGUES }),
  });
  const actText = (await actResp.text()).trim();
  if (!actResp.ok)
    throw new Error(`activate -> ${actResp.status}: ${actText.slice(0, 400)}`);
  let apiToken = actText;
  try {
    const j = JSON.parse(actText);
    apiToken = j.token ?? actText;
  } catch {
    /* plain text */
  }
  log(`activate ${actResp.status}; api token length ${apiToken.length}`);

  // Save secrets to gitignored .dev.vars (NEVER commit).
  writeFileSync(
    resolve(REPO_ROOT, ".dev.vars"),
    `TXLINE_API_BASE=${API_BASE}\nTXLINE_JWT=${jwt}\nTXLINE_API_TOKEN=${apiToken}\n`,
    "utf8"
  );
  log("wrote .dev.vars (gitignored)");

  const authHeaders = { Authorization: `Bearer ${jwt}`, "X-Api-Token": apiToken };

  log("\n=== STEP 6: fixtures snapshot + pick completed fixture ===");
  const fixtures = await jget(API_BASE, "/api/fixtures/snapshot", authHeaders);
  // Devnet feed uses PascalCase fields (FixtureId, StartTime, Participant1, ...).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const list: any[] = Array.isArray(fixtures) ? fixtures : (fixtures.fixtures ?? []);
  log("fixtures returned:", list.length);
  const now = Date.now();
  // "Completed" heuristic: kickoff is in the past (the devnet World-Cup feed reports
  // GameState only inside the score history, not on the snapshot row).
  const fid = (f: Record<string, unknown>): number =>
    Number(f.FixtureId ?? f.fixtureId ?? f.id);
  const startOf = (f: Record<string, unknown>): number =>
    Number(f.StartTime ?? f.startTime ?? 0);
  const past = list.filter((f) => startOf(f) > 0 && startOf(f) < now);
  past.sort((a, b) => startOf(a) - startOf(b));
  log(
    "past-kickoff fixtures:",
    past.map((f) => `${fid(f)} ${f.Participant1}v${f.Participant2}`)
  );

  // Optional override via env (fixtureId[:seq]).
  let forcedId: number | undefined;
  let forcedSeq: number | undefined;
  if (process.env.SPIKE_FIXTURE_ID) {
    const [a, b] = process.env.SPIKE_FIXTURE_ID.split(":");
    forcedId = Number(a);
    forcedSeq = b ? Number(b) : undefined;
  }

  const candidateIds: number[] = forcedId
    ? [forcedId]
    : [...past.map(fid), ...list.map(fid)];

  let chosen:
    | {
        fixtureId: number;
        seq: number;
        statKey: number;
        statValue: number;
        validation: StatValidation;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        history: any;
      }
    | undefined;

  const statKey = 1; // 1 = Participant1_Score

  for (const fixtureId of candidateIds) {
    if (!fixtureId) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let history: any;
    try {
      history = await jget(API_BASE, `/api/scores/historical/${fixtureId}`, authHeaders);
    } catch (e) {
      log(`  fixture ${fixtureId}: historical err ${(e as Error).message.slice(0, 120)}`);
      continue;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updates: any[] = Array.isArray(history)
      ? history
      : (history.updates ?? history.scores ?? []);
    // updates with a Seq and non-empty Stats
    const withStats = updates.filter(
      (u) =>
        (u.Seq ?? u.seq) != null &&
        u.Stats &&
        Object.keys(u.Stats).length > 0 &&
        u.Stats[String(statKey)] != null
    );
    if (!withStats.length) {
      log(`  fixture ${fixtureId}: ${updates.length} updates, none with Stats[${statKey}]`);
      continue;
    }
    // Prefer a forced seq, else the final update with stats. The terminal update has a
    // shallow sub-tree proof (fewer Merkle hashes), keeping the on-chain validate_stat
    // within the 1.4M compute-unit limit; deep mid-match seqs can exhaust it.
    const pick =
      (forcedSeq != null &&
        withStats.find((u) => Number(u.Seq ?? u.seq) === forcedSeq)) ||
      withStats[withStats.length - 1];
    const seq = Number(pick.Seq ?? pick.seq);
    log(
      `  fixture ${fixtureId}: ${updates.length} updates; trying seq ${seq} ` +
        `Stats[${statKey}]=${pick.Stats[String(statKey)]} (GameState ${pick.GameState}, Action ${pick.Action})`
    );
    let validation: StatValidation;
    try {
      validation = await jget(
        API_BASE,
        `/api/scores/stat-validation?fixtureId=${fixtureId}&seq=${seq}&statKey=${statKey}`,
        authHeaders
      );
    } catch (e) {
      log(`    stat-validation err: ${(e as Error).message.slice(0, 200)}`);
      continue;
    }
    if (!validation?.statToProve || !validation.mainTreeProof) {
      log(`    stat-validation returned no proof`);
      continue;
    }
    chosen = {
      fixtureId,
      seq,
      statKey,
      statValue: validation.statToProve.value,
      validation,
      history,
    };
    break;
  }

  if (!chosen) {
    throw new Error(
      "BLOCKER: no fixture with a usable score history + stat-validation proof was found in the devnet feed."
    );
  }

  const { fixtureId, seq, statValue, validation, history } = chosen;
  log(`\nchosen fixture ${fixtureId} seq ${seq} statKey ${statKey} value V=${statValue}`);

  log("\n=== STEP 7: stat-validation proof fetched ===");
  log("ts:", validation.ts);
  log("statToProve:", JSON.stringify(validation.statToProve));
  log(
    "proof depths -> statProof:",
    (validation.statProof ?? []).length,
    "subTreeProof:",
    (validation.subTreeProof ?? []).length,
    "mainTreeProof:",
    (validation.mainTreeProof ?? []).length
  );

  // The on-chain validate_stat uses the FIRST arg (ts) both to derive the
  // daily_scores_roots PDA seed AND to match the snapshot payload; the devnet program
  // keys batch roots by the batch's MIN timestamp (summary.updateStats.minTimestamp),
  // NOT the top-level validation.ts (which yields TimestampMismatch / error 6010).
  const targetTs = Number(validation.summary.updateStats.minTimestamp);
  const epochDay = Math.floor(targetTs / (24 * 60 * 60 * 1000));
  const [dailyScoresRootsPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("daily_scores_roots"), new BN(epochDay).toArrayLike(Buffer, "le", 2)],
    program.programId
  );
  log("epochDay:", epochDay, "daily_scores_roots PDA:", dailyScoresRootsPda.toBase58());
  const rootInfo = await connection.getAccountInfo(dailyScoresRootsPda);
  if (!rootInfo)
    throw new Error(
      `BLOCKER: daily_scores_roots account not found for epoch day ${epochDay} (${dailyScoresRootsPda.toBase58()})`
    );
  log("daily_scores_roots account found, len:", rootInfo.data.length);

  // Build the on-chain args
  const fixtureSummary = {
    fixtureId: new BN(validation.summary.fixtureId),
    updateStats: {
      updateCount: validation.summary.updateStats.updateCount,
      minTimestamp: new BN(validation.summary.updateStats.minTimestamp),
      maxTimestamp: new BN(validation.summary.updateStats.maxTimestamp),
    },
    eventsSubTreeRoot: toBytes(validation.summary.eventStatsSubTreeRoot),
  };
  const fixtureProof = toProof(validation.subTreeProof);
  const mainTreeProof = toProof(validation.mainTreeProof);
  const statTerm = {
    statToProve: {
      key: validation.statToProve.key,
      value: validation.statToProve.value,
      period: validation.statToProve.period,
    },
    eventStatRoot: toBytes(validation.eventStatRoot),
    statProof: toProof(validation.statProof),
  };

  const computeIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });

  // Read-only: validate_stat returns a bool via Solana return-data. `.view()` simulates
  // the ix and decodes the return value — no fee, no signature, no state change.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const runView = async (threshold: number, comparison: any): Promise<boolean> =>
    program.methods
      .validateStat(
        new BN(targetTs),
        fixtureSummary,
        fixtureProof,
        mainTreeProof,
        { threshold, comparison },
        statTerm,
        null,
        null
      )
      .accounts({ dailyScoresMerkleRoots: dailyScoresRootsPda })
      .preInstructions([computeIx])
      .view();

  log("\n=== STEP 8: validate_stat via .view() (TRUE + FALSE predicates) ===");
  const V = statValue;
  // TRUE: value >= V  <=>  value > V-1  (GreaterThan with threshold V-1)
  const verdictTrue = await runView(V - 1, { greaterThan: {} });
  log(`predicate [value > ${V - 1}] (i.e. value >= ${V}) -> ${verdictTrue}`);
  // FALSE: value >= V+1  <=>  value > V  (GreaterThan with threshold V)
  const verdictFalse = await runView(V, { greaterThan: {} });
  log(`predicate [value > ${V}] (i.e. value >= ${V + 1}) -> ${verdictFalse}`);

  if (verdictTrue !== true || verdictFalse !== false) {
    throw new Error(
      `Verdict mismatch: expected (true,false), got (${verdictTrue},${verdictFalse}). On-chain check did not discriminate as predicted.`
    );
  }
  log("On-chain verification DISCRIMINATES correctly: TRUE vs FALSE.");

  log("\n=== STEP 9: save real recorded fixture for deterministic replay ===");
  const outPath = resolve(
    REPO_ROOT,
    `packages/agent/src/fixtures/wc-real-${fixtureId}.json`
  );
  mkdirSync(dirname(outPath), { recursive: true });
  const record = {
    fixtureId,
    label: `World Cup (REAL devnet) — fixture ${fixtureId}`,
    source: "txline-dev.txodds.com /api/scores/historical + /api/scores/stat-validation",
    recordedAt: new Date().toISOString(),
    chosen: { seq, statKey, statValue: V },
    onchain: {
      programId: program.programId.toBase58(),
      epochDay,
      dailyScoresRootsPda: dailyScoresRootsPda.toBase58(),
      subscribeTxSig: txSig,
      subscribeExplorer: EXPLORER(txSig),
      verdicts: {
        truePredicate: { rule: `value > ${V - 1}`, result: verdictTrue },
        falsePredicate: { rule: `value > ${V}`, result: verdictFalse },
      },
    },
    history, // full score sequence (no secrets)
    statValidation: validation, // the three-stage Merkle proof (no secrets)
  };
  writeFileSync(outPath, JSON.stringify(record, null, 2), "utf8");
  log("wrote", outPath);

  log("\n=== DONE ===");
  log(JSON.stringify({ fixtureId, seq, statKey, V, txSig, verdictTrue, verdictFalse, epochDay }));
}

main().catch((e) => {
  console.error("\nSPIKE ERROR:", e);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const logs = (e as any)?.logs;
  if (logs) console.error("PROGRAM LOGS:\n" + logs.join("\n"));
  process.exit(1);
});
