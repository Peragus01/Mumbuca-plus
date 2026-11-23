import { z } from 'zod';
import { Keypair, PublicKey } from '@solana/web3.js';
import { base58 } from '@scure/base';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((v) => v === 'true' || v === '1');

const intStr = (def: number) =>
  z
    .string()
    .regex(/^\d+$/, 'must be a non-negative integer')
    .default(String(def))
    .transform((v) => Number(v));

const bigintStr = (def?: string) => {
  const base = z.string().regex(/^\d+$/, 'must be a non-negative integer');
  return (def === undefined ? base : base.default(def)).transform((v) => BigInt(v));
};

function isPubkey(v: string): boolean {
  try {
    return base58.decode(v).length === 32 && new PublicKey(v).toBase58() === v;
  } catch {
    return false;
  }
}

/** Decodes a JSON-array or base58 secret key; returns null (never throws, never echoes input) if invalid. */
function decodeSecretKey(raw: string): Uint8Array | null {
  try {
    let bytes: Uint8Array;
    if (raw.trim().startsWith('[')) {
      const arr: unknown = JSON.parse(raw);
      if (!Array.isArray(arr) || arr.length !== 64) return null;
      if (!arr.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) return null;
      bytes = Uint8Array.from(arr as number[]);
    } else {
      bytes = base58.decode(raw.trim());
    }
    if (bytes.length !== 64) return null;
    Keypair.fromSecretKey(bytes); // throws if the public half does not match the seed
    return bytes;
  } catch {
    return null;
  }
}

const base = z.object({
    DATABASE_URL: z.string().min(1),
    DATABASE_SSL: bool,
    PORT: intStr(3000),
    DEMO_PASSWORD: z.string().min(12),
    SESSION_SECRET: z.string().min(32),
    SOLANA_RPC_URL: z.string().url(),
    SOLANA_CLUSTER: z.enum(['devnet', 'localnet']).default('devnet'),
    PROGRAM_ID: z.string().refine(isPubkey, 'must be a valid base58 Solana public key'),
    MINTER_SECRET_KEY: z.string().transform((raw, ctx) => {
      const bytes = decodeSecretKey(raw);
      if (!bytes) {
        ctx.addIssue({
          code: 'custom',
          message: 'must be a JSON array of 64 bytes or a base58-encoded 64-byte ed25519 secret key (value not shown)',
        });
        return z.NEVER;
      }
      return bytes;
    }),
    PROVIDER_ENV: z.enum(['sandbox', 'live']),
    OZAV_BASE_URL: z.string().url().default('https://developers.ozav.io/v2'),
    OZAV_API_KEY: z.string().min(1),
    OZAV_CUSTOMER_ID: z.string().min(1),
    OZAV_WALLET_ID: z.string().min(1),
    OZAV_WEBHOOK_SECRET: z.string().min(1).optional(),
    OZAV_TARGET_CURRENCY: z.literal('BRS').default('BRS'),
    OZAV_TARGET_CHAIN: z.string().min(1).default('solana'),
    MIN_RECHARGE_CENTS: bigintStr(),
    MAX_RECHARGE_CENTS: bigintStr(),
    RECONCILE_INTERVAL_MS: intStr(5000),
    MINT_CONFIRM_TIMEOUT_MS: intStr(60000),
    MAX_MINT_ATTEMPTS: intStr(5),
    LOW_SOL_THRESHOLD_LAMPORTS: bigintStr('100000000'),
  });

export const ENV_KEYS: readonly string[] = Object.keys(base.shape);

const schema = base
  .superRefine((env, ctx) => {
    const prefix = env.PROVIDER_ENV === 'live' ? 'ozav_sk_live_' : 'ozav_sk_test_';
    if (!env.OZAV_API_KEY.startsWith(prefix)) {
      ctx.addIssue({
        code: 'custom',
        path: ['OZAV_API_KEY'],
        message: `OZAV_API_KEY must start with "${prefix}" when PROVIDER_ENV=${env.PROVIDER_ENV}`,
      });
    }
    if (env.MIN_RECHARGE_CENTS > env.MAX_RECHARGE_CENTS) {
      ctx.addIssue({ code: 'custom', path: ['MIN_RECHARGE_CENTS'], message: 'must be <= MAX_RECHARGE_CENTS' });
    }
  })
  .transform(({ MINTER_SECRET_KEY, ...rest }) => ({ ...rest, minterSecretKey: MINTER_SECRET_KEY }));

export type Env = z.output<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv): Env {
  // Treat empty strings (as in a copied .env.example) as unset.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v !== ''));
  const result = schema.safeParse(cleaned);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join('.') || '(env)'}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return result.data;
}
