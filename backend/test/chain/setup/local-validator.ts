/**
 * Vitest globalSetup for `npm run test:chain`.
 *
 * Starts `solana-test-validator` inside WSL (Ubuntu) with the compiled program preloaded at its
 * program id, waits for the RPC on http://127.0.0.1:8899 (WSL2 localhost forwarding), funds an
 * admin/pauser and a minter keypair, runs `scripts/init-program.ts` (Task 13) against it and
 * shares the keys with the tests via `provide`. Teardown kills the validator.
 *
 * The program binary is NOT rebuilt here: it uses anchor/target/deploy/mumbuca_plus.so built in
 * Task 12. To rebuild after changing the program, run `anchor build` in WSL from `anchor/`.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import type { TestProject } from 'vitest/node';

export const PROGRAM_ID = 'HfFamsTJgSXssGkCgBqtNsDLD694peLYBbAzs4kuYzZm';
export const RPC_URL = 'http://127.0.0.1:8899';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';

declare module 'vitest' {
  export interface ProvidedContext {
    chainRpcUrl: string;
    chainProgramId: string;
    chainAdminSecret: number[];
    chainMinterSecret: number[];
  }
}

const backendDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const soPath = resolve(backendDir, '../anchor/target/deploy/mumbuca_plus.so');

/** C:\a\b -> /mnt/c/a/b */
function toWslPath(p: string): string {
  return p.replace(/^([A-Za-z]):/, (_m, d: string) => `/mnt/${d.toLowerCase()}`).replace(/\\/g, '/');
}

function killValidator(): void {
  spawnSync('wsl', ['-d', 'Ubuntu', '--', 'pkill', '-f', 'solana-test-validator'], { stdio: 'ignore' });
}

async function waitForRpc(conn: Connection, child: ChildProcess, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr = 'no response';
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`solana-test-validator exited early with code ${child.exitCode}`);
    try {
      const slot = await conn.getSlot('confirmed');
      if (slot > 0) return;
    } catch (e) {
      lastErr = (e as Error).message;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`local validator did not answer on ${RPC_URL} within ${timeoutMs}ms: ${lastErr}`);
}

async function airdrop(conn: Connection, to: PublicKey, sol: number): Promise<void> {
  const sig = await conn.requestAirdrop(to, sol * LAMPORTS_PER_SOL);
  const bh = await conn.getLatestBlockhash('confirmed');
  await conn.confirmTransaction({ signature: sig, ...bh }, 'confirmed');
}

export default async function setup(project: TestProject): Promise<() => void> {
  if (!existsSync(soPath)) throw new Error(`program binary missing: ${soPath} (run \`anchor build\` in WSL)`);

  killValidator(); // a stale validator would hold port 8899
  const cmd = [
    'export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH";',
    'exec solana-test-validator --reset --quiet --ledger ~/mumbuca-test-ledger',
    `--bpf-program ${PROGRAM_ID} '${toWslPath(soPath)}'`,
  ].join(' ');
  const child = spawn('wsl', ['-d', 'Ubuntu', '--', 'bash', '-lc', cmd], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));

  const teardown = () => {
    killValidator();
    if (child.exitCode === null) child.kill();
  };

  const tmp = mkdtempSync(join(tmpdir(), 'mumbuca-chain-'));
  try {
    const conn = new Connection(RPC_URL, 'confirmed');
    try {
      await waitForRpc(conn, child, 90_000);
    } catch (e) {
      throw new Error(`${(e as Error).message}${stderr ? `\nvalidator stderr:\n${stderr}` : ''}`);
    }

    for (const id of [TOKEN_2022, ATA_PROGRAM, PROGRAM_ID]) {
      const info = await conn.getAccountInfo(new PublicKey(id));
      if (!info?.executable) throw new Error(`program ${id} is not loaded in the local validator`);
    }

    const admin = Keypair.generate(); // also the pauser
    const minter = Keypair.generate();
    await airdrop(conn, admin.publicKey, 10);
    await airdrop(conn, minter.publicKey, 10);

    // Initialize through the real Task 13 script.
    const keyFile = join(tmp, 'admin.json');
    writeFileSync(keyFile, JSON.stringify([...admin.secretKey]));
    const res = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        'scripts/init-program.ts',
        '--admin-keypair',
        keyFile,
        '--minter',
        minter.publicKey.toBase58(),
        '--pauser',
        admin.publicKey.toBase58(),
      ],
      { cwd: backendDir, env: { ...process.env, SOLANA_RPC_URL: RPC_URL, PROGRAM_ID }, encoding: 'utf8' },
    );
    if (res.status !== 0) throw new Error(`init-program failed (exit ${res.status}):\n${res.stdout}\n${res.stderr}`);

    project.provide('chainRpcUrl', RPC_URL);
    project.provide('chainProgramId', PROGRAM_ID);
    project.provide('chainAdminSecret', [...admin.secretKey]);
    project.provide('chainMinterSecret', [...minter.secretKey]);
  } catch (e) {
    teardown();
    throw e;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return teardown;
}
