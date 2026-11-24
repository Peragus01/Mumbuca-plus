// Pause / unpause the Mumbuca+ program with the pauser keypair (contingency tooling).
//   npm run pause:program   -w backend -- --pauser-keypair <path>
//   npm run unpause:program -w backend -- --pauser-keypair <path>
// Reads SOLANA_RPC_URL and PROGRAM_ID from the environment. Never prints keys or the RPC URL.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { buildPauserInstruction, decodeConfigAccount, findConfigPda } from '../src/chain/program-client.js';
import { timeoutFetch } from '../src/chain/token-gateway.js';

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    'pauser-keypair': { type: 'string' },
    pause: { type: 'boolean', default: false },
    unpause: { type: 'boolean', default: false },
  },
});

const rpcUrl = process.env.SOLANA_RPC_URL;
const programIdStr = process.env.PROGRAM_ID;
if (!rpcUrl) fail('SOLANA_RPC_URL is not set');
if (!programIdStr) fail('PROGRAM_ID is not set');
if (values.pause === values.unpause || !values['pauser-keypair']) {
  fail('usage: pause:program | unpause:program -- --pauser-keypair <path>   (exactly one of --pause / --unpause)');
}
const action: 'pause' | 'unpause' = values.pause ? 'pause' : 'unpause';

let programId: PublicKey;
try {
  programId = new PublicKey(programIdStr);
} catch {
  fail('PROGRAM_ID is not a valid public key');
}
let pauser: Keypair;
try {
  pauser = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(values['pauser-keypair'], 'utf8')) as number[]));
} catch {
  fail('could not read the pauser keypair: expected a JSON array of bytes at the given path');
}

const connection = new Connection(rpcUrl, { commitment: 'confirmed', fetch: timeoutFetch(30_000) });
const [config] = findConfigPda(programId);
const cluster = rpcUrl.includes('devnet') ? '?cluster=devnet' : '';

let sig: string;
try {
  sig = await sendAndConfirmTransaction(connection, new Transaction().add(buildPauserInstruction(programId, pauser.publicKey, action)), [
    pauser,
  ]);
} catch {
  // Do not print the error: it may contain the RPC URL.
  fail(`${action} failed: check that the keypair is config.pauser and has SOL for the fee (run init:program --verify)`);
}
console.log(`${action} signature: ${sig}`);
console.log(`explorer (tx): https://explorer.solana.com/tx/${sig}${cluster}`);

try {
  const info = await connection.getAccountInfo(config, 'confirmed');
  if (!info) fail('config account not found');
  console.log('config.paused:', decodeConfigAccount(info.data).paused);
} catch {
  fail('could not read the config account after the transaction (RPC unavailable); check the operator panel');
}
