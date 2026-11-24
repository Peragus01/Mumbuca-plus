// Devnet smoke test for the token gateway: npm run smoke:mint -w backend -- <recipient-pubkey> <cents> [payment-ref]
// payment-ref (0x + 64 hex) is optional: by default a fresh one is generated. Re-running with the
// ref printed by a previous run proves the on-chain dedup (PaymentRefAlreadyUsed, receipt PDA).
// Uses the real .env (SOLANA_RPC_URL, PROGRAM_ID, MINTER_SECRET_KEY, ...). Run only after the
// program is deployed and initialized on devnet. Never prints the RPC URL or the minter key.
import 'dotenv/config';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { keccak_256 } from '@noble/hashes/sha3';
import { loadEnv } from '../src/config/env.js';
import { receiptPda } from '../src/chain/pdas.js';
import { MintRejectedError, TransientChainError, createSolanaTokenGateway } from '../src/chain/token-gateway.js';

const [recipient, centsArg, refArg] = process.argv.slice(2);
if (!recipient || !centsArg || !/^\d+$/.test(centsArg) || (refArg !== undefined && !/^0x[0-9a-fA-F]{64}$/.test(refArg))) {
  console.error('usage: smoke:mint -- <recipient-pubkey> <cents> [payment-ref 0x<64 hex>]');
  process.exit(1);
}

const env = loadEnv(process.env);
const gw = createSolanaTokenGateway({
  rpcUrl: env.SOLANA_RPC_URL,
  programId: env.PROGRAM_ID,
  minterSecretKey: env.minterSecretKey,
  commitment: 'confirmed',
  rpcTimeoutMs: env.RPC_TIMEOUT_MS,
});
const cluster = env.SOLANA_CLUSTER === 'devnet' ? '?cluster=devnet' : '';
const ref = (refArg?.toLowerCase() ?? `0x${bytesToHex(keccak_256(utf8ToBytes(`smoke:${Date.now()}`)))}`) as `0x${string}`;

try {
  console.log('minter SOL (lamports):', (await gw.minterNativeBalance()).toString());
  console.log('balance before:', (await gw.balanceOf(recipient)).toString());
  console.log('payment ref:', ref);
  console.log(`receipt PDA: https://explorer.solana.com/address/${receiptPda(env.PROGRAM_ID, ref).toBase58()}${cluster}`);
  const { signature, lastValidBlockHeight } = await gw.sendMint(recipient, BigInt(centsArg), ref);
  console.log(`tx: https://explorer.solana.com/tx/${signature}${cluster}`);
  const res = await gw.waitForConfirmation(signature, lastValidBlockHeight, env.MINT_CONFIRM_TIMEOUT_MS);
  console.log('result:', res === null || res === 'expired' ? res ?? 'timeout' : `${res.status} at slot ${res.slot}${res.reason ? ` (${res.reason})` : ''}`);
  console.log('receipt exists:', await gw.isPaymentRefUsed(ref));
  console.log('balance after:', (await gw.balanceOf(recipient)).toString());
} catch (e) {
  if (e instanceof MintRejectedError && e.reason === 'PaymentRefAlreadyUsed') {
    console.error('MintRejectedError: PaymentRefAlreadyUsed (expected when re-using a ref: the receipt PDA already exists)');
  } else if (e instanceof MintRejectedError || e instanceof TransientChainError) {
    console.error(`${e.name}: ${e.message}`);
  } else {
    console.error('smoke failed:', e instanceof Error ? e.name : 'unknown error');
  }
  process.exit(1);
}
