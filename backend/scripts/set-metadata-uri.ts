import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { buildSetMetadataUriInstruction, MAX_METADATA_URI_BYTES } from '../src/chain/program-client.js';

/**
 * Points the Mum+ TokenMetadata `uri` at the public JSON with the logo (admin only).
 * Usage: npm run set:metadata-uri -w backend -- --admin-keypair <path> --uri <url>
 * Needs SOLANA_RPC_URL and PROGRAM_ID (from backend/.env).
 */
function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    'admin-keypair': { type: 'string' },
    uri: { type: 'string' },
  },
});

const rpcUrl = process.env.SOLANA_RPC_URL;
const programIdStr = process.env.PROGRAM_ID;
if (!rpcUrl) fail('SOLANA_RPC_URL is not set');
if (!programIdStr) fail('PROGRAM_ID is not set');
if (!values['admin-keypair'] || !values.uri) {
  fail('usage: set:metadata-uri -- --admin-keypair <path> --uri <https://.../mum.json>');
}
if (!/^https:\/\//.test(values.uri)) fail('the uri must start with https://');
if (Buffer.byteLength(values.uri, 'utf8') > MAX_METADATA_URI_BYTES) {
  fail(`the uri must be at most ${MAX_METADATA_URI_BYTES} bytes`);
}

let admin: Keypair;
try {
  admin = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(values['admin-keypair'], 'utf8')) as number[]),
  );
} catch {
  fail('could not read the admin keypair: expected a JSON array of bytes at the given path');
}

const programId = new PublicKey(programIdStr);
const connection = new Connection(rpcUrl, 'confirmed');
const ix = buildSetMetadataUriInstruction(programId, admin.publicKey, values.uri);
try {
  const sig = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [admin]);
  console.log(`metadata uri set to ${values.uri}`);
  console.log(`signature: ${sig}`);
} catch (e) {
  fail(`set_metadata_uri failed: ${(e as Error).message}`);
}
