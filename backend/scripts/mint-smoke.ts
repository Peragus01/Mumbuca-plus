// Amoy smoke test: npm run smoke:mint -w backend -- <to> <cents>
// Requires a real .env (see Task 2/3). Mints <cents> (1 cent = 0.01 Mum+, 18 decimals).
import 'dotenv/config';
import { keccak256, toHex } from 'viem';
import { loadEnv } from '../src/config/env.js';
import { createViemTokenGateway } from '../src/chain/token-gateway.js';

const [to, cents] = process.argv.slice(2);
if (!to || !/^0x[0-9a-fA-F]{40}$/.test(to) || !cents || !/^\d+$/.test(cents)) {
  console.error('usage: npm run smoke:mint -w backend -- <0xAddress> <cents>');
  process.exit(1);
}

const env = loadEnv(process.env);
const gateway = createViemTokenGateway({
  rpcUrl: env.AMOY_RPC_URL,
  chainId: env.CHAIN_ID,
  tokenAddress: env.TOKEN_ADDRESS,
  minterPrivateKey: env.MINTER_PRIVATE_KEY,
  logsFromBlock: env.TOKEN_DEPLOY_BLOCK,
});

const amountWei = (BigInt(cents) * 10n ** 18n) / 100n;
const paymentRef = keccak256(toHex(`smoke:${Date.now()}`));
const hash = await gateway.sendMint(to as `0x${string}`, amountWei, paymentRef);
console.log(`sent: https://amoy.polygonscan.com/tx/${hash}`);
const receipt = await gateway.waitForReceipt(hash, env.MINT_RECEIPT_TIMEOUT_MS);
console.log(receipt ? `receipt: ${receipt.status} (block ${receipt.blockNumber})` : 'receipt: timed out, check PolygonScan');
