import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import {
  buildInitializeInstruction,
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
const admin = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(values['admin-keypair'], 'utf8')) as number[]),
);

const connection = new Connection(rpcUrl, 'confirmed');
const ix = buildInitializeInstruction(programId, admin.publicKey, {
  cap: CAP,
  maxMintPerTx: MAX_MINT_PER_TX,
  minter,
  pauser,
  uri: values.uri ?? '',
});
const sig = values.verify
  ? '(verify only, no transaction sent)'
  : await sendAndConfirmTransaction(connection, new Transaction().add(ix), [admin]);

const [config] = findConfigPda(programId);
const [mint] = findMintPda(programId);
const info = await connection.getAccountInfo(config, 'confirmed');
if (!info) fail('config account not found after initialize');
const cfg = decodeConfigAccount(info.data);

const cluster = rpcUrl.includes('devnet') ? '?cluster=devnet' : '';
console.log('initialize signature:', sig);
console.log('config PDA:', config.toBase58());
console.log('mint PDA:  ', mint.toBase58());
console.log('config.admin: ', cfg.admin.toBase58());
console.log('config.minter:', cfg.minter.toBase58());
console.log('config.pauser:', cfg.pauser.toBase58());
if (!values.verify) console.log(`explorer (tx):   https://explorer.solana.com/tx/${sig}${cluster}`);
console.log(`explorer (mint): https://explorer.solana.com/address/${mint.toBase58()}${cluster}`);

// Front-running check: initialize is permissionless until first called, so confirm we own the config.
if (!cfg.admin.equals(admin.publicKey) || !cfg.minter.equals(minter) || !cfg.pauser.equals(pauser)) {
  fail('ATTENTION: config does not match the expected admin/minter/pauser. Someone else may have initialized this program id. Redeploy with a new program id.');
}
console.log('OK: config.admin/minter/pauser match the expected values.');
