# Mumbuca+ MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Revisão 2 (pivô Solana).** As Tasks 1, 2 e 5 (EVM) foram concluídas e depois **substituídas** pelas Tasks 12, 13 e 15 (Solana/Anchor). A Task 14 adapta à Solana o código das Tasks 3 e 4. As Tasks 7–11 foram reescritas para Solana. **Ordem de execução restante:** 12 → 13 → 14 → 15 → 7 → 8 → 9 → 10 → 11.

**Goal:** Quando a OZAV confirma a liquidação do BRL de uma recarga Pix, o backend executa automaticamente o DvP: emite Mumbuca+ (1 Mum+ = R$ 1,00) na carteira Solana (devnet) do usuário por meio de um programa Anchor, sem emissão duplicada, com dashboard de cidadã e de operador.

**Architecture:** Um repositório com:
- `anchor/`: workspace Anchor 1.2 com o programa `mumbuca_plus` e testes em Rust rodando no WSL. O deploy é manual, pelo dono, com a Anchor CLI no WSL.
- `backend/`: Fastify + Postgres, com processador in-process (máquina de estados) e reconciler.
- `frontend/`: React + Vite, servido como estático pelo backend.

Os provedores de pagamento ficam atrás da interface `PaymentProvider`. A emissão passa pelo `TokenGateway` (`@solana/web3.js`) e é idempotente em três camadas: o banco, a checagem da PDA de recibo antes de reenviar e o `init` da PDA `PaymentReceipt` no programa.

**Tech Stack:**
- Backend: Node 22, TypeScript 5.9, Fastify 5, zod 4, pg 8, PGlite (testes), vitest.
- Solana: `@solana/web3.js` 1.x e `@solana/spl-token` (Token-2022).
- Programa: Rust 1.99 + Anchor 1.2.0 e solana-cli 4.1.2 (no WSL Ubuntu).
- Frontend: React 19 + Vite, qrcode.react.
- Deploy: Railway.

**Spec:** `docs/superpowers/specs/2026-11-23-mumbuca-plus-mvp-design.md` (revisão 2). Leia antes de qualquer tarefa.

## Global Constraints

- Rede: **Solana devnet**. Explorer: `https://explorer.solana.com/tx/<assinatura>?cluster=devnet`. Os testes locais usam `solana-test-validator` no WSL.
- Token: Token-2022, name `Mumbuca+`, symbol `Mum+`, **2 decimais** (1 unidade = R$ 0,01), supply inicial 0, cap `1_000_000_000` unidades (10.000.000 Mum+), `max_mint_per_tx` inicial `2_000_000` unidades (20.000 Mum+).
- 1 Mum+ = R$ 1,00. Dinheiro sempre em **centavos inteiros** (`bigint`), com `amountUnits = cents`. Nunca usar `number` em ponto flutuante para valores.
- `paymentRef = keccak256(utf8("<provider>:<providerPaymentId>"))`: 32 bytes, guardados como hex `0x…` no banco e passados como `[u8; 32]` ao programa.
- PDAs do programa: `["config"]`, `["mint"]` e `["receipt", payment_ref]`.
- Estados de pagamento: `AWAITING_PAYMENT | RECEIVED | VALIDATING | APPROVED | MINT_PENDING | MINTED | FAILED`.
- Mínimo/máximo de recarga:
  - OZAV usa `MIN_RECHARGE_CENTS`/`MAX_RECHARGE_CENTS` do ambiente (live: `1100`/`2000000`; sandbox: `100000`/`1000000`);
  - `simulated` usa `1100`/`2000000`.
- A keypair do minter fica só no env do backend (`MINTER_SECRET_KEY`). Nunca no frontend, nunca commitada. `.env` fica no `.gitignore`.
- O backend recusa subir se o prefixo de `OZAV_API_KEY` não bater com `PROVIDER_ENV` (`sandbox` → `ozav_sk_test_`, `live` → `ozav_sk_live_`).
- O corredor OZAV é **somente BRL→BRS** (`OZAV_TARGET_CURRENCY` literal `BRS`). Nenhum outro ativo.
- O backend **nunca** emite com base no corpo de um webhook. Sempre consulta o provedor (`fetchPayment`).
- Transferências OZAV sem `metadata.mumbuca_payment_id` são ignoradas, porque a conta é compartilhada com a Peragus.
- Sem aviso fixo de "ambiente de teste" na UI. A origem (`OZAV live` / `OZAV sandbox` / `SIMULADO`) aparece só na visão do operador.
- Nenhuma alteração no repositório `PeragusSVM`.
- Testes primeiro (TDD) em toda tarefa com código.
- Comandos Solana/Anchor/Rust rodam no WSL: `wsl -d Ubuntu -- bash -lc '…'`. Binários: `~/.cargo/bin` e `~/.local/share/solana/install/active_release/bin`. Pode ser preciso exportar o PATH no comando.

## Review Focus

1. **Webhook de transferência da Peragus (sem `mumbuca_payment_id`):** responde 200 e não cria nem altera nenhum pagamento. Teste na Task 9.
2. **Reinício do servidor com pagamento em `MINT_PENDING`/`APPROVED`:** no boot, o reconciler retoma e termina sem emitir de novo, inclusive quando o blockhash da transação gravada já expirou. Teste na Task 8.
3. **Duplo clique em "Simular pagamento" ou "Reprocessar":** no máximo um mint por pagamento. Teste na Task 7.
4. **Valor OZAV com mais de 2 casas decimais (ex.: `"11.005"`) ou formato inválido:** os centavos são truncados, nunca arredondados para cima. Formato inválido vira `needs_review`, nunca mint. Teste nas Tasks 3 e 6.
5. **Carteira emissora sem SOL:** o pagamento fica em `APPROVED` com `last_error`, o operador vê o alerta de saldo baixo e nada vai a `FAILED`. Teste na Task 7.

---

## File Structure

```
MumbucaPlus/
  package.json                 workspaces: backend, frontend; scripts build/start/test
  .gitignore  .nvmrc(22)  README.md  README.en.md
  anchor/                      workspace Anchor 1.2 (fora dos workspaces npm)
    Anchor.toml  Cargo.toml  rust-toolchain.toml
    programs/mumbuca_plus/src/lib.rs (+ módulos state.rs, errors.rs, instructions/*.rs)
    programs/mumbuca_plus/tests/*.rs   testes Rust (LiteSVM ou harness compatível)
    target/idl/mumbuca_plus.json       gerado; cópia versionada em backend/src/chain/idl/
  backend/
    package.json  tsconfig.json  vitest.config.ts  vitest.chain.config.ts  .env.example
    migrations/001_init.sql
    src/config/env.ts                 parse e valida env (zod)
    src/db/db.ts                      tipo Db + pool pg + migrate()
    src/domain/money.ts               centavos, unidades, paymentRef, parse decimal
    src/domain/payment.ts             tipos Payment, PaymentStatus, limites
    src/domain/solana-address.ts      validação de chave pública base58
    src/repositories/user-repository.ts
    src/repositories/payment-repository.ts
    src/chain/idl/mumbuca_plus.json   IDL versionado
    src/chain/pdas.ts                 derivação de PDAs config/mint/receipt
    src/chain/token-gateway.ts        interface + implementação Solana
    src/providers/…                   (Task 6, já pronto)
    src/processing/payment-processor.ts
    src/processing/reconciler.ts
    src/http/app.ts  src/http/auth.ts  src/http/routes/*.ts
    src/main.ts
    scripts/init-program.ts           inicializa config + mint (dono)
    scripts/mint-smoke.ts             emissão de teste na devnet
    test/helpers/test-db.ts  test/**/*.test.ts
  frontend/  (como antes)
  docs/solana-deploy.md  docs/providers/ozav.md  docs/providers/mercadopago.md  docs/demo-runbook.md
```

## Task Dependencies

Concluídas: 1, 2, 5 (EVM, substituídas), 3, 4, 6. Restante: **12 → 13 → 14 → 15 → 7 → 8 → 9 → 10 → 11**.
- A Task 13 termina num checkpoint do dono (deploy na devnet), que não bloqueia as Tasks 14–15.
- O smoke na devnet (Task 15, passo final) espera esse deploy.

---

### Task 1: Contrato `MumbucaPlus` (EVM) — SUBSTITUÍDA

Concluída na versão EVM e substituída pelo pivô Solana (revisão 2). Ver Task 12. Não executar.

---

### Task 2: Tutorial de deploy no Remix (EVM) — SUBSTITUÍDA

Concluída na versão EVM e substituída pelo pivô Solana (revisão 2). Ver Task 13. Não executar.

---

### Task 3: Esqueleto do backend, config, banco e domínio de dinheiro

> Concluída. As partes específicas de EVM (env de rede, `centsToWei`, colunas `mint_amount_wei`/`tx_hash`/`block_number`, validação de endereço EVM) são adaptadas pela **Task 14**.

**Files:**
- Create: `backend/package.json`, `backend/tsconfig.json`, `backend/vitest.config.ts`, `backend/.env.example`
- Create: `backend/src/config/env.ts`, `backend/src/db/db.ts`, `backend/migrations/001_init.sql`, `backend/src/domain/money.ts`, `backend/src/domain/payment.ts`
- Test: `backend/test/helpers/test-db.ts`, `backend/test/domain/money.test.ts`, `backend/test/config/env.test.ts`, `backend/test/db/migrate.test.ts`

**Interfaces:**
- Produces:
  - `type Db = { query<T = any>(text: string, params?: unknown[]): Promise<{ rows: T[] }> }`; `createPgDb(url: string, ssl: boolean): Db & { end(): Promise<void> }`; `migrate(db: Db, dir: string): Promise<void>` (aplica `*.sql` em ordem, registra em `schema_migrations`).
  - `createTestDb(): Promise<Db>` (PGlite em memória + migrations).
  - `loadEnv(source: NodeJS.ProcessEnv): Env` — lança erro legível se inválido.
  - `parseBrlToCents(amount: string): { cents: bigint; truncated: boolean } | null` — aceita `^(0|[1-9]\d{0,14})(\.\d{1,6})?$`; trunca casas além de 2 (nunca arredonda para cima); `null` se formato inválido.
  - `centsToWei(cents: bigint): bigint`; `formatCentsBRL(cents: bigint): string` (`"R$ 1.000,00"`); `paymentRefFor(provider: ProviderName, providerPaymentId: string): \`0x${string}\``.
  - `type ProviderName = 'ozav' | 'simulated' | 'mercadopago'`; `type ProviderEnv = 'sandbox' | 'live' | 'local'`; `type PaymentStatus` (lista das Global Constraints); `OPEN_STATUSES`; `interface Payment` (campos camelCase da tabela abaixo); `rechargeLimits(provider: ProviderName, env: Env): { minCents: bigint; maxCents: bigint }`.

`Env` (zod): `DATABASE_URL`, `DATABASE_SSL` (bool, default false), `PORT` (default 3000), `DEMO_PASSWORD` (min 12), `SESSION_SECRET` (min 32), `AMOY_RPC_URL`, `CHAIN_ID` (literal 80002), `TOKEN_ADDRESS` (endereço), `MINTER_PRIVATE_KEY` (0x + 64 hex), `PROVIDER_ENV` (`sandbox|live`), `OZAV_BASE_URL` (default `https://developers.ozav.io/v2`), `OZAV_API_KEY`, `OZAV_CUSTOMER_ID`, `OZAV_WALLET_ID`, `OZAV_WEBHOOK_SECRET` (opcional), `OZAV_TARGET_CURRENCY` (literal `BRS`, default `BRS`), `OZAV_TARGET_CHAIN` (default `solana`), `MIN_RECHARGE_CENTS`, `MAX_RECHARGE_CENTS`, `RECONCILE_INTERVAL_MS` (default 5000), `MINT_RECEIPT_TIMEOUT_MS` (default 60000), `MAX_MINT_ATTEMPTS` (default 5), `LOW_POL_THRESHOLD_WEI` (default `100000000000000000`).

Migration `001_init.sql`:
```sql
create table users (
  id uuid primary key, handle text not null unique, display_name text not null,
  wallet_address text not null unique, created_at timestamptz not null default now());
create table payments (
  id uuid primary key, user_id uuid not null references users(id),
  provider text not null, provider_env text not null, provider_payment_id text,
  requested_amount_cents bigint not null, received_amount_cents bigint,
  status text not null, pix_br_code text, pix_expires_at timestamptz,
  payment_ref text unique, mint_amount_wei text, tx_hash text, block_number bigint,
  needs_review boolean not null default false, amount_mismatch boolean not null default false,
  failure_reason text, last_error text, attempts int not null default 0,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (provider, provider_payment_id));
create table payment_events (
  id bigserial primary key, payment_id uuid references payments(id),
  kind text not null, from_status text, to_status text, provider_event_id text,
  detail jsonb, created_at timestamptz not null default now());
create unique index payment_events_provider_event on payment_events(provider_event_id) where provider_event_id is not null;
create table simulated_charges (
  id text primary key, amount_cents bigint not null, status text not null, created_at timestamptz not null default now());
```

- [ ] **Step 1: Scaffold** `backend/` (ESM, `"type":"module"`), deps: `fastify@^5`, `@fastify/cookie`, `@fastify/rate-limit`, `@fastify/static`, `zod@^4`, `pg@^8`, `viem@^2`, `dotenv`; dev: `typescript@^5.9`, `vitest`, `tsx`, `@electric-sql/pglite`, `@types/pg`, `@types/node`. Scripts: `dev`, `build`, `typecheck`, `test`, `start` (`node dist/main.js`). `.env.example` com todas as chaves de `Env` e valores vazios.
- [ ] **Step 2: Write failing tests**
  - `money.test.ts`: `parseBrlToCents("11") → {cents:1100n,truncated:false}`; `"1000.00" → 100000n`; `"11.005" → {cents:1100n,truncated:true}`; `"0.01" → 1n`; `"-1"`, `"1e3"`, `"11,00"`, `""`, `"01"` → `null`; `centsToWei(1100n) === 11n * 10n**18n`; `paymentRefFor('ozav','ozav_tr_1') === keccak256(toBytes('ozav:ozav_tr_1'))`; `formatCentsBRL(100000n) === "R$ 1.000,00"`.
  - `env.test.ts`: env válido carrega; `PROVIDER_ENV=live` com chave `ozav_sk_test_x` lança erro contendo `OZAV_API_KEY`; `sandbox` com `ozav_sk_live_x` lança; `CHAIN_ID=137` lança; `MINTER_PRIVATE_KEY` curta lança.
  - `migrate.test.ts`: `createTestDb()` cria as 5 tabelas; rodar `migrate` duas vezes não falha.
  - `payment.test.ts` (em `test/domain/`): `rechargeLimits('simulated', env)` = `{1100n, 2000000n}`; `rechargeLimits('ozav', env)` usa os valores do env.
- [ ] **Step 3: Run** `npm test -w backend` — Expected: FAIL.
- [ ] **Step 4: Implement** os arquivos listados com as assinaturas acima (`keccak256`/`toBytes` de viem).
- [ ] **Step 5: Run** `npm test -w backend && npm run typecheck -w backend` — Expected: PASS.
- [ ] **Step 6: Commit** — `feat(backend): scaffold config, database schema and money domain`

---

### Task 4: Repositórios de usuários e pagamentos (transições condicionais)

> Concluída. As partes específicas de EVM (env de rede, `centsToWei`, colunas `mint_amount_wei`/`tx_hash`/`block_number`, validação de endereço EVM) são adaptadas pela **Task 14**.

**Files:**
- Create: `backend/src/repositories/user-repository.ts`, `backend/src/repositories/payment-repository.ts`
- Test: `backend/test/repositories/user-repository.test.ts`, `backend/test/repositories/payment-repository.test.ts`

**Interfaces:**
- Consumes: `Db`, `Payment`, `PaymentStatus`, `ProviderName`, `ProviderEnv` (Task 3).
- Produces:
  - `UserRepository`: `create({handle, displayName, walletAddress}): Promise<User>` (valida e normaliza checksum com `getAddress`; erro `InvalidWalletAddress`/`DuplicateUser`), `findById(id): Promise<User|null>`, `list(): Promise<User[]>`. `User = {id, handle, displayName, walletAddress, createdAt}`.
  - `PaymentRepository`:
    - `create({userId, provider, providerEnv, requestedAmountCents}): Promise<Payment>` — status `AWAITING_PAYMENT`, `id = randomUUID()`.
    - `attachCharge(id, {providerPaymentId, pixBrCode, pixExpiresAt}): Promise<Payment>`
    - `findById(id)`, `findByProviderPaymentId(provider, providerPaymentId)`, `listByUser(userId)`, `listAll()`, `listOpen()` (status em `RECEIVED|VALIDATING|APPROVED|MINT_PENDING` e também `AWAITING_PAYMENT` com `provider_payment_id` não nulo) — ordem `created_at desc`.
    - `transition(id: string, from: PaymentStatus[], to: PaymentStatus, patch?: PaymentPatch, detail?: object): Promise<Payment | null>` — `update … where id=$1 and status = any($2) returning *`; se atualizou, insere `payment_events(kind='transition', from_status, to_status, detail)`; `null` se o estado atual não está em `from`.
    - `patch(id, patch: PaymentPatch): Promise<Payment>` — campos não-estado (`lastError`, `attempts`, `needsReview`, …) + evento `kind='note'`.
    - `recordProviderEvent({paymentId|null, providerEventId, detail}): Promise<boolean>` — `false` se `provider_event_id` já existe.
  - `PaymentPatch = Partial<Pick<Payment, 'receivedAmountCents'|'paymentRef'|'mintAmountWei'|'txHash'|'blockNumber'|'needsReview'|'amountMismatch'|'failureReason'|'lastError'|'attempts'>>`.

- [ ] **Step 1: Write failing tests** (com `createTestDb()`):
  - `create user normalizes wallet to checksum`; `rejects invalid address`; `rejects duplicate handle`.
  - `create payment starts AWAITING_PAYMENT`; `attachCharge stores pix fields`.
  - `transition moves only from allowed status and logs event` — `transition(id,['AWAITING_PAYMENT'],'RECEIVED')` retorna pagamento; segunda chamada idêntica retorna `null`; `payment_events` tem exatamente 1 linha `transition`.
  - `concurrent transitions: only one wins` — `Promise.all` de duas `transition(id,['RECEIVED'],'VALIDATING')` → exatamente um não-nulo.
  - `recordProviderEvent returns false on duplicate event id`.
  - `listOpen excludes MINTED, FAILED and AWAITING_PAYMENT without charge`.
  - `bigint cents round-trip` — `requestedAmountCents` volta como `bigint`.
- [ ] **Step 2: Run** `npm test -w backend -- repositories` — Expected: FAIL.
- [ ] **Step 3: Implement** os repositórios (mapeamento snake_case ↔ camelCase; `bigint` para colunas monetárias e `block_number`).
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(backend): add user and payment repositories with guarded transitions`

---

### Task 5: `TokenGateway` viem (EVM) — SUBSTITUÍDA

Concluída na versão EVM e substituída pelo pivô Solana (revisão 2). Ver Task 15. Não executar.

---

### Task 6: `PaymentProvider`, Simulated, Mercado Pago (stub) e OZAV

**Files:**
- Create: `backend/src/providers/payment-provider.ts`, `simulated-provider.ts`, `mercadopago-provider.ts`, `ozav/ozav-client.ts`, `ozav/ozav-signature.ts`, `ozav/ozav-provider.ts`
- Create: `docs/providers/ozav.md`, `docs/providers/mercadopago.md`
- Test: `backend/test/providers/simulated-provider.test.ts`, `ozav-signature.test.ts`, `ozav-provider.test.ts`

**Interfaces:**
- Consumes: `Db`, `parseBrlToCents`, `ProviderName`, `ProviderEnv` (Task 3).
- Produces:
```ts
type ProviderPaymentState =
  | { kind: 'pending' }
  | { kind: 'approved'; receivedAmountCents: bigint; truncated: boolean; metadataPaymentId: string | null }
  | { kind: 'rejected'; reason: string }          // failed / cancelled
  | { kind: 'expired' }
  | { kind: 'review'; reason: string };           // needs_review ou formato inesperado
type WebhookResult =
  | { ok: true; providerEventId: string; providerPaymentId: string; metadataPaymentId: string | null }
  | { ok: true; ignored: true; providerEventId: string }      // evento sem transferência (ex.: customer.updated)
  | { ok: false; reason: 'bad_signature' | 'stale' | 'malformed' };
interface PaymentProvider {
  readonly name: ProviderName;
  readonly env: ProviderEnv;
  createCharge(input: { paymentId: string; amountCents: bigint }): Promise<{ providerPaymentId: string; pixBrCode: string | null; expiresAt: Date | null }>;
  fetchPayment(providerPaymentId: string): Promise<ProviderPaymentState>;
  verifyWebhook?(rawBody: Buffer, headers: Record<string, string | undefined>, now: Date): WebhookResult;
  simulatePayment?(providerPaymentId: string): Promise<void>;
  findChargeByPaymentId?(paymentId: string): Promise<string | null>; // recuperação após POST incerto
}
class ProviderUnavailableError extends Error {}   // 5xx, timeout, rede → transitório
type ProviderRegistry = Record<ProviderName, PaymentProvider | undefined>;
```
- OZAV (adaptar de `feat/brs-purchase`: `app/backend/src/providers/ozav-client.ts`, `src/providers/ozav-brs.ts`, `src/webhooks/customer-event.ts`, `src/brs/brs-progression.ts`; contrato de campos em `docs/operations/brs-ozav-contract.md`):
  - `createOzavProvider({baseUrl, apiKey, customerId, walletId, targetCurrency, targetChain, env, webhookSecret?, fetchImpl?})`.
  - `createCharge`: `POST /quotes` (`customer_id`, `source{currency:"BRL",amount:"<reais com 2 casas>"}`, `target{currency, chain}`, `source_rail:"pix"`, `spread_bps:0`) → `POST /transfers` (`customer_id`, `quote_id`, `source{type:"fiat_payment",currency:"BRL",rail:"pix"}`, `destination{type:"wallet",wallet_id,chain}`, `metadata{mumbuca_payment_id}`), header `Idempotency-Key: <paymentId>` (quote: `<paymentId>:quote`). Resultado: `id`, `source.payment_instructions.br_code`, `expires_at`. Só `201` é sucesso; qualquer outro status → `ProviderUnavailableError` (o processador recupera por metadata — ver Task 7).
  - `findChargeByPaymentId(paymentId)` — `GET /transfers?customer_id=` paginado, filtra `metadata.mumbuca_payment_id`.
  - `fetchPayment`: `GET /transfers/{id}`; `PAID = {payment_confirmed, converting, payout_initiated, completed}`; aprovado se `status ∈ PAID` **ou** perna de origem `completed` (mesma leitura de `brs-progression.ts`); valor = `amounts.source.amount` com `amounts.source.currency === "BRL"` via `parseBrlToCents`; inválido → `review`; `failed|cancelled` → `rejected`; `expired` → `expired`; `awaiting_payment` → `pending`; `needs_review` ou desconhecido → `review`.
  - `verifyWebhook`: header `x-ozav-signature: t=<unix>,v1=<hex>`, HMAC-SHA256 com a chave `OZAV_WEBHOOK_SECRET` completa sobre `` `${t}.` + rawBody ``, `timingSafeEqual`, janela ±300 s; `x-ozav-event-id` igual ao `id` do envelope; eventos `transfer.updated|transfer.completed|transfer.failed` → id da transferência + `metadata.mumbuca_payment_id`; outros tipos → `ignored`.
  - `simulatePayment` (só se `env === 'sandbox'`): `POST /transfers/{id}/simulate`.
  - O cliente aceita `ozav_sk_test_` e `ozav_sk_live_` (remover a regex só-teste da Peragus).
- Simulated: `createSimulatedProvider(db)`; `createCharge` grava `simulated_charges(id='sim_'+paymentId, status='pending')`, `pixBrCode: null`; `simulatePayment` → `approved`; `fetchPayment` lê a tabela; `env='local'`.
- Mercado Pago: `createMercadoPagoProvider()` — todos os métodos lançam `Error('Mercado Pago não implementado neste MVP')`; `docs/providers/mercadopago.md` lista o que seria necessário (Checkout/Payments API, `x-signature`, consulta `GET /v1/payments/{id}`, `external_reference`) **com links da documentação oficial consultada no momento da escrita**.

- [ ] **Step 1: Write failing tests**
  - `simulated-provider.test.ts`: `createCharge then fetchPayment is pending`; `simulatePayment then approved with exact amount`; `simulatePayment twice is harmless`.
  - `ozav-signature.test.ts` (segredo `ozav_whsec_test`): `valid signature accepted`; `tampered body → bad_signature`; `t older than 300 s → stale`; `event id header mismatch → malformed`; `customer.updated → ignored`; `transfer.updated without metadata → ok with metadataPaymentId null`.
  - `ozav-provider.test.ts` (`fetchImpl` falso que registra chamadas):
    - `createCharge posts quote then transfer with Idempotency-Key and metadata.mumbuca_payment_id`, amount `"11.00"` para `1100n`, retorna `br_code` e `expires_at`.
    - `createCharge non-201 → ProviderUnavailableError`.
    - `fetchPayment payment_confirmed with amounts.source {"11.00","BRL"} → approved 1100n`.
    - `fetchPayment completed with amount "11.005" → approved 1100n truncated true`.
    - `fetchPayment amount "abc" → review`; `currency USD → review`.
    - `awaiting_payment → pending`; `expired → expired`; `cancelled → rejected`; `needs_review → review`.
    - `HTTP 503 or network error → ProviderUnavailableError`.
    - `simulatePayment throws when env is live`.
    - `factory rejects live key in sandbox env`.
- [ ] **Step 2: Run** `npm test -w backend -- providers` — Expected: FAIL.
- [ ] **Step 3: Implement** adaptando o código Peragus indicado; escrever `docs/providers/ozav.md` (env vars, corredores por ambiente, webhook, simulate, limitação `webhooks:write`).
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Sonda do corredor BRS no sandbox** — script `backend/scripts/ozav-brs-probe.ts` (`npm run probe:ozav -w backend`) com a chave sandbox: `POST /quotes` BRL→BRS de R$ 1.000 e, se aceito, `POST /transfers` + `simulate`, imprimindo os status. Expected: cotação aceita. Se a OZAV responder "indisponível para este corredor", registrar a resposta em `docs/providers/ozav.md`, avisar o dono e seguir com `SIMULADO` como caminho garantido da demo (não introduzir outro ativo).
- [ ] **Step 6: Commit** — `feat(backend): add payment provider interface with OZAV, simulated and Mercado Pago stub`

---

### Task 7: `PaymentProcessor` — máquina de estados e idempotência

**Files:**
- Create: `backend/src/processing/payment-processor.ts`
- Test: `backend/test/processing/payment-processor.test.ts`

**Interfaces:**
- Consumes:
  - `PaymentRepository` e `UserRepository` (Tasks 4/14);
  - `TokenGateway`, `TransientChainError` e `MintRejectedError` (Task 15);
  - `ProviderRegistry` e `ProviderUnavailableError` (Task 6);
  - `paymentRefFor`, `centsToUnits` e `rechargeLimits` (Tasks 3/14).
- Produces:
```ts
createPaymentProcessor(deps: { payments; users; providers: ProviderRegistry; token: TokenGateway; env: Env; log }): PaymentProcessor
interface PaymentProcessor {
  createRecharge(input: { userId: string; amountCents: bigint; provider: ProviderName }): Promise<Payment>;
  signal(paymentId: string, source: 'webhook' | 'reconciler' | 'operator'): Promise<void>;
  process(paymentId: string): Promise<Payment>;   // avança o máximo possível; serializado
  simulate(paymentId: string): Promise<Payment>;  // provider.simulatePayment + signal
  reprocess(paymentId: string): Promise<Payment>; // operador: limpa lastError e processa
}
class RechargeLimitError, UnknownUserError, ProviderNotEnabledError
```

Regras (spec §5.3–5.5):

**Serialização**
- Uma fila in-process (cadeia de promises) garante um `process` por vez no processo inteiro.
- Um `process` repetido para o mesmo id, enquanto outro está rodando, é unido ao mesmo promise.

**`signal`**
- `signal(id, 'reconciler')` em `AWAITING_PAYMENT` chama `fetchPayment` primeiro e só transiciona para `RECEIVED` se o resultado não for `pending`.
- `signal` vindo de webhook ou do operador transiciona direto.

**`createRecharge`**
1. Valida o usuário e `rechargeLimits`.
2. Cria o pagamento.
3. Chama `createCharge` e depois `attachCharge`.
4. Se `createCharge` lançar `ProviderUnavailableError` e o provedor tiver `findChargeByPaymentId`, tenta recuperar a cobrança antes de desistir. Nunca faz re-POST com outro id.
5. Se não houver transferência, o pagamento vai para `FAILED` com `failureReason='charge_creation_failed'` e o erro é propagado.

**`RECEIVED → VALIDATING → fetchPayment`**
- `pending` → volta a `AWAITING_PAYMENT`.
- `rejected` → `FAILED` (`provider_rejected:<reason>`).
- `expired` → `FAILED` (`pix_expired`).
- `review` → fica em `VALIDATING` com `needsReview=true` e `lastError=reason`. Não emite.
- `approved`, verificado nesta ordem:
  1. `metadataPaymentId` não nulo e diferente de `payment.id` → `FAILED` (`metadata_mismatch`).
  2. Recebido abaixo do mínimo → `FAILED` (`amount_below_minimum`).
  3. Usuário ou carteira inexistente → `FAILED` (`wallet_not_found`).
  4. Caso contrário → `APPROVED` com `receivedAmountCents`, `amountMismatch = received ≠ requested`, `paymentRef` e `mintAmountUnits = centsToUnits(received)`.
- `ProviderUnavailableError` → fica em `VALIDATING`, grava `lastError` e faz `attempts+1`.

**`APPROVED`**
1. `isPaymentRefUsed(ref)`. Se for true, chama `findMintTx(ref)` e vai para `MINTED` com `txSignature` e `slot`.
2. Senão, chama `sendMint(wallet, units, ref)`, que devolve `{signature, lastValidBlockHeight}`. Vai para `MINT_PENDING` gravando `txSignature` e `lastValidBlockHeight` **antes de aguardar**.
3. Chama `waitForConfirmation(signature, lastValidBlockHeight, MINT_CONFIRM_TIMEOUT_MS)`:
   - `{status:'confirmed'}` → `MINTED` com `slot`;
   - `{status:'failed'}` → trata como em "MINT_PENDING retomada";
   - `'expired'` → se `isPaymentRefUsed`, recupera e vai para `MINTED`; senão volta a `APPROVED`, porque o reenvio é seguro;
   - `null` (timeout) → fica em `MINT_PENDING`.

**Erros na emissão**
- `TransientChainError` (inclui falta de SOL e RPC fora) → fica em `APPROVED`, grava `lastError` e faz `attempts+1`.
- `MintRejectedError`:
  - `PaymentRefAlreadyUsed` → recupera via `findMintTx` e vai para `MINTED`;
  - `Paused` → fica em `APPROVED` com `lastError='token_paused'`;
  - outros motivos → `attempts+1`; depois de `MAX_MINT_ATTEMPTS`, vai para `FAILED` (`mint_rejected:<reason>`).

**`MINT_PENDING` (retomada)**
Chama `getSignatureStatus(txSignature)`:
- `confirmed` → `MINTED`.
- `failed` → se `isPaymentRefUsed`, recupera e vai para `MINTED`; senão volta a `APPROVED` com `attempts+1`.
- `null`:
  - se `isPaymentRefUsed`, recupera e vai para `MINTED`;
  - senão, se `isBlockhashExpired(lastValidBlockHeight)`, volta a `APPROVED`;
  - senão permanece.

- [ ] **Step 1: Write failing tests** (PGlite + `TokenGateway` falso em memória que imita o programa: conjunto de refs, contador de `sendMint`, altura de bloco simulada e modos de falha configuráveis; provedor falso configurável):
  - `approved payment mints received amount and ends MINTED with txSignature and slot`
  - `rejected payment ends FAILED and never calls sendMint`; `expired → FAILED pix_expired`
  - `pending provider status returns to AWAITING_PAYMENT`
  - `review keeps VALIDATING with needsReview and no mint`
  - `unknown wallet → FAILED wallet_not_found`
  - `metadata of another payment → FAILED metadata_mismatch`
  - `received below minimum → FAILED amount_below_minimum`
  - `received differs from requested → mints received, amountMismatch true`
  - `provider unavailable keeps VALIDATING and retries later to MINTED`
  - `RPC error on sendMint keeps APPROVED; retry mints exactly once`
  - `sendMint landed but response lost (fake records ref, then throws TransientChainError) → retry sees isPaymentRefUsed and marks MINTED without a second sendMint`
  - `confirmation timeout keeps MINT_PENDING; later process marks MINTED`
  - `blockhash expired without receipt → back to APPROVED and resend once`
  - `MintRejectedError PaymentRefAlreadyUsed recovers signature via findMintTx`
  - `paused program keeps APPROVED with lastError token_paused`
  - `insufficient SOL (TransientChainError) keeps APPROVED with lastError` (Review Focus 5)
  - `double simulate / double reprocess / concurrent signal+process → sendMint called once` (Review Focus 3)
  - `createRecharge rejects amount outside limits with RechargeLimitError` (ex.: simulated 1099n)
  - `createRecharge on OZAV unavailable recovers existing transfer by metadata`
- [ ] **Step 2: Run** `npm test -w backend -- processing`. Expected: FAIL.
- [ ] **Step 3: Implement** `createPaymentProcessor` conforme as regras. Nunca logar `err.cause` inteiro de erros de cadeia (a URL do RPC pode conter chave); logar só `message`/`reason`.
- [ ] **Step 4: Run**. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(backend): add payment processor state machine with layered idempotency`

---

### Task 8: Reconciler e retomada no boot

**Files:**
- Create: `backend/src/processing/reconciler.ts`
- Test: `backend/test/processing/reconciler.test.ts`

**Interfaces:**
- Consumes: `PaymentRepository.listOpen`, `PaymentProcessor.signal/process`, providers (Task 6/7).
- Produces: `createReconciler({ payments, processor, intervalMs, log }): { tick(): Promise<void>; start(): void; stop(): Promise<void> }`.
  - `tick`: para cada `listOpen()`: `AWAITING_PAYMENT` → `processor.signal(id,'reconciler')` (que consulta o provedor via `process`); demais estados → `processor.process(id)`. Erros de um pagamento não interrompem os outros. Não roda dois `tick` sobrepostos.
  - `start` faz um `tick` imediato (retomada no boot) e depois a cada `intervalMs`.

- [ ] **Step 1: Write failing tests**
  - `tick advances AWAITING_PAYMENT to MINTED once provider approves` (sem webhook)
  - `tick on still-pending payment writes no payment_events rows`
  - `pix expired at provider while AWAITING_PAYMENT → FAILED pix_expired, no mint`
  - `boot resume: payment left in MINT_PENDING with txSignature finishes MINTED without new sendMint` (Review Focus 2)
  - `boot resume: MINT_PENDING whose blockhash expired and no receipt → APPROVED → resent once → MINTED`
  - `boot resume: payment left in APPROVED after lost broadcast finishes MINTED with one mint total`
  - `one payment throwing does not stop others`
  - `overlapping ticks do not run concurrently` (tick lento + segundo tick → provedor consultado uma vez por pagamento)
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(backend): add reconciler loop with boot-time resume`

---

### Task 9: API HTTP, autenticação, webhook e wiring

**Files:**
- Create: `backend/src/http/app.ts`, `backend/src/http/auth.ts`, `backend/src/http/routes/webhooks.ts`, `payments.ts`, `users.ts`, `ops.ts`, `backend/src/main.ts`
- Test: `backend/test/http/auth.test.ts`, `webhooks.test.ts`, `payments.test.ts`, `users.test.ts`, `ops.test.ts`

**Interfaces:**
- Consumes: tudo das Tasks 3–8.
- Produces: `buildApp(deps: { env; payments; users; processor; providers; token; staticDir?: string }): FastifyInstance`. Contrato JSON consumido pela Task 10 (valores monetários como **string** de centavos/unidades/lamports; datas ISO):
  - `POST /api/login {password}` → 204 + cookie `mp_session` (assinado, `httpOnly`, `secure` fora de dev, `sameSite=lax`, 12 h); senha errada → 401; rate limit 10/min por IP. `POST /api/logout` → 204. `GET /api/session` → `{authenticated: boolean}`.
  - Tudo em `/api/*` (exceto login/session) exige sessão → 401.
  - `GET /api/users` → `User[]`; `POST /api/users {handle, displayName, walletAddress}` → 201 `User`; endereço inválido → 400; duplicado → 409.
  - `GET /api/users/:id/balance` → `{balanceUnits: string}` (via `token.balanceOf`).
  - `POST /api/payments {userId, amountCents: string, provider: 'ozav'|'simulated'}` → 201 `PaymentDTO`; limite → 422 `{error:'amount_out_of_range', minCents, maxCents}`; provedor desabilitado → 422.
  - `GET /api/payments?userId=` → `PaymentDTO[]`; `GET /api/payments/:id` → `PaymentDTO`.
  - `POST /api/payments/:id/simulate` → `PaymentDTO` (409 se o provedor não suporta, ex.: OZAV live).
  - `POST /api/payments/:id/reprocess` → `PaymentDTO`.
  - `GET /api/ops/status` → `{providerEnv, programId, mintAddress, cluster, paused, minterLamports: string, lowSol: boolean}`.
  - `POST /webhooks/payments` (sem sessão, corpo bruto): escolhe o provedor pelo header `x-ozav-signature` (ausente → 401); `ok:false` → 401; `ignored` ou `metadataPaymentId` nulo ou pagamento não encontrado → 200 `{ignored:true}` sem alterar nada; evento duplicado (`recordProviderEvent` false) → 200 `{duplicate:true}`; senão `processor.signal(id,'webhook')` **sem aguardar o mint** → 200.
  - `PaymentDTO = {id, userId, provider, providerEnv, origin: 'OZAV live'|'OZAV sandbox'|'SIMULADO', status, requestedAmountCents, receivedAmountCents|null, mintAmountUnits|null, pixBrCode|null, pixExpiresAt|null, txSignature|null, explorerUrl|null (`https://explorer.solana.com/tx/<sig>?cluster=<SOLANA_CLUSTER>`; `localnet` → `?cluster=custom`), slot|null, needsReview, amountMismatch, failureReason|null, lastError|null, createdAt, updatedAt}`.
  - `main.ts`: `loadEnv(process.env)`, cria pool + `migrate`, repositórios, `createSolanaTokenGateway` (com `MINTER_SECRET_KEY` decodificada), providers (`ozav` com env; `simulated`; `mercadopago` stub não registrado como habilitado), processor, reconciler (`start`), `buildApp` com `staticDir = ../frontend/dist` (fallback SPA para `index.html`), `listen({port, host:'0.0.0.0'})`; encerra reconciler e pool em `SIGTERM`.

- [ ] **Step 1: Write failing tests** (com `app.inject`, PGlite, fakes das Tasks 7 e 15):
  - `auth`: `login wrong password 401`; `login ok sets cookie and /api/users works`; `no cookie → 401 on /api/payments`; `11th login in a minute → 429`.
  - `webhooks`: `valid OZAV webhook for known payment → 200 and payment reaches RECEIVED or beyond`; `bad signature → 401 and nothing changes`; `same event twice → second returns duplicate:true and sendMint called once`; `transfer without mumbuca_payment_id → 200 ignored, payments table unchanged` (Review Focus 1); `metadata for unknown payment id → 200 ignored`; `missing signature header → 401`.
  - `payments`: `POST creates OZAV charge and returns pixBrCode and origin 'OZAV sandbox'`; `amount below min → 422 with minCents`; `simulated flow: create → simulate → GET shows MINTED with explorerUrl https://explorer.solana.com/tx/<sig>?cluster=devnet`; `amounts serialized as strings`.
  - `users`: `create, list, invalid address 400, duplicate 409`; `balance returns string units`; `invalid Solana address 400`.
  - `ops`: `lowSol true when minter balance below LOW_SOL_THRESHOLD_LAMPORTS`.
- [ ] **Step 2: Run** `npm test -w backend -- http` — Expected: FAIL.
- [ ] **Step 3: Implement** (rota de webhook com `addContentTypeParser('application/json', {parseAs:'buffer'})` no escopo dela).
- [ ] **Step 4: Run** `npm test -w backend && npm run typecheck -w backend` — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(backend): add authenticated API, payments webhook and server wiring`

---

### Task 10: Dashboard (cidadã + operador)

**Files:**
- Create: `frontend/package.json`, `vite.config.ts` (proxy `/api` e `/webhooks` → `localhost:3000` em dev), `index.html`, `src/main.tsx`, `src/App.tsx`, `src/api.ts`, `src/format.ts`, `src/pages/Login.tsx`, `src/pages/CitizenView.tsx`, `src/pages/OperatorView.tsx`, `src/components/RechargeDialog.tsx`, `src/components/StatusBadge.tsx`
- Test: `frontend/src/format.test.ts`, `frontend/src/components/StatusBadge.test.tsx`, `frontend/src/components/RechargeDialog.test.tsx`

**Interfaces:**
- Consumes: contrato HTTP e `PaymentDTO` da Task 9.
- Produces: build estático em `frontend/dist` servido pelo backend.
- Layout e textos: esboços da spec §7. Identidade "Mumbuca+", português, sem faixa de "ambiente de teste".
  - `format.ts`: `formatBRL(cents: string): string` (`"1100"` → `"R$ 11,00"`); `formatMum(units: string): string` (`"1100"` → `"11,00 Mum+"`, 2 decimais, via `BigInt`); `shortAddress(addr)` (base58: `7xKX…9fQa`, 4+4 caracteres); `statusLabel(status)`: `AWAITING_PAYMENT→"Aguardando Pix"`, `RECEIVED|VALIDATING→"Pagamento confirmado"` (VALIDATING mostra "Confirmando pagamento"), `APPROVED|MINT_PENDING→"Emitindo"`, `MINTED→"Emitido"`, `FAILED→"Falhou"`.
  - Cidadã: seletor de usuário, saldo (`/balance`), endereço com copiar, botão "Recarregar" → `RechargeDialog` (valor em reais, valida mín/máx retornado no 422, mostra QR `qrcode.react` + copia-e-cola do `pixBrCode`, faz polling de `GET /api/payments/:id` a cada 2 s até `MINTED|FAILED` mostrando a linha do tempo de status), histórico com link "ver na rede ↗" (`explorerUrl`).
  - Operador: tabela de todos os pagamentos com origem (badge `SIMULADO` destacado), valores solicitado/recebido, Mum+ emitidos, estado, assinatura/link, `failureReason`/`lastError`, ícone para `amountMismatch`/`needsReview`; botões "Simular pagamento" (visível quando origem é `OZAV sandbox` ou `SIMULADO` e status `AWAITING_PAYMENT`) e "Reprocessar" (status não terminal); formulário de cadastro de usuário de demonstração; painel `ops/status` com alerta de SOL baixo e programa pausado; seletor de provedor na recarga do operador (`ozav` | `simulated`).
- [ ] **Step 1: Scaffold** Vite React TS; deps `react@19`, `react-dom@19`, `qrcode.react`; dev `vitest`, `@testing-library/react`, `jsdom`.
- [ ] **Step 2: Write failing tests**: `formatBRL("100000") === "R$ 1.000,00"`; `formatMum("1100") === "11,00 Mum+"`; `formatMum("100000") === "1.000,00 Mum+"`; `formatMum("1") === "0,01 Mum+"`; `StatusBadge` renderiza "Emitido" para `MINTED` e "SIMULADO" quando `origin==='SIMULADO'`; `RechargeDialog` com resposta 422 mostra "Valor mínimo R$ 11,00"; com resposta 201 mostra o copia-e-cola e, após o fetch mockado retornar `MINTED`, mostra o link para o Solana Explorer.
- [ ] **Step 3: Run** `npm test -w frontend` — Expected: FAIL.
- [ ] **Step 4: Implement** páginas e componentes.
- [ ] **Step 5: Run** `npm test -w frontend && npm run build -w frontend` — Expected: PASS e `frontend/dist/index.html` existe.
- [ ] **Step 6: Verificação manual local** — backend com `PROVIDER_ENV=sandbox`, provedor `simulated`, gateway apontando para `solana-test-validator` no WSL com o programa carregado (como no teste de integração da Task 15): login → cadastrar usuário → recarga simulada R$ 50 → Simular → "Emitido" com link. Registrar print.
- [ ] **Step 7: Commit** — `feat(frontend): add citizen and operator dashboard`

---

### Task 11: Deploy no Railway, runbook e ensaio ponta a ponta

**Files:**
- Modify: `package.json` (raiz: `build` = build do frontend + backend; `start` = `npm run start -w backend`)
- Create: `docs/demo-runbook.md`
- Modify: `README.md` e `README.en.md` — só a seção 14 (substituir a frase "Instruções para rodar localmente…" por instruções reais de execução local e deploy) e o "Status" da seção 13; não alterar as demais seções.

**Interfaces:**
- Consumes: tudo.

- [ ] **Step 1: Build de produção local** — `npm ci && npm run build && npm start` com env de sandbox. Expected: `GET /api/session` responde e a SPA abre em `http://localhost:3000`.
- [ ] **Step 2: Railway (com o dono)** — projeto novo `mumbuca-plus`, serviço apontando para o novo repositório GitHub, plugin Postgres (`DATABASE_URL`, `DATABASE_SSL=true`), todas as variáveis de `.env.example` preenchidas pelo dono no painel (nunca no chat ou no git), build `npm ci && npm run build`, start `npm start`, domínio público gerado. Expected: URL HTTPS abre o login.
- [ ] **Step 3: Webhook OZAV (se `webhooks:write` disponível)** — registrar `https://<domínio>/webhooks/payments` e pôr o segredo em `OZAV_WEBHOOK_SECRET`. Se não disponível, anotar no runbook que o reconciler cobre.
- [ ] **Step 4: Ensaio sandbox** — recarga OZAV de R$ 1.000 → Simular → `MINTED`; abrir a transação no Solana Explorer (devnet); ver 1.000 Mum+ na Phantom (devnet). Clicar "Reprocessar" e confirmar que nenhuma nova tx aparece. Registrar a assinatura e a PDA de recibo.
- [ ] **Step 5: Ensaio simulado** — recarga `SIMULADO` de R$ 50 → `MINTED`.
- [ ] **Step 6: Ensaio live (se o dono fornecer chave live)** — trocar `PROVIDER_ENV=live`, chave/IDs live, `MIN_RECHARGE_CENTS=1100`; recarga de R$ 11 paga pelo dono via Pix → `MINTED` com 11 Mum+. Se falhar, registrar o motivo e manter sandbox como caminho principal.
- [ ] **Step 7: `docs/demo-runbook.md`** — checklist da véspera (SOL da minter > `LOW_SOL_THRESHOLD_LAMPORTS`, `config.minter` = pubkey da minter, programa não pausado, Phantom em devnet, chaves do ambiente certo, Railway no ar), roteiro da apresentação (spec §10), contingências (OZAV fora → `SIMULADO`; sem internet → vídeo), como gravar o vídeo de contingência.
- [ ] **Step 8: Commit** — `docs: add deployment and demo runbook`

---

### Task 12: Remover o código EVM e criar o programa Anchor `mumbuca_plus` com testes

**Files:**
- Delete: `contracts/` (inteiro) e `docs/remix-deploy.md`. Remover `"contracts"` dos workspaces do `package.json` raiz e do `package-lock.json` (`npm install` regenera).
- Create:
  - `anchor/Anchor.toml` (cluster `devnet`, `[programs.devnet]` e `[programs.localnet]` com o program id gerado);
  - `anchor/Cargo.toml` e `anchor/rust-toolchain.toml` (canal compatível com o rustc 1.99 instalado);
  - `anchor/programs/mumbuca_plus/Cargo.toml`;
  - `anchor/programs/mumbuca_plus/src/{lib.rs,state.rs,errors.rs,events.rs}` e `src/instructions/*.rs`;
  - `anchor/.gitignore` (`target/`, `test-ledger/`, `.anchor/`). **Nunca** commitar keypairs, exceto a keypair do programa em `target/deploy`, que também fica ignorada.
- Test: `anchor/programs/mumbuca_plus/tests/mumbuca_plus.rs`
- Modify: `.gitignore` raiz (`anchor/target`, `anchor/test-ledger`)

**Interfaces:**
- Produces (spec §5.1). Este é o IDL consumido pelas Tasks 13 e 15:
  - Contas:
    - `Config { admin: Pubkey, minter: Pubkey, pauser: Pubkey, mint: Pubkey, cap: u64, max_mint_per_tx: u64, total_minted: u64, paused: bool, bump: u8, mint_bump: u8 }`, PDA `["config"]`;
    - `PaymentReceipt { payment_ref: [u8;32], recipient: Pubkey, amount: u64, slot: u64, bump: u8 }`, PDA `["receipt", payment_ref]`.
  - Mint Token-2022, PDA `["mint"]`:
    - decimals 2; mint authority = PDA config; sem freeze authority;
    - extensões MetadataPointer (apontando para o próprio mint) + TokenMetadata com name `Mumbuca+`, symbol `Mum+` e `uri` do argumento.
  - Instruções:
    - `initialize(cap: u64, max_mint_per_tx: u64, minter: Pubkey, pauser: Pubkey, uri: String)`: o signatário vira `admin` e paga as contas;
    - `mint_for_payment(payment_ref: [u8;32], amount: u64)`: as validações e efeitos da spec §5.1, nesta ordem: checa signer == minter, `!paused`, `amount > 0`, `amount <= max_mint_per_tx`, `total_minted.checked_add(amount) <= cap`; depois `init` do receipt, `init_if_needed` da ATA Token-2022 do `recipient` (pago pelo minter), `mint_to` assinado pela PDA config, atualiza `total_minted` e `emit!(MintedForPayment { recipient, amount, payment_ref, slot })`;
    - `set_minter(new: Pubkey)` e `set_pauser(new: Pubkey)` (admin);
    - `set_max_mint_per_tx(v: u64)` (admin, `v > 0`);
    - `pause()` e `unpause()` (pauser).
  - Erros: `Unauthorized`, `Paused`, `InvalidAmount`, `ExceedsMaxPerTx`, `CapExceeded`, `MathOverflow`.
  - Evento: `MintedForPayment { recipient: Pubkey, amount: u64, payment_ref: [u8;32], slot: u64 }`.

- [ ] **Step 1: Scaffold** no WSL: `anchor init` (ou estrutura equivalente escrita à mão) em `anchor/`. Gerar o program id com `anchor keys sync`. Confirmar que `anchor build` compila um programa vazio. Remover o código EVM listado acima.
- [ ] **Step 2: Write failing tests** em Rust, rodando o `.so` compilado em LiteSVM ou no harness compatível com Anchor 1.2. O teste cria o admin, o minter, o pauser, a cidadã e um outro usuário, com airdrop.
  - `initialize_creates_config_and_token2022_mint_with_metadata`: decimals 2, name `Mumbuca+`, symbol `Mum+`, mint authority = PDA config, `total_minted == 0`.
  - `minter_mints_amount_creates_ata_and_receipt`: saldo da ATA == 1100 e receipt com recipient/amount/payment_ref corretos.
  - `same_payment_ref_fails_second_time`: saldo continua 1100.
  - `non_minter_gets_unauthorized`; `admin_without_minter_role_cannot_mint`.
  - `exceeds_max_per_tx_fails`; `zero_amount_fails_invalid_amount`; `cap_exceeded_fails` (ajuste `max_mint_per_tx` = cap para atingir o cap).
  - `pause_blocks_mint_but_transfer_still_works`; `unpause_restores_mint`; `non_pauser_cannot_pause`.
  - `set_minter_switches_minter_and_old_minter_is_unauthorized`.
  - `emits_minted_for_payment_event` (se o harness expuser logs/eventos).
- [ ] **Step 3: Run** `wsl -d Ubuntu -- bash -lc 'cd /mnt/c/Users/ferna/OneDrive/Desktop/MumbucaPlus/anchor && anchor build && cargo test'`. Expected: FAIL (instruções ausentes).
- [ ] **Step 4: Implement** o programa. Use os tipos `anchor_spl::token_interface` e as constraints de extensão do Anchor para o mint Token-2022 com metadata. Se a criação da metadata via constraint não for suportada no 1.2, faça CPI explícita para `token_metadata_initialize`, dimensionando o rent da conta.
- [ ] **Step 5: Run**. Expected: PASS. Copiar o IDL gerado (`anchor/target/idl/mumbuca_plus.json`) para `backend/src/chain/idl/mumbuca_plus.json`, que é o arquivo versionado.
- [ ] **Step 6: Commit**: `feat(anchor): add mumbuca_plus program with on-chain payment receipts and remove EVM contract`

---

### Task 13: Tutorial de deploy na devnet e script de inicialização

**Files:**
- Create: `docs/solana-deploy.md` (português), `backend/scripts/init-program.ts`, script npm `init:program` no backend.
- Test: `backend/test/chain/init-program.integration.test.ts` (roda com `test:chain`, contra o validador local da Task 15; pode ficar `todo` até a Task 15 existir. Se ficar, registre isso no relatório).

**Interfaces:**
- Consumes: IDL da Task 12 e PDAs (`["config"]`, `["mint"]`).
- Produces: `npm run init:program -w backend -- --admin-keypair <caminho> --minter <pubkey> --pauser <pubkey> [--uri <url>]`. Usa `SOLANA_RPC_URL` e `PROGRAM_ID` do env e chama `initialize` com cap `1000000000` e `max_mint_per_tx` `2000000`. Imprime as PDAs config e mint e o link do explorer. Nunca imprime chaves privadas.

- [ ] **Step 1: Escrever o tutorial** com valores exatos:
  1. Abrir o WSL; conferir `solana --version`, `anchor --version` e `solana config set --url devnet`.
  2. Conferir a keypair CLI do dono (`solana address`), que é o admin/pauser. Obter SOL de devnet (`solana airdrop 2` ou o faucet oficial https://faucet.solana.com).
  3. Gerar a keypair do minter **fora do repositório** (`solana-keygen new -o ~/mumbuca-minter.json`), anotar a pubkey e mandar 1 SOL para ela. O conteúdo da keypair vai só para `MINTER_SECRET_KEY` (`.env`/Railway).
  4. `cd anchor && anchor build && anchor deploy --provider.cluster devnet`. Anotar o `PROGRAM_ID`.
  5. Rodar `init:program` com admin = keypair CLI e minter = pubkey do passo 3.
  6. Teste manual: emitir 1 Mum+ (`100` unidades) para a Phantom do dono com `npm run smoke:mint` (Task 15). Ver o token na Phantom (devnet) e a transação no Solana Explorer. Repetir o mesmo ref e ver a falha.
  7. Opcional: `anchor build --verifiable` e verificação pública do programa.
  8. Conferir a PDA de recibo de um pagamento no explorador. Esse é o argumento visual do DvP e da dedup on-chain.
- [ ] **Step 2: Implementar `init-program.ts`** (`@solana/web3.js` + IDL; sem dependência de rede nos testes unitários).
- [ ] **Step 3: Revisar o tutorial contra o IDL**: todos os nomes de instrução e conta existem.
- [ ] **Step 4: Commit**: `docs: add Solana devnet deployment guide and program init script`
- [ ] **Step 5: Checkpoint do dono**: o dono implanta e informa `PROGRAM_ID`. Isso não bloqueia as Tasks 14–15.

---

### Task 14: Adaptar o domínio do backend à Solana

**Files:**
- Modify:
  - `backend/src/config/env.ts`, `backend/.env.example`;
  - `backend/src/domain/money.ts`, `backend/src/domain/payment.ts`;
  - `backend/migrations/001_init.sql` (editado no lugar: nada foi implantado ainda);
  - `backend/src/repositories/user-repository.ts`, `backend/src/repositories/payment-repository.ts`.
- Create: `backend/src/domain/solana-address.ts`
- Delete: `backend/src/chain/token-abi.ts`, `backend/src/chain/token-gateway.ts` (viem), `backend/scripts/mint-smoke.ts` (EVM), `backend/test/chain/*` (EVM) e a dependência `viem`, **exceto** o uso de `keccak256`/`toBytes`. Escolha: manter `viem` só para hash, ou trocar por `@noble/hashes` `keccak_256` com o mesmo resultado. O teste existente de `paymentRefFor` deve continuar passando com o mesmo valor.
- Test: atualizar `backend/test/config/env.test.ts`, `test/domain/*.test.ts` e `test/repositories/*.test.ts`; criar `test/domain/solana-address.test.ts`.

**Interfaces:**
- Produces:
  - `Env`:
    - remove `AMOY_RPC_URL`, `CHAIN_ID`, `TOKEN_ADDRESS`, `MINTER_PRIVATE_KEY`, `TOKEN_DEPLOY_BLOCK`, `LOW_POL_THRESHOLD_WEI` e `MINT_RECEIPT_TIMEOUT_MS`;
    - adiciona `SOLANA_RPC_URL` (url), `SOLANA_CLUSTER` (`devnet|localnet`, default `devnet`), `PROGRAM_ID` (pubkey base58 válida), `MINTER_SECRET_KEY` (array JSON de 64 números **ou** base58 de 64 bytes; validar o formato sem nunca ecoar o valor), `LOW_SOL_THRESHOLD_LAMPORTS` (default `100000000`) e `MINT_CONFIRM_TIMEOUT_MS` (default 60000).
  - `money.ts`: remove `centsToWei`; adiciona `centsToUnits(cents: bigint): bigint` (identidade, 2 decimais) e `formatUnitsMum(units: bigint): string` (`1100n` → `"11,00 Mum+"`).
  - `solana-address.ts`: `parseSolanaAddress(input: string): string | null`. Aceita base58 que decodifica em exatamente 32 bytes e devolve a forma canônica `new PublicKey(x).toBase58()`.
  - Schema `payments`:
    - `mint_amount_wei` → `mint_amount_units`; `tx_hash` → `tx_signature`; `block_number` → `slot` (bigint);
    - nova coluna `last_valid_block_height bigint`.
  - `Payment` e `PaymentPatch` ganham os campos camelCase correspondentes: `mintAmountUnits`, `txSignature`, `slot`, `lastValidBlockHeight`.
  - `UserRepository.create` valida a carteira com `parseSolanaAddress`. Endereço inválido continua sendo `InvalidWalletAddress`.

- [ ] **Step 1: Write failing tests**:
  - env aceita `MINTER_SECRET_KEY` nos dois formatos e rejeita 63 bytes, com a mensagem sem o valor;
  - `SOLANA_CLUSTER=mainnet` é rejeitado;
  - `parseSolanaAddress` aceita uma pubkey válida e rejeita `"0x8f3…"`, base58 curto e string vazia;
  - `centsToUnits(1100n) === 1100n`; `formatUnitsMum(1100n) === "11,00 Mum+"`; `formatUnitsMum(100000n) === "1.000,00 Mum+"`;
  - os repositórios gravam e leem `txSignature`, `slot` e `lastValidBlockHeight` como `bigint`;
  - cadastro de usuário com endereço Solana válido normaliza; com endereço EVM, lança `InvalidWalletAddress`.
- [ ] **Step 2: Run** `npm test -w backend`. Expected: FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** `npm test -w backend && npm run typecheck -w backend`. Expected: PASS. Nenhum arquivo do backend importa mais `token-gateway`/`viem` para cadeia.
- [ ] **Step 5: Commit**: `refactor(backend): adapt domain, env and schema to Solana`

---

### Task 15: `TokenGateway` Solana e integração com validador local

**Files:**
- Create:
  - `backend/src/chain/pdas.ts`, `backend/src/chain/token-gateway.ts`;
  - `backend/scripts/mint-smoke.ts`, script npm `smoke:mint`;
  - `backend/vitest.chain.config.ts` (reescrito);
  - script npm `test:chain`.
- Test: `backend/test/chain/token-gateway.integration.test.ts`, `backend/test/chain/error-classification.test.ts`

**Interfaces:**
- Consumes: IDL versionado (Task 12) e `Env` (Task 14).
- Produces:
```ts
configPda(programId): PublicKey; mintPda(programId): PublicKey; receiptPda(programId, paymentRef: `0x${string}`): PublicKey
interface TokenGateway {
  sendMint(recipient: string, amountUnits: bigint, paymentRef: `0x${string}`): Promise<{ signature: string; lastValidBlockHeight: bigint }>;
  getSignatureStatus(signature: string): Promise<{ status: 'confirmed' | 'failed'; slot: bigint; reason?: string } | null>;
  waitForConfirmation(signature: string, lastValidBlockHeight: bigint, timeoutMs: number): Promise<{ status: 'confirmed' | 'failed'; slot: bigint; reason?: string } | 'expired' | null>;
  isBlockhashExpired(lastValidBlockHeight: bigint): Promise<boolean>;
  isPaymentRefUsed(paymentRef: `0x${string}`): Promise<boolean>;            // receipt PDA existe
  findMintTx(paymentRef: `0x${string}`): Promise<{ signature: string; slot: bigint } | null>; // 1ª assinatura da receipt PDA (getSignaturesForAddress, a mais antiga)
  balanceOf(owner: string): Promise<bigint>;                                  // unidades da ATA Token-2022; 0n se não existir
  minterNativeBalance(): Promise<bigint>;                                     // lamports
  isPaused(): Promise<boolean>;
}
class TransientChainError extends Error {}
class MintRejectedError extends Error { reason: 'Unauthorized'|'Paused'|'InvalidAmount'|'ExceedsMaxPerTx'|'CapExceeded'|'MathOverflow'|'PaymentRefAlreadyUsed'|'UnknownProgramError' }
createSolanaTokenGateway(opts: { rpcUrl: string; programId: string; minterSecretKey: Uint8Array; commitment?: 'confirmed' }): TokenGateway
```

**Regras:**
- `sendMint` monta a instrução pelo IDL e **simula antes de enviar** (`simulateTransaction`):
  - erro customizado do programa → `MintRejectedError(nome)`;
  - falha de "conta já existe" na criação do receipt → `MintRejectedError('PaymentRefAlreadyUsed')`;
  - erro do programa não identificado → `MintRejectedError('UnknownProgramError')`.
- Saldo insuficiente, RPC fora, timeout e blockhash não encontrado → `TransientChainError`.
- Depois da simulação: `sendRawTransaction` com `skipPreflight: true` e devolve `signature` + `lastValidBlockHeight` do blockhash usado. Um erro no envio é `TransientChainError` (o resultado é incerto, e o consumidor checa a PDA).
- Nunca incluir a URL do RPC nem chaves nas mensagens de erro.

- [ ] **Step 1: Write failing tests**:
  - `error-classification.test.ts` (unitário): mapeia logs/erros de simulação para `MintRejectedError` com cada nome, inclusive `PaymentRefAlreadyUsed` e `UnknownProgramError`; erros de rede viram `TransientChainError`; a mensagem não contém a URL do RPC.
  - `token-gateway.integration.test.ts`: `beforeAll` inicia `solana-test-validator --reset --quiet --bpf-program <PROGRAM_ID> anchor/target/deploy/mumbuca_plus.so` no WSL (porta 8899), espera responder, faz airdrop, chama `initialize` (reaproveitando o código de `init-program.ts` da Task 13) e mata o processo no `afterAll`. Casos:
    - `sendMint then waitForConfirmation yields confirmed and balanceOf increases by amount`;
    - `isPaymentRefUsed true after mint; findMintTx returns the same signature`;
    - `second sendMint with same ref throws MintRejectedError PaymentRefAlreadyUsed`;
    - `paused program → MintRejectedError Paused; isPaused true`;
    - `getSignatureStatus of unknown signature is null`.
- [ ] **Step 2: Run** `npm run test:chain -w backend`. O script faz `anchor build` via WSL antes. Expected: FAIL.
- [ ] **Step 3: Implement** `pdas.ts`, `token-gateway.ts` e a classificação de erros.
- [ ] **Step 4: Run** `npm run test:chain -w backend && npm test -w backend && npm run typecheck -w backend`. Expected: PASS.
- [ ] **Step 5: Smoke na devnet (após a Task 13)**: `npm run smoke:mint -w backend -- <pubkey> <cents>` usa o env real, emite com ref `keccak256("smoke:<timestamp>")` e imprime `https://explorer.solana.com/tx/<sig>?cluster=devnet`. Não rodar sem o deploy do dono.
- [ ] **Step 6: Commit**: `feat(backend): add Solana token gateway with on-chain receipt checks`
