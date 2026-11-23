import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPublicClient, createWalletClient, defineChain, http, keccak256, toHex, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createViemTokenGateway, MintRevertedError, type TokenGateway } from '../../src/chain/token-gateway.js';

const RPC = 'http://127.0.0.1:8545';
const here = path.dirname(fileURLToPath(import.meta.url));
const contractsDir = path.resolve(here, '../../../contracts');
// Hardhat's well-known public test accounts #0 and #1.
const ADMIN_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
const MINTER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;

const chain = defineChain({
  id: 31337,
  name: 'hardhat',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

let node: ChildProcess | undefined;
let gateway: TokenGateway;
let tokenAddress: `0x${string}`;
let adminWallet: any;
let abi: any;
const minter = privateKeyToAccount(MINTER_KEY);
const recipient = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as const;
const ref = (s: string) => keccak256(toHex(s));

async function waitForRpc(): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(RPC, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      });
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('hardhat node did not start in time');
}

beforeAll(async () => {
  node = spawn('npx hardhat node --port 8545', { cwd: contractsDir, shell: true, stdio: 'ignore' });
  await waitForRpc();

  const artifact = JSON.parse(
    readFileSync(path.join(contractsDir, 'artifacts/contracts/MumbucaPlus.sol/MumbucaPlus.json'), 'utf8'),
  );
  abi = artifact.abi;
  const admin = privateKeyToAccount(ADMIN_KEY);
  const pub = createPublicClient({ chain, transport: http(RPC) });
  adminWallet = createWalletClient({ account: admin, chain, transport: http(RPC) });

  const deployHash = await adminWallet.deployContract({
    abi,
    bytecode: artifact.bytecode,
    args: [admin.address, parseUnits('1000000', 18), parseUnits('1000', 18)],
  });
  const deployed = await pub.waitForTransactionReceipt({ hash: deployHash });
  tokenAddress = deployed.contractAddress!;

  const role: `0x${string}` = keccak256(toHex('MINTER_ROLE'));
  const grant = await adminWallet.writeContract({
    address: tokenAddress, abi, functionName: 'grantRole', args: [role, minter.address],
  });
  await pub.waitForTransactionReceipt({ hash: grant });

  gateway = createViemTokenGateway({ rpcUrl: RPC, chainId: 31337, tokenAddress, minterPrivateKey: MINTER_KEY });
});

afterAll(() => {
  if (!node?.pid) return;
  try {
    if (process.platform === 'win32') execSync(`taskkill /pid ${node.pid} /T /F`, { stdio: 'ignore' });
    else node.kill('SIGTERM');
  } catch {
    /* already gone */
  }
});

describe('TokenGateway against local hardhat node', () => {
  const amount = parseUnits('12.34', 18);

  it('sendMint then waitForReceipt yields success and balanceOf increases by amount', async () => {
    const before = await gateway.balanceOf(recipient);
    const hash = await gateway.sendMint(recipient, amount, ref('t1'));
    const receipt = await gateway.waitForReceipt(hash, 30_000);
    expect(receipt?.status).toBe('success');
    expect(await gateway.getReceipt(hash)).toMatchObject({ status: 'success' });
    expect((await gateway.balanceOf(recipient)) - before).toBe(amount);
    expect(await gateway.minterNativeBalance()).toBeGreaterThan(0n);
  });

  it('isPaymentRefUsed true after mint; findMintTx returns the same hash', async () => {
    const r = ref('t2');
    expect(await gateway.isPaymentRefUsed(r)).toBe(false);
    expect(await gateway.findMintTx(r)).toBeNull();
    const hash = await gateway.sendMint(recipient, amount, r);
    await gateway.waitForReceipt(hash, 30_000);
    expect(await gateway.isPaymentRefUsed(r)).toBe(true);
    const found = await gateway.findMintTx(r);
    expect(found?.txHash).toBe(hash);
    expect(found?.blockNumber).toBeGreaterThan(0n);
  });

  it('second sendMint with same ref throws MintRevertedError with reason PaymentRefAlreadyUsed', async () => {
    const r = ref('t3');
    const hash = await gateway.sendMint(recipient, amount, r);
    await gateway.waitForReceipt(hash, 30_000);
    const err = await gateway.sendMint(recipient, amount, r).catch((e) => e);
    expect(err).toBeInstanceOf(MintRevertedError);
    expect((err as MintRevertedError).reason).toBe('PaymentRefAlreadyUsed');
  });

  it('isPaused reflects pause()', async () => {
    expect(await gateway.isPaused()).toBe(false);
    const pub = createPublicClient({ chain, transport: http(RPC) });
    const h1 = await adminWallet.writeContract({ address: tokenAddress, abi, functionName: 'pause', chain });
    await pub.waitForTransactionReceipt({ hash: h1 });
    expect(await gateway.isPaused()).toBe(true);
    const err = await gateway.sendMint(recipient, amount, ref('t4')).catch((e) => e);
    expect(err).toBeInstanceOf(MintRevertedError);
    expect((err as MintRevertedError).reason).toBe('EnforcedPause');
    const h2 = await adminWallet.writeContract({ address: tokenAddress, abi, functionName: 'unpause', chain });
    await pub.waitForTransactionReceipt({ hash: h2 });
    expect(await gateway.isPaused()).toBe(false);
  });
});
