import { z } from 'zod';

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

const schema = z
  .object({
    DATABASE_URL: z.string().min(1),
    DATABASE_SSL: bool,
    PORT: intStr(3000),
    DEMO_PASSWORD: z.string().min(12),
    SESSION_SECRET: z.string().min(32),
    AMOY_RPC_URL: z.string().url(),
    CHAIN_ID: z.literal('80002').transform(() => 80002 as const),
    TOKEN_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'must be an 0x address') as z.ZodType<`0x${string}`>,
    MINTER_PRIVATE_KEY: z
      .string()
      .regex(/^0x[0-9a-fA-F]{64}$/, 'must be 0x + 64 hex chars') as z.ZodType<`0x${string}`>,
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
    MINT_RECEIPT_TIMEOUT_MS: intStr(60000),
    MAX_MINT_ATTEMPTS: intStr(5),
    LOW_POL_THRESHOLD_WEI: bigintStr('100000000000000000'),
  })
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
  });

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
