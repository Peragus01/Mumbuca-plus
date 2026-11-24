import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import {
  buildInitializeInstruction,
  configMatches,
  decodeConfigAccount,
  findConfigPda,
  findMintPda,
} from '../src/chain/program-client.js';

const CAP = 1_000_000_000n;
const MAX_MINT_PER_TX = 2_000_000n;

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    'admin-keypair': { type: 'string' },
    minter: { type: 'string' },
    pauser: { type: 'string' },
    uri: { type: 'string', default: '' },
    verify: { type: 'boolean', default: false },
  },
});

const rpcUrl = process.env.SOLANA_RPC_URL;
const programIdStr = process.env.PROGRAM_ID;
if (!rpcUrl) fail('SOLANA_RPC_URL is not set');
if (!programIdStr) fail('PROGRAM_ID is not set');
if (!values['admin-keypair'] || !values.minter || !values.pauser) {
  fail('usage: init:program -- --admin-keypair <path> --minter <pubkey> --pauser <pubkey> [--uri <url>] [--verify]');
}

const programId = new PublicKey(programIdStr);
const minter = new PublicKey(values.minter);
const pauser = new PublicKey(values.pauser);
let admin: Keypair;
try {
  admin = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(values['admin-keypair'], 'utf8')) as number[]),
  );
} catch {
  fail('could not read the admin keypair: expected a JSON array of bytes at the given path');
}

const connection = new Connection(rpcUrl, 'confirmed');
const ix = buildInitializeInstruction(programId, admin.publicKey, {
  cap: CAP,
  maxMintPerTx: MAX_MINT_PER_TX,
  minter,
  pauser,
  uri: values.uri ?? '',
});
let sig = '(verify only, no transaction sent)';
let sendFailed = false;
if (!values.verify) {
  try {
    sig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [admin]);
  } catch {
    // Do not print the error: it may contain the RPC URL.
    sendFailed = true;
    console.error(
      'initialize falhou; rode com --verify para inspecionar a config; se admin/minter forem diferentes, reimplante com um novo program id',
    );
  }
}

const [config] = findConfigPda(programId);
const [mint] = findMintPda(programId);
let info: Awaited<ReturnType<Connection['getAccountInfo']>>;
try {
  info = await connection.getAccountInfo(config, 'confirmed');
} catch {
  // Do not print the error: it may contain the RPC URL.
  fail('could not read the config account (RPC unavailable or rate limited); try again in a moment');
}
if (!info) fail('config account not found (initialize did not succeed)');
let cfg: ReturnType<typeof decodeConfigAccount>;
try {
  cfg = decodeConfigAccount(info.data);
} catch {
  fail('the account at the config PDA is not a Mumbuca+ Config (wrong PROGRAM_ID?)');
}

const cluster = rpcUrl.includes('devnet') ? '?cluster=devnet' : '';
if (!sendFailed) console.log('initialize signature:', sig);
console.log('config PDA:', config.toBase58());
console.log('mint PDA:  ', mint.toBase58());
console.log('config.admin: ', cfg.admin.toBase58());
console.log('config.minter:', cfg.minter.toBase58());
console.log('config.pauser:', cfg.pauser.toBase58());
if (!values.verify && !sendFailed) console.log(`explorer (tx):   https://explorer.solana.com/tx/${sig}${cluster}`);
console.log(`explorer (mint): https://explorer.solana.com/address/${mint.toBase58()}${cluster}`);

// Front-running check: initialize is permissionless until first called, so confirm we own the config.
if (!configMatches(cfg, { admin: admin.publicKey, minter, pauser })) {
  fail('ATTENTION: config does not match the expected admin/minter/pauser. Someone else may have initialized this program id. Redeploy with a new program id.');
}
console.log('OK: config.admin/minter/pauser match the expected values.');
if (sendFailed) process.exit(1);
