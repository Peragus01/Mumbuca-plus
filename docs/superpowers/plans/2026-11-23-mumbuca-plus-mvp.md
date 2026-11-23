# Mumbuca+ MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quando a OZAV confirma a chegada de BRL de uma recarga Pix, o backend emite automaticamente Mumbuca+ (1 Mum+ = R$ 1,00) na carteira Polygon Amoy do usuário, sem emissão duplicada, com dashboard de cidadã e de operador.

**Architecture:** Um repositório com três pacotes npm (workspaces): `contracts/` (Solidity + Hardhat só para testes locais; deploy manual no Remix), `backend/` (Fastify + Postgres, processador in-process com máquina de estados e reconciler) e `frontend/` (React + Vite, servido como estático pelo backend). Provedores de pagamento atrás da interface `PaymentProvider`; a emissão passa por `TokenGateway` (viem) e é idempotente em três camadas (banco, checagem on-chain antes de reenviar, `paymentRefUsed` no contrato).

**Tech Stack:** Node 22, TypeScript 5.9, Fastify 5, zod 4, pg 8, PGlite (testes), vitest, viem 2, Solidity 0.8.24, OpenZeppelin Contracts 5.x, Hardhat 2 (só testes), React 19 + Vite, qrcode.react, Railway (deploy).

**Spec:** `docs/superpowers/specs/2026-11-23-mumbuca-plus-mvp-design.md` — leia antes de qualquer tarefa.

## Global Constraints

- Rede: Polygon Amoy, chain ID `80002`; explorer `https://amoy.polygonscan.com/tx/<hash>`.
- Token: nome `Mumbuca+`, símbolo `Mum+`, 18 decimais, supply inicial 0, cap `10_000_000 * 10**18`, `maxMintPerTx` inicial `20_000 * 10**18`.
- 1 Mum+ = R$ 1,00; dinheiro sempre em **centavos inteiros**; `amountWei = BigInt(cents) * 10n ** 16n`. Nunca usar `number` em ponto flutuante para valores.
- `paymentRef = keccak256(utf8("<provider>:<providerPaymentId>"))` (bytes32 hex).
- Estados de pagamento: `AWAITING_PAYMENT | RECEIVED | VALIDATING | APPROVED | MINT_PENDING | MINTED | FAILED`.
- Mínimo/máximo de recarga: OZAV usa `MIN_RECHARGE_CENTS`/`MAX_RECHARGE_CENTS` do ambiente (live: `1100`/`2000000`; sandbox: `100000`/`1000000`); `simulated` usa `1100`/`2000000`.
- Chave do minter só em env do backend (`MINTER_PRIVATE_KEY`); nunca no frontend, nunca commitada. `.env` no `.gitignore`.
- Backend recusa subir se o prefixo de `OZAV_API_KEY` não bater com `PROVIDER_ENV` (`sandbox` → `ozav_sk_test_`, `live` → `ozav_sk_live_`).
- O backend **nunca** emite com base no corpo de um webhook; sempre consulta o provedor (`fetchPayment`).
- Transferências OZAV sem `metadata.mumbuca_payment_id` são ignoradas (a conta é compartilhada com a Peragus).
- Sem aviso fixo de "ambiente de teste" na UI; origem (`OZAV live` / `OZAV sandbox` / `SIMULADO`) visível só na visão do operador.
- Nenhuma alteração no repositório `PeragusSVM`; código OZAV é copiado de `git -C C:\Users\ferna\OneDrive\Desktop\PeragusSVM show feat/brs-purchase:<caminho>`.
- Testes primeiro (TDD) em toda tarefa com código.

## Review Focus

1. **Webhook de transferência da Peragus (sem `mumbuca_payment_id`)** — responde 200, não cria nem altera nenhum pagamento. → teste na Task 9.
2. **Reinício do servidor com pagamento em `MINT_PENDING`/`APPROVED`** — no boot o reconciler retoma e termina sem emitir de novo. → teste na Task 8.
3. **Duplo clique em "Simular pagamento" ou "Reprocessar"** — no máximo um mint por pagamento. → teste na Task 7.
4. **Valor OZAV com mais de 2 casas decimais (ex.: `"11.005"`) ou formato inválido** — centavos truncados nunca para cima; formato inválido vira `needs_review`, nunca mint. → teste na Task 3 e Task 6.
5. **Carteira emissora sem POL** — pagamento fica em `APPROVED` com `last_error`, operador vê alerta de saldo baixo, nada vai a `FAILED`. → teste na Task 7.

---

## File Structure

```
MumbucaPlus/
  package.json                 workspaces: contracts, backend, frontend; scripts build/start/test
  .gitignore  .nvmrc(22)  README.md
  contracts/
    package.json  hardhat.config.ts
    contracts/MumbucaPlus.sol
    test/MumbucaPlus.test.ts
  backend/
    package.json  tsconfig.json  vitest.config.ts  .env.example
    migrations/001_init.sql
    src/config/env.ts                 parse e valida env (zod)
    src/db/db.ts                      tipo Db + pool pg + migrate()
    src/domain/money.ts               centavos, wei, paymentRef, parse decimal
    src/domain/payment.ts             tipos Payment, PaymentStatus, limites
    src/repositories/user-repository.ts
    src/repositories/payment-repository.ts
    src/chain/token-abi.ts
    src/chain/token-gateway.ts        interface + implementação viem
    src/providers/payment-provider.ts interface + tipos
    src/providers/simulated-provider.ts
    src/providers/mercadopago-provider.ts
    src/providers/ozav/ozav-client.ts       (adaptado da Peragus)
    src/providers/ozav/ozav-signature.ts    (adaptado da Peragus)
    src/providers/ozav/ozav-provider.ts
    src/processing/payment-processor.ts
    src/processing/reconciler.ts
    src/http/app.ts                   buildApp(deps) – Fastify
    src/http/auth.ts
    src/http/routes/*.ts              webhooks, payments, users, ops
    src/main.ts                       wiring + listen + reconciler start
    test/helpers/test-db.ts           PGlite com migrations
    test/**/*.test.ts
  frontend/
    package.json  vite.config.ts  index.html
    src/main.tsx  src/App.tsx  src/api.ts  src/format.ts
    src/pages/Login.tsx  src/pages/CitizenView.tsx  src/pages/OperatorView.tsx
    src/components/RechargeDialog.tsx  src/components/StatusBadge.tsx
    src/**/*.test.tsx
  docs/remix-deploy.md  docs/providers/ozav.md  docs/providers/mercadopago.md  docs/demo-runbook.md
```

## Task Dependencies

1 → 2 (dono implanta) · 3 → 4 → {5, 6} → 7 → 8 → 9 → 10 → 11. Tasks 5 e 6 são independentes entre si. Task 2 roda em paralelo com 3–6. A integração real na Amoy (Task 5, passo final) espera o endereço do contrato da Task 2.

---

### Task 1: Contrato `MumbucaPlus` com testes

**Files:**
- Create: `package.json`, `.gitignore`, `.nvmrc` (raiz). `README.md` já existe (tese e arquitetura em português) — **não sobrescrever**.
- Create: `contracts/package.json`, `contracts/hardhat.config.ts`, `contracts/contracts/MumbucaPlus.sol`
- Test: `contracts/test/MumbucaPlus.test.ts`

**Interfaces:**
- Produces (ABI usada pela Task 5):
  - `constructor(address admin, uint256 cap_, uint256 maxMintPerTx_)` — concede `DEFAULT_ADMIN_ROLE` e `PAUSER_ROLE` a `admin`.
  - `function mint(address to, uint256 amount, bytes32 paymentRef) external` — `onlyRole(MINTER_ROLE)`, `whenNotPaused`.
  - `function paymentRefUsed(bytes32) external view returns (bool)` (mapping público)
  - `function maxMintPerTx() external view returns (uint256)`; `function setMaxMintPerTx(uint256) external` (`DEFAULT_ADMIN_ROLE`)
  - `function pause() / unpause()` (`PAUSER_ROLE`); `paused()`; `MINTER_ROLE()`, `PAUSER_ROLE()`
  - `event MintedForPayment(address indexed to, uint256 amount, bytes32 indexed paymentRef)`
  - erros: `PaymentRefAlreadyUsed(bytes32 paymentRef)`, `MintAmountExceedsLimit(uint256 amount, uint256 limit)`, `InvalidMintAmount()`; herdados OZ: `ERC20ExceededCap`, `EnforcedPause`, `AccessControlUnauthorizedAccount`, `ERC20InvalidReceiver`.

- [ ] **Step 1: Scaffold** — raiz com npm workspaces (`contracts`, `backend`, `frontend`), `.gitignore` (node_modules, dist, .env, artifacts, cache, typechain-types), `.nvmrc` = `22`. `contracts/` com `hardhat@^2.22`, `@nomicfoundation/hardhat-toolbox@^5`, `@openzeppelin/contracts@^5.1.0`; `hardhat.config.ts` com solidity `0.8.24`, optimizer ligado (200). Nenhuma rede remota configurada (deploy é no Remix).

- [ ] **Step 2: Write the failing tests** em `contracts/test/MumbucaPlus.test.ts` (deploy com `admin`, `cap = 10_000_000e18`, `maxMintPerTx = 20_000e18`; `minter` recebe `MINTER_ROLE` no `beforeEach`):
  - `has name Mumbuca+, symbol Mum+, 18 decimals, zero supply`
  - `minter mints amount to wallet and emits Transfer and MintedForPayment(to, amount, ref)` — `balanceOf(user) == 100e18`
  - `reverts PaymentRefAlreadyUsed on second mint with same ref` — e `paymentRefUsed(ref) == true` após o primeiro
  - `reverts AccessControlUnauthorizedAccount when non-minter mints`
  - `admin without MINTER_ROLE cannot mint`
  - `reverts MintAmountExceedsLimit above maxMintPerTx` e `admin can raise maxMintPerTx`
  - `reverts InvalidMintAmount for zero` e `reverts ERC20InvalidReceiver for address(0)`
  - `reverts ERC20ExceededCap beyond cap` (baixe o limite por tx para o cap e minte cap, depois +1)
  - `pause blocks mint with EnforcedPause but transfers still work`; `unpause restores mint`; `non-pauser cannot pause`

- [ ] **Step 3: Run** `npm test -w contracts` — Expected: FAIL (contrato não existe).

- [ ] **Step 4: Implement `MumbucaPlus.sol`** — `ERC20`, `ERC20Capped`, `AccessControl`, `Pausable` (OZ v5). Pausa só em `mint` via `whenNotPaused` (não sobrescrever `_update` com pausa). Override de `_update` exigido por `ERC20Capped`. Ordem em `mint`: `amount == 0` → `InvalidMintAmount`; `amount > maxMintPerTx` → `MintAmountExceedsLimit`; ref usada → `PaymentRefAlreadyUsed`; marca ref; `_mint`; emite evento. Cabeçalho NatSpec dizendo que é token de demonstração em testnet.

- [ ] **Step 5: Run** `npm test -w contracts` — Expected: todos PASS.

- [ ] **Step 6: Commit** — `feat(contracts): add MumbucaPlus ERC-20 with capped, pausable, deduplicated mint`

---

### Task 2: Tutorial de deploy no Remix (dono executa)

**Files:**
- Create: `docs/remix-deploy.md`

**Interfaces:**
- Consumes: `contracts/contracts/MumbucaPlus.sol` (Task 1).
- Produces: para o dono preencher no `.env`/Railway: `TOKEN_ADDRESS`, endereço da carteira minter (`MINTER_PRIVATE_KEY` gerada fora do git).

- [ ] **Step 1: Escrever o tutorial em português**, passo a passo com valores exatos:
  1. Adicionar Polygon Amoy na MetaMask (chain ID 80002, símbolo POL, explorer `https://amoy.polygonscan.com`); obter POL na faucet oficial da Polygon.
  2. Criar uma **segunda conta** na MetaMask para ser a minter do backend; exportar a chave privada só para o `.env`/Railway; enviar ~0,5 POL a ela.
  3. Remix: criar `MumbucaPlus.sol` (colar o arquivo), compilador `0.8.24`, optimizer 200; importar OZ via `@openzeppelin/contracts@5.1.0/...` (mesma versão do `package.json`).
  4. Deploy com "Injected Provider – MetaMask": `admin` = sua conta principal, `cap_` = `10000000000000000000000000`, `maxMintPerTx_` = `20000000000000000000000`.
  5. `grantRole(MINTER_ROLE(), <conta minter>)`.
  6. Teste manual: com a conta principal, `grantRole(MINTER_ROLE, <sua conta>)` temporariamente, `mint(<sua conta>, 1000000000000000000, 0x…01)`, ver saldo; `revokeRole` em seguida. Repetir o mesmo ref e ver o revert `PaymentRefAlreadyUsed`.
  7. Importar o token na MetaMask (endereço do contrato, `Mum+`, 18).
  8. Verificar o contrato: plugin "Contract Verification" do Remix com chave da API Etherscan (v2, multichain), rede Amoy; argumentos do construtor iguais aos do passo 4.
  9. Anotar `TOKEN_ADDRESS` e a tx de deploy.
- [ ] **Step 2: Revisar contra a ABI da Task 1** — todos os nomes de função/papel no tutorial existem no contrato.
- [ ] **Step 3: Commit** — `docs: add Remix deployment guide for Polygon Amoy`
- [ ] **Step 4: Checkpoint do dono** — dono implanta e informa `TOKEN_ADDRESS`. Não bloqueia Tasks 3–6.

---

### Task 3: Esqueleto do backend, config, banco e domínio de dinheiro

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

### Task 5: `TokenGateway` (viem) e teste de integração local

**Files:**
- Create: `backend/src/chain/token-abi.ts`, `backend/src/chain/token-gateway.ts`
- Test: `backend/test/chain/token-gateway.integration.test.ts` (rodado por `npm run test:chain -w backend`, fora do `npm test` padrão)

**Interfaces:**
- Consumes: ABI da Task 1 (copiar o array ABI de `contracts/artifacts/.../MumbucaPlus.json` para `token-abi.ts` como `as const`).
- Produces:
```ts
interface TokenGateway {
  sendMint(to: `0x${string}`, amountWei: bigint, paymentRef: `0x${string}`): Promise<`0x${string}`>; // tx hash
  getReceipt(hash: `0x${string}`): Promise<{ status: 'success' | 'reverted'; blockNumber: bigint } | null>;
  waitForReceipt(hash: `0x${string}`, timeoutMs: number): Promise<{ status: 'success' | 'reverted'; blockNumber: bigint } | null>; // null em timeout
  isPaymentRefUsed(paymentRef: `0x${string}`): Promise<boolean>;
  findMintTx(paymentRef: `0x${string}`): Promise<{ txHash: `0x${string}`; blockNumber: bigint } | null>; // via logs MintedForPayment
  balanceOf(address: `0x${string}`): Promise<bigint>;
  minterNativeBalance(): Promise<bigint>;
  isPaused(): Promise<boolean>;
}
createViemTokenGateway(opts: { rpcUrl: string; chainId: number; tokenAddress: `0x${string}`; minterPrivateKey: `0x${string}`; logsFromBlock?: bigint }): TokenGateway
```
Erros de RPC/timeout propagam como `TransientChainError` (classe exportada); revert na simulação (`simulateContract` antes de `writeContract`) propaga como `MintRevertedError { reason: string }`.

- [ ] **Step 1: Write the failing integration test** — inicia `npx hardhat node` (porta 8545) num `beforeAll`, implanta `MumbucaPlus` com a conta 0 como admin, concede `MINTER_ROLE` à conta 1 e cria o gateway com a chave da conta 1 e `chainId` 31337 (o parâmetro `chainId` existe para isto). Casos:
  - `sendMint then waitForReceipt yields success and balanceOf increases by amount`
  - `isPaymentRefUsed true after mint; findMintTx returns the same hash`
  - `second sendMint with same ref throws MintRevertedError with reason PaymentRefAlreadyUsed`
  - `isPaused reflects pause()`
- [ ] **Step 2: Run** `npm run test:chain -w backend` — Expected: FAIL.
- [ ] **Step 3: Implement** `createViemTokenGateway` (viem `createPublicClient`/`createWalletClient`, `privateKeyToAccount`, chain definida com `defineChain` a partir de `chainId`/`rpcUrl`; `findMintTx` via `getContractEvents` filtrando `paymentRef` indexado).
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Smoke na Amoy (após Task 2)** — script `backend/scripts/mint-smoke.ts` (`npm run smoke:mint -w backend -- <to> <cents>`) usa o env real, minta com ref `keccak256("smoke:<timestamp>")` e imprime o link PolygonScan. Expected: link abre com tx bem-sucedida e saldo aparece na MetaMask.
- [ ] **Step 6: Commit** — `feat(backend): add viem token gateway with on-chain dedup checks`

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
- Consumes: `PaymentRepository`, `UserRepository` (Task 4), `TokenGateway`, `TransientChainError`, `MintRevertedError` (Task 5), `ProviderRegistry`, `ProviderUnavailableError` (Task 6), `paymentRefFor`, `centsToWei`, `rechargeLimits` (Task 3).
- Produces:
```ts
createPaymentProcessor(deps: { payments; users; providers: ProviderRegistry; token: TokenGateway; env: Env; log }): PaymentProcessor
interface PaymentProcessor {
  createRecharge(input: { userId: string; amountCents: bigint; provider: ProviderName }): Promise<Payment>;
  signal(paymentId: string, source: 'webhook' | 'reconciler' | 'operator'): Promise<void>; // AWAITING_PAYMENT→RECEIVED (se aplicável) e enfileira
  process(paymentId: string): Promise<Payment>;   // avança o máximo possível; serializado
  simulate(paymentId: string): Promise<Payment>;  // provider.simulatePayment + signal
  reprocess(paymentId: string): Promise<Payment>; // operador: limpa lastError e processa
}
class RechargeLimitError, UnknownUserError, ProviderNotEnabledError
```
Regras (spec §5.3–5.5):
- **Serialização:** uma fila in-process (cadeia de promises) — um `process` por vez no processo todo (evita nonce duplicado). `process` repetido para o mesmo id enquanto um está rodando é unido ao mesmo promise.
- `signal(id, 'reconciler')` em `AWAITING_PAYMENT` chama `fetchPayment` primeiro e só transiciona para `RECEIVED` se o resultado não for `pending` (evita gravar eventos a cada tick); `signal` vindo de webhook/operador transiciona direto.
- `createRecharge`: valida usuário e `rechargeLimits`; cria pagamento; `createCharge`; `attachCharge`. Se `createCharge` lançar `ProviderUnavailableError` e o provedor tiver `findChargeByPaymentId`, tenta recuperar antes de desistir (nunca re-POST com outro id); sem transferência → pagamento `FAILED` com `failureReason='charge_creation_failed'` e erro propagado.
- `RECEIVED → VALIDATING → fetchPayment`:
  - `pending` → volta a `AWAITING_PAYMENT`.
  - `rejected` → `FAILED` (`provider_rejected:<reason>`); `expired` → `FAILED` (`pix_expired`).
  - `review` → fica `VALIDATING`, `needsReview=true`, `lastError=reason`; não emite.
  - `approved`: se `metadataPaymentId` não nulo e ≠ `payment.id` → `FAILED` (`metadata_mismatch`); recebido < mínimo → `FAILED` (`amount_below_minimum`); usuário/carteira inexistente → `FAILED` (`wallet_not_found`); senão `APPROVED` com `receivedAmountCents`, `amountMismatch = received ≠ requested`, `paymentRef`, `mintAmountWei = centsToWei(received)`.
  - `ProviderUnavailableError` → fica em `VALIDATING`, `lastError`, `attempts+1`.
- `APPROVED`: `isPaymentRefUsed` → se true, `findMintTx` e `MINTED`; senão `sendMint` → `MINT_PENDING` com `txHash` (gravado antes de aguardar) → `waitForReceipt(MINT_RECEIPT_TIMEOUT_MS)`: `success` → `MINTED` com `blockNumber`; `null` → fica `MINT_PENDING`. `TransientChainError` (inclui saldo de POL insuficiente) → fica `APPROVED`, `lastError`, `attempts+1`. `MintRevertedError` com `PaymentRefAlreadyUsed` → recuperar via `findMintTx` → `MINTED`; `EnforcedPause` → fica `APPROVED` com `lastError='token_paused'`; outros reverts → `attempts+1`, e após `MAX_MINT_ATTEMPTS` → `FAILED` (`mint_reverted:<reason>`).
- `MINT_PENDING` (retomada): `getReceipt(txHash)`: `success` → `MINTED`; `reverted` → se `isPaymentRefUsed` → `findMintTx` → `MINTED`, senão volta a `APPROVED`; `null` → se `isPaymentRefUsed` → `findMintTx` → `MINTED`, senão permanece.

- [ ] **Step 1: Write failing tests** (PGlite + `TokenGateway` falso em memória que imita o contrato: mapa de refs, contador de `sendMint`, modos de falha configuráveis; provider falso configurável):
  - `approved payment mints received amount and ends MINTED with txHash and blockNumber`
  - `rejected payment ends FAILED and never calls sendMint`; `expired → FAILED pix_expired`
  - `pending provider status returns to AWAITING_PAYMENT`
  - `review keeps VALIDATING with needsReview and no mint`
  - `unknown wallet → FAILED wallet_not_found` (usuário removido do registro via SQL)
  - `metadata of another payment → FAILED metadata_mismatch`
  - `received below minimum → FAILED amount_below_minimum`
  - `received differs from requested → mints received, amountMismatch true`
  - `provider unavailable keeps VALIDATING and retries later to MINTED`
  - `RPC timeout on sendMint keeps APPROVED; retry mints exactly once`
  - `sendMint broadcast but response lost (gateway records ref, then throws TransientChainError) → retry detects isPaymentRefUsed and marks MINTED without a second sendMint`
  - `receipt timeout keeps MINT_PENDING; later process marks MINTED`
  - `reverted PaymentRefAlreadyUsed recovers hash via findMintTx`
  - `paused token keeps APPROVED with lastError token_paused`
  - `insufficient POL (TransientChainError) keeps APPROVED with lastError` (Review Focus 5)
  - `double simulate / double reprocess / concurrent signal+process → sendMint called once` (Review Focus 3)
  - `createRecharge rejects amount outside limits with RechargeLimitError` (ex.: simulated 1099n)
  - `createRecharge on OZAV unavailable recovers existing transfer by metadata`
- [ ] **Step 2: Run** `npm test -w backend -- processing` — Expected: FAIL.
- [ ] **Step 3: Implement** `createPaymentProcessor` conforme as regras.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(backend): add payment processor state machine with layered idempotency`

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
  - `boot resume: payment left in MINT_PENDING with txHash finishes MINTED without new sendMint` (Review Focus 2)
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
- Produces: `buildApp(deps: { env; payments; users; processor; providers; token; staticDir?: string }): FastifyInstance`. Contrato JSON consumido pela Task 10 (valores monetários como **string** de centavos/wei; datas ISO):
  - `POST /api/login {password}` → 204 + cookie `mp_session` (assinado, `httpOnly`, `secure` fora de dev, `sameSite=lax`, 12 h); senha errada → 401; rate limit 10/min por IP. `POST /api/logout` → 204. `GET /api/session` → `{authenticated: boolean}`.
  - Tudo em `/api/*` (exceto login/session) exige sessão → 401.
  - `GET /api/users` → `User[]`; `POST /api/users {handle, displayName, walletAddress}` → 201 `User`; endereço inválido → 400; duplicado → 409.
  - `GET /api/users/:id/balance` → `{balanceWei: string}` (via `token.balanceOf`).
  - `POST /api/payments {userId, amountCents: string, provider: 'ozav'|'simulated'}` → 201 `PaymentDTO`; limite → 422 `{error:'amount_out_of_range', minCents, maxCents}`; provedor desabilitado → 422.
  - `GET /api/payments?userId=` → `PaymentDTO[]`; `GET /api/payments/:id` → `PaymentDTO`.
  - `POST /api/payments/:id/simulate` → `PaymentDTO` (409 se o provedor não suporta, ex.: OZAV live).
  - `POST /api/payments/:id/reprocess` → `PaymentDTO`.
  - `GET /api/ops/status` → `{providerEnv, tokenAddress, chainId, paused, minterPolWei: string, lowPol: boolean}`.
  - `POST /webhooks/payments` (sem sessão, corpo bruto): escolhe o provedor pelo header `x-ozav-signature` (ausente → 401); `ok:false` → 401; `ignored` ou `metadataPaymentId` nulo ou pagamento não encontrado → 200 `{ignored:true}` sem alterar nada; evento duplicado (`recordProviderEvent` false) → 200 `{duplicate:true}`; senão `processor.signal(id,'webhook')` **sem aguardar o mint** → 200.
  - `PaymentDTO = {id, userId, provider, providerEnv, origin: 'OZAV live'|'OZAV sandbox'|'SIMULADO', status, requestedAmountCents, receivedAmountCents|null, mintAmountWei|null, pixBrCode|null, pixExpiresAt|null, txHash|null, explorerUrl|null, blockNumber|null, needsReview, amountMismatch, failureReason|null, lastError|null, createdAt, updatedAt}`.
  - `main.ts`: `loadEnv(process.env)`, cria pool + `migrate`, repositórios, `createViemTokenGateway`, providers (`ozav` com env; `simulated`; `mercadopago` stub não registrado como habilitado), processor, reconciler (`start`), `buildApp` com `staticDir = ../frontend/dist` (fallback SPA para `index.html`), `listen({port, host:'0.0.0.0'})`; encerra reconciler e pool em `SIGTERM`.

- [ ] **Step 1: Write failing tests** (com `app.inject`, PGlite, fakes das Tasks 5–7):
  - `auth`: `login wrong password 401`; `login ok sets cookie and /api/users works`; `no cookie → 401 on /api/payments`; `11th login in a minute → 429`.
  - `webhooks`: `valid OZAV webhook for known payment → 200 and payment reaches RECEIVED or beyond`; `bad signature → 401 and nothing changes`; `same event twice → second returns duplicate:true and sendMint called once`; `transfer without mumbuca_payment_id → 200 ignored, payments table unchanged` (Review Focus 1); `metadata for unknown payment id → 200 ignored`; `missing signature header → 401`.
  - `payments`: `POST creates OZAV charge and returns pixBrCode and origin 'OZAV sandbox'`; `amount below min → 422 with minCents`; `simulated flow: create → simulate → GET shows MINTED with explorerUrl https://amoy.polygonscan.com/tx/<hash>`; `amounts serialized as strings`.
  - `users`: `create, list, invalid address 400, duplicate 409`; `balance returns string wei`.
  - `ops`: `lowPol true when minter balance below LOW_POL_THRESHOLD_WEI`.
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
  - `format.ts`: `formatBRL(cents: string): string` (`"1100"` → `"R$ 11,00"`); `formatMPlus(wei: string): string` (`"11000000000000000000"` → `"11,00 Mum+"`, sem `Number` para wei); `shortAddress(addr)` (`0x8f3…a21c`); `statusLabel(status)`: `AWAITING_PAYMENT→"Aguardando Pix"`, `RECEIVED|VALIDATING→"Pagamento confirmado"` (VALIDATING mostra "Confirmando pagamento"), `APPROVED|MINT_PENDING→"Emitindo"`, `MINTED→"Emitido"`, `FAILED→"Falhou"`.
  - Cidadã: seletor de usuário, saldo (`/balance`), endereço com copiar, botão "Recarregar" → `RechargeDialog` (valor em reais, valida mín/máx retornado no 422, mostra QR `qrcode.react` + copia-e-cola do `pixBrCode`, faz polling de `GET /api/payments/:id` a cada 2 s até `MINTED|FAILED` mostrando a linha do tempo de status), histórico com link "ver na rede ↗" (`explorerUrl`).
  - Operador: tabela de todos os pagamentos com origem (badge `SIMULADO` destacado), valores solicitado/recebido, Mum+ emitidos, estado, hash/link, `failureReason`/`lastError`, ícone para `amountMismatch`/`needsReview`; botões "Simular pagamento" (visível quando origem é `OZAV sandbox` ou `SIMULADO` e status `AWAITING_PAYMENT`) e "Reprocessar" (status não terminal); formulário de cadastro de usuário de demonstração; painel `ops/status` com alerta de POL baixo e token pausado; seletor de provedor na recarga do operador (`ozav` | `simulated`).
- [ ] **Step 1: Scaffold** Vite React TS; deps `react@19`, `react-dom@19`, `qrcode.react`; dev `vitest`, `@testing-library/react`, `jsdom`.
- [ ] **Step 2: Write failing tests**: `formatBRL("100000") === "R$ 1.000,00"`; `formatMPlus("11000000000000000000") === "11,00 Mum+"`; `formatMPlus("1")` não lança; `StatusBadge` renderiza "Emitido" para `MINTED` e "SIMULADO" quando `origin==='SIMULADO'`; `RechargeDialog` com resposta 422 mostra "Valor mínimo R$ 11,00"; com resposta 201 mostra o copia-e-cola e, após o fetch mockado retornar `MINTED`, mostra o link para a PolygonScan.
- [ ] **Step 3: Run** `npm test -w frontend` — Expected: FAIL.
- [ ] **Step 4: Implement** páginas e componentes.
- [ ] **Step 5: Run** `npm test -w frontend && npm run build -w frontend` — Expected: PASS e `frontend/dist/index.html` existe.
- [ ] **Step 6: Verificação manual local** — backend com `PROVIDER_ENV=sandbox`, provedor `simulated`, gateway apontando para `npx hardhat node`: login → cadastrar usuário → recarga simulada R$ 50 → Simular → "Emitido" com link. Registrar print.
- [ ] **Step 7: Commit** — `feat(frontend): add citizen and operator dashboard`

---

### Task 11: Deploy no Railway, runbook e ensaio ponta a ponta

**Files:**
- Modify: `package.json` (raiz: `build` = build do frontend + backend; `start` = `npm run start -w backend`)
- Create: `docs/demo-runbook.md`
- Modify: `README.md` — só a seção 12 (substituir a frase "Instruções para rodar localmente…" por instruções reais de execução local e deploy) e o "Status" da seção 11; não alterar as demais seções.

**Interfaces:**
- Consumes: tudo.

- [ ] **Step 1: Build de produção local** — `npm ci && npm run build && npm start` com env de sandbox. Expected: `GET /api/session` responde e a SPA abre em `http://localhost:3000`.
- [ ] **Step 2: Railway (com o dono)** — projeto novo `mumbuca-plus`, serviço apontando para o novo repositório GitHub, plugin Postgres (`DATABASE_URL`, `DATABASE_SSL=true`), todas as variáveis de `.env.example` preenchidas pelo dono no painel (nunca no chat ou no git), build `npm ci && npm run build`, start `npm start`, domínio público gerado. Expected: URL HTTPS abre o login.
- [ ] **Step 3: Webhook OZAV (se `webhooks:write` disponível)** — registrar `https://<domínio>/webhooks/payments` e pôr o segredo em `OZAV_WEBHOOK_SECRET`. Se não disponível, anotar no runbook que o reconciler cobre.
- [ ] **Step 4: Ensaio sandbox** — recarga OZAV de R$ 1.000 → Simular → `MINTED`; abrir a tx na PolygonScan; ver 1.000 Mum+ na MetaMask. Clicar "Reprocessar" e confirmar que nenhuma nova tx aparece. Registrar hash.
- [ ] **Step 5: Ensaio simulado** — recarga `SIMULADO` de R$ 50 → `MINTED`.
- [ ] **Step 6: Ensaio live (se o dono fornecer chave live)** — trocar `PROVIDER_ENV=live`, chave/IDs live, `MIN_RECHARGE_CENTS=1100`; recarga de R$ 11 paga pelo dono via Pix → `MINTED` com 11 Mum+. Se falhar, registrar o motivo e manter sandbox como caminho principal.
- [ ] **Step 7: `docs/demo-runbook.md`** — checklist da véspera (POL da minter > `LOW_POL_THRESHOLD_WEI`, `MINTER_ROLE`, token não pausado, chaves do ambiente certo, Railway no ar), roteiro da apresentação (spec §10), contingências (OZAV fora → `SIMULADO`; sem internet → vídeo), como gravar o vídeo de contingência.
- [ ] **Step 8: Commit** — `docs: add deployment and demo runbook`
