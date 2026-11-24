import { Keypair } from '@solana/web3.js';

export const validMinter = Keypair.generate();

export const validEnv = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  DEMO_PASSWORD: 'demo-password-123',
  SESSION_SECRET: 's'.repeat(32),
  SOLANA_RPC_URL: 'https://api.devnet.solana.com',
  PROGRAM_ID: Keypair.generate().publicKey.toBase58(),
  MINTER_SECRET_KEY: JSON.stringify(Array.from(validMinter.secretKey)),
  PROVIDER_ENV: 'sandbox',
  OZAV_API_KEY: 'ozav_sk_test_abc',
  OZAV_CUSTOMER_ID: 'cus_1',
  OZAV_WALLET_ID: 'wal_1',
  MIN_RECHARGE_CENTS: '1100',
  MAX_RECHARGE_CENTS: '2000000',
} as NodeJS.ProcessEnv;
