// Devnet smoke test for the token gateway: npm run smoke:mint -w backend -- <recipient-pubkey> <cents>
// Uses the real .env (SOLANA_RPC_URL, PROGRAM_ID, MINTER_SECRET_KEY, ...). Run only after the
// program is deployed and initialized on devnet. Never prints the RPC URL or the minter key.
import 'dotenv/config';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { keccak_256 } from '@noble/hashes/sha3';
import { loadEnv } from '../src/config/env.js';
import { MintRejectedError, TransientChainError, createSolanaTokenGateway } from '../src/chain/token-gateway.js';

const [recipient, centsArg] = process.argv.slice(2);
if (!recipient || !centsArg || !/^\d+$/.test(centsArg)) {
  console.error('usage: smoke:mint -- <recipient-pubkey> <cents>');
  process.exit(1);
}

const env = loadEnv(process.env);
const gw = createSolanaTokenGateway({
  rpcUrl: env.SOLANA_RPC_URL,
  programId: env.PROGRAM_ID,
  minterSecretKey: env.minterSecretKey,
  commitment: 'confirmed',
});
const cluster = env.SOLANA_CLUSTER === 'devnet' ? '?cluster=devnet' : '';
const ref = `0x${bytesToHex(keccak_256(utf8ToBytes(`smoke:${Date.now()}`)))}` as const;

try {
  console.log('minter SOL (lamports):', (await gw.minterNativeBalance()).toString());
  console.log('balance before:', (await gw.balanceOf(recipient)).toString());
  const { signature, lastValidBlockHeight } = await gw.sendMint(recipient, BigInt(centsArg), ref);
  console.log('payment ref:', ref);
  console.log(`tx: https://explorer.solana.com/tx/${signature}${cluster}`);
  const res = await gw.waitForConfirmation(signature, lastValidBlockHeight, env.MINT_CONFIRM_TIMEOUT_MS);
  console.log('result:', res === null || res === 'expired' ? res ?? 'timeout' : `${res.status} at slot ${res.slot}${res.reason ? ` (${res.reason})` : ''}`);
  console.log('receipt exists:', await gw.isPaymentRefUsed(ref));
  console.log('balance after:', (await gw.balanceOf(recipient)).toString());
} catch (e) {
  if (e instanceof MintRejectedError || e instanceof TransientChainError) {
    console.error(`${e.name}: ${e.message}`);
  } else {
    console.error('smoke failed:', e instanceof Error ? e.name : 'unknown error');
  }
  process.exit(1);
}
