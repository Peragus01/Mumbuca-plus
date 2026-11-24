// Sandbox probe for the BRL -> BRS corridor: npm run probe:ozav -w backend
// Requires a real .env with a sandbox key (PROVIDER_ENV=sandbox, OZAV_API_KEY=ozav_sk_test_...).
// Prints statuses only; never prints the API key.
import 'dotenv/config';
import { loadEnv } from '../src/config/env.js';
import { createOzavClient } from '../src/providers/ozav/ozav-client.js';

const env = loadEnv(process.env);
if (env.PROVIDER_ENV !== 'sandbox') {
  console.error('probe only runs with PROVIDER_ENV=sandbox');
  process.exit(1);
}
const client = createOzavClient({ baseUrl: env.OZAV_BASE_URL, apiKey: env.OZAV_API_KEY });
const runId = `probe-${Date.now()}`;

const quote = await client.post(
  '/quotes',
  {
    customer_id: env.OZAV_CUSTOMER_ID,
    source: { currency: 'BRL', amount: '1000.00' },
    target: { currency: env.OZAV_TARGET_CURRENCY, chain: env.OZAV_TARGET_CHAIN },
    source_rail: 'pix',
    spread_bps: 0,
  },
  `${runId}:quote`,
);
console.log(`quote: HTTP ${quote.status}`);
const quoteBody = quote.body as { id?: string; error?: { code?: string; message?: string } } | null;
if (quote.status < 200 || quote.status >= 300 || !quoteBody?.id) {
  console.log(`quote refused: ${quoteBody?.error?.code ?? 'no error code'} ${quoteBody?.error?.message ?? ''}`);
  console.log('Corridor not available: record this in docs/providers/ozav.md and use the SIMULADO provider.');
  process.exit(2);
}

const transfer = await client.post(
  '/transfers',
  {
    customer_id: env.OZAV_CUSTOMER_ID,
    quote_id: quoteBody.id,
    source: { type: 'fiat_payment', currency: 'BRL', rail: 'pix' },
    destination: { type: 'wallet', wallet_id: env.OZAV_WALLET_ID, chain: env.OZAV_TARGET_CHAIN },
    metadata: { mumbuca_payment_id: runId },
  },
  runId,
);
const tBody = transfer.body as { id?: string; status?: string } | null;
console.log(`transfer: HTTP ${transfer.status} status=${tBody?.status ?? '?'}`);
if (transfer.status !== 201 || !tBody?.id) process.exit(2);

const sim = await client.post(`/transfers/${encodeURIComponent(tBody.id)}/simulate`, {});
console.log(`simulate: HTTP ${sim.status}`);
const after = await client.get(`/transfers/${encodeURIComponent(tBody.id)}`);
console.log(`transfer after simulate: HTTP ${after.status} status=${(after.body as { status?: string } | null)?.status ?? '?'}`);
