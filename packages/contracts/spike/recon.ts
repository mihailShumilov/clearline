/**
 * Phase-4 recon: guest auth on devnet host + read the on-chain pricing_matrix
 * to learn what the free World-Cup tier (service level 1) actually costs in TxL.
 * THROWAWAY SPIKE. Devnet only.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { readFileSync } from "node:fs";
import idl from "./txoracle.devnet.json";

const API_BASE = "https://txline-dev.txodds.com";
const KEYPAIR_PATH = process.env.SPIKE_KEYPAIR!;

function loadKeypair(path: string): Keypair {
  const secret = Uint8Array.from(JSON.parse(readFileSync(path, "utf8")));
  return Keypair.fromSecretKey(secret);
}

async function main() {
  const kp = loadKeypair(KEYPAIR_PATH);
  console.log("Wallet:", kp.publicKey.toBase58());

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const wallet = new anchor.Wallet(kp);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const program = new Program(idl as any, provider);
  console.log("Program ID:", program.programId.toBase58());

  // 1. Guest auth
  const authResp = await fetch(`${API_BASE}/auth/guest/start`, { method: "POST" });
  console.log("auth status:", authResp.status);
  const auth = (await authResp.json()) as { token: string };
  console.log("JWT length:", auth.token.length);

  // 2. Pricing matrix PDA + read
  const [pricingMatrixPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pricing_matrix")],
    program.programId
  );
  console.log("pricing_matrix PDA:", pricingMatrixPda.toBase58());

  const [tokenTreasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_treasury_v2")],
    program.programId
  );
  console.log("token_treasury_v2 PDA:", tokenTreasuryPda.toBase58());

  const mint = new PublicKey(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (idl as any).constants.find((c: any) => c.name === "TXLINE_MINT").value
  );
  const treasuryVault = getAssociatedTokenAddressSync(
    mint,
    tokenTreasuryPda,
    true,
    TOKEN_2022_PROGRAM_ID
  );
  console.log("TxL mint (devnet):", mint.toBase58());
  console.log("treasury vault ATA:", treasuryVault.toBase58());

  const info = await connection.getAccountInfo(pricingMatrixPda);
  if (!info) {
    console.log("pricing_matrix account NOT found on devnet");
    return;
  }
  console.log("pricing_matrix owner:", info.owner.toBase58(), "len:", info.data.length);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pm = await (program.account as any).pricingMatrix.fetch(pricingMatrixPda);
  console.log("pricing_matrix.admin:", pm.admin.toBase58());
  console.log("rows:");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const r of pm.rows as any[]) {
    console.log(
      `  rowId=${r.rowId} price_per_week_token=${r.pricePerWeekToken.toString()} ` +
        `sampling=${r.samplingIntervalSec} leagueBundle=${r.leagueBundleId} marketBundle=${r.marketBundleId}`
    );
  }

  // user TxL ATA (may not exist yet)
  const userAta = getAssociatedTokenAddressSync(
    mint,
    kp.publicKey,
    false,
    TOKEN_2022_PROGRAM_ID
  );
  console.log("user TxL ATA (derived):", userAta.toBase58());
  const userAtaInfo = await connection.getAccountInfo(userAta);
  console.log("user TxL ATA exists:", !!userAtaInfo);
}

main().catch((e) => {
  console.error("RECON ERROR:", e);
  process.exit(1);
});
