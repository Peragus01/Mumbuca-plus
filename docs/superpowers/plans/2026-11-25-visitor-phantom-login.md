# Conta de visitante com login pela Phantom — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Qualquer pessoa com uma Phantom em devnet consegue entrar, criar uma conta, comprar Mum+ pelo fluxo simulado e recebê-los na carteira, sem ver dados de mais ninguém. O operador continua com a senha.

**Architecture:**
- **Sessões.** O cookie `mp_session` passa a carregar o papel (`op` ou `vis:<userId>`). Um hook no `/api` resolve a sessão e a anexa à requisição. Cada rota decide o escopo a partir dela.
- **Login.** O login pela Phantom é um desafio-resposta: o nonce e a mensagem exata ficam no banco, e a assinatura ed25519 é verificada com `@noble/curves`. O cadastro usa um cookie curto `mp_signup`.
- **Limites.** Os limites de visitante ficam num módulo de política, que fica entre as rotas e o `createRecharge`.
- **Frontend.** O app escolhe a experiência pelo papel. O visual do visitante usa `AnimatedGradient` e `PopButton` do Spell UI, sobre Tailwind v4 sem preflight.

**Tech Stack:**
- Backend: Node 22, Fastify 5, Postgres (PGlite nos testes), vitest, `@noble/curves`, `@scure/base`.
- Frontend: React 19, Vite 7, Tailwind CSS v4 (`@tailwindcss/vite`), `@radix-ui/react-slot`, `clsx`, `tailwind-merge`.

**Spec:** `docs/superpowers/specs/2026-11-25-visitor-phantom-login-design.md`

## Global Constraints

- **Visitante:**
  - só pode usar o provedor `simulated`;
  - o valor por compra fica entre `max(1100, VISITOR_MIN_CENTS)` e `min(2000000, VISITOR_MAX_CENTS)`. Os limites de visitante só estreitam `rechargeLimits()`, e o boot falha se `VISITOR_MIN_CENTS < 1100`.
- **Padrões de ambiente:**
  - `VISITOR_MIN_CENTS=1100`, `VISITOR_MAX_CENTS=10000`;
  - `VISITOR_MAX_PURCHASES_PER_DAY=3`, `VISITOR_DAILY_CAP_CENTS=200000`;
  - `VISITOR_SIGNUPS_PER_IP_PER_DAY=5`, `VISITOR_SIGNIN_ENABLED=true`.
- **Limites por IP:** challenge 20/min, verify 10/min, signup 5/min, `POST /api/payments` de visitante 5/min.
- **Prazos:**
  - nonce válido por **5 min** e de uso único;
  - `mp_signup` válido por **10 min**;
  - `mp_session` válido por 12 h, como hoje;
  - um `AWAITING_PAYMENT` de visitante deixa de contar depois de **30 min**.
- **Escopo:** recurso de outra pessoa responde **404** (nunca 403). Rota só de operador chamada por visitante responde **403** `{ error: 'forbidden' }`.
- **Dados guardados:**
  - só o endereço da carteira e o nome de exibição (2–40 caracteres, sem caracteres de controle, espaços aparados);
  - o IP só aparece como `sha256(SESSION_SECRET + ip + dia)`.
- **Texto e visual:**
  - textos em pt-BR, no tom C2;
  - a tela de entrada diz "Rede de testes Solana · nenhum dinheiro real é cobrado";
  - nenhuma regra ou texto técnico na tela do visitante.
- **Sem recursos externos em tempo de execução:** nada de fontes ou CDN. A fonte DynaPuff do PopButton **não** é usada.
- **Spell UI:**
  - código copiado de `https://spell.sh/r/animated-gradient.json` e `https://spell.sh/r/pop-button.json` (campo `files[0].content`), com cabeçalho `// From Spell UI (https://spell.sh) — MIT License, (c) xxtomm`;
  - únicas alterações: o shim do `useTheme` e a variante `marica`.
- **Cores:**
  - gradiente: `{ preset: 'custom', color1: '#06150f', color2: '#3dffa8', color3: '#ffd23f' }`;
  - variante `marica`: `bg-[#ffd23f] hover:bg-[#ffdb63] border-[#a8840a] text-[#1a1400]`.
- **O que não pode quebrar:**
  - todos os testes atuais do backend e do frontend;
  - o fluxo do operador;
  - o `ENV_KEYS` igual ao `.env.example`.
- **Logs e erros:** logs só com a classe do erro; corpos de erro genéricos. Nenhum segredo no frontend.

## Review Focus

1. **Usuário recusa a conexão ou a assinatura na Phantom** (erro com `code: 4001`). Deve aparecer "Você cancelou na Phantom. Tente de novo quando quiser.", sem tela de erro genérica. O teste fica na Task 7.
2. **Phantom em mainnet em vez de devnet.** O login funciona do mesmo jeito, mas o saldo não aparece no app da Phantom. A carteira mostra a dica "Seus Mum+ aparecem na Phantom quando ela está na rede de testes (Devnet)". O teste fica na Task 8.
3. **`mp_signup` expirado entre a assinatura e o "Criar conta".** O signup responde 401 `signup_expired`, e o frontend volta para a Entrada com "Sua sessão expirou, entre de novo". Os testes ficam nas Tasks 3 e 7.
4. **Nome só com espaços, longo demais ou com caracteres de controle.** Responde 400 `invalid_display_name`, e o campo mostra o erro sem perder o que foi digitado. Os testes ficam nas Tasks 3 e 7.
5. **CSS C2 sem camada sobrescrevendo utilitários do Tailwind** (`input`, `body` e similares). O PopButton e o gradiente precisam ficar iguais ao esboço. O teste de render fica na Task 6; o screenshot de verificação fica na Task 8.

---

### Task 1: Migração, variáveis de ambiente e `created_via`

**Files:**
- Create: `backend/migrations/002_visitor_auth.sql`
- Modify: `backend/src/config/env.ts`, `backend/.env.example`, `backend/src/domain/payment.ts`, `backend/src/repositories/payment-repository.ts`
- Test: `backend/test/config/env.test.ts`, `backend/test/repositories/payment-repository.test.ts`, `backend/test/db/migrate.test.ts`
- Modify: `backend/test/helpers/http-app.ts` (truncar também `auth_challenges` e `signup_ip_counts`)

**Interfaces:**
- Produces:
  - `Env.VISITOR_MIN_CENTS: bigint`, `VISITOR_MAX_CENTS: bigint`, `VISITOR_DAILY_CAP_CENTS: bigint`;
  - `Env.VISITOR_MAX_PURCHASES_PER_DAY: number`, `VISITOR_SIGNUPS_PER_IP_PER_DAY: number`, `VISITOR_SIGNIN_ENABLED: boolean`;
  - `type CreatedVia = 'operator' | 'visitor'`;
  - `Payment.createdVia: CreatedVia`;
  - `PaymentRepository.create(input & { createdVia?: CreatedVia })`.

SQL da migração:
```sql
create table auth_challenges (
  nonce text primary key, wallet_address text not null, message text not null,
  expires_at timestamptz not null, used_at timestamptz);
create table signup_ip_counts (
  ip_hash text not null, day date not null, count int not null default 0, primary key (ip_hash, day));
alter table payments add column created_via text not null default 'operator'
  check (created_via in ('operator','visitor'));
create index payments_user_created_idx on payments (user_id, created_at);
create index payments_visitor_created_idx on payments (created_at) where created_via = 'visitor';
```

- [ ] **Step 1: Testes que falham**
  - Em `env.test.ts`: `loadEnv(validEnv)` tem `VISITOR_MIN_CENTS === 1100n`, `VISITOR_MAX_CENTS === 10000n`, `VISITOR_MAX_PURCHASES_PER_DAY === 3`, `VISITOR_DAILY_CAP_CENTS === 200000n`, `VISITOR_SIGNUPS_PER_IP_PER_DAY === 5`, `VISITOR_SIGNIN_ENABLED === true`.
  - Ainda em `env.test.ts`, os casos de erro:
    - `VISITOR_MIN_CENTS: '1000'` lança uma mensagem contendo `VISITOR_MIN_CENTS`;
    - `VISITOR_SIGNIN_ENABLED: 'false'` resulta em `false`;
    - `VISITOR_MIN_CENTS > VISITOR_MAX_CENTS` lança.
  - Em `payment-repository.test.ts`: `create({..., createdVia: 'visitor'})` resulta em `createdVia === 'visitor'`, e o padrão é `'operator'`.
- [ ] **Step 2:** `cd backend && npx vitest run test/config test/repositories test/db`. Esperado: FAIL (as chaves e a coluna ainda não existem).
- [ ] **Step 3: Implementar.**
  - Adicionar as chaves ao `base` de `env.ts` com os padrões. Usar `intStr`/`bigintStr`, e para o booleano `z.enum(['true','false']).default('true').transform(v => v === 'true')`.
  - No `superRefine`, adicionar as duas checagens.
  - Acrescentar as chaves, vazias e comentadas, ao `.env.example`.
  - Mapear `created_via` em `mapPayment` e no insert.
- [ ] **Step 4:** Rodar de novo; o resultado esperado é PASS. Rodar também `npx vitest run`: toda a suíte do backend deve passar (PASS).
- [ ] **Step 5:** `git commit -m "feat(backend): visitor env, created_via column and auth tables"`

### Task 2: Sessões com papel

**Files:**
- Modify: `backend/src/http/auth.ts`, `backend/src/http/app.ts`
- Test: `backend/test/http/auth.test.ts`

**Interfaces:**
- Produces (em `auth.ts`):
  - `type Session = { role: 'operator' } | { role: 'visitor'; userId: string }`;
  - `readSession(req: FastifyRequest, now?: number): Session | null`. Aceita `v2:op:<ts>`, `v2:vis:<uuid>:<ts>` e o legado `v1:<ts>` (este vira operador);
  - `setSessionCookie(reply, session: Session, secure: boolean): void`;
  - `declare module 'fastify' { interface FastifyRequest { session: Session | null } }`, preenchido pelo hook do `/api`;
  - `requireOperator(req, reply)`, que responde 403 `{ error: 'forbidden' }` para visitante e devolve `true` quando a rota deve parar.
- `GET /api/session` responde `{ authenticated: boolean, role: 'operator' | 'visitor' | null }`. `POST /api/logout` limpa `mp_session` e `mp_signup`.
- Rotas públicas: `/api/login`, `/api/session`, `/api/auth/phantom/challenge`, `/api/auth/phantom/verify`, `/api/auth/signup` e `/api/public/status`.

- [ ] **Step 1: Testes que falham** em `auth.test.ts`. Atualizar os dois `toEqual({ authenticated: ... })` existentes para incluir `role`.
  - `login ok sets v2 operator cookie`: `/api/session` → `{ authenticated: true, role: 'operator' }`.
  - `legacy v1 cookie still operator`: um cookie assinado `v1:${Date.now()}`, gerado com `app.signCookie`, ainda acessa `/api/users` (200).
  - `visitor cookie gets 403 on operator-only route`: cookie `v2:vis:<uuid>:<now>` assinado → `GET /api/users` 403 `{ error: 'forbidden' }`.
  - `unsigned v2 cookie → 401`.
- [ ] **Step 2:** `npx vitest run test/http/auth.test.ts`. Esperado: FAIL.
- [ ] **Step 3: Implementar** em `auth.ts` e `app.ts`.
  - Trocar `hasSession` por `readSession`, mantendo `hasSession = (req) => readSession(req) !== null` para quem já usa.
  - O hook preenche `req.session`.
  - Em `users.ts`, aplicar `requireOperator` em `GET/POST /users`. O resto do escopo fica para a Task 4.
- [ ] **Step 4:** Rodar `npx vitest run`. Esperado: PASS.
- [ ] **Step 5:** `git commit -m "feat(backend): role-aware sessions (operator / visitor)"`

### Task 3: Login com Phantom e cadastro

**Files:**
- Create: `backend/src/auth/phantom-challenge.ts` (mensagem e verificação), `backend/src/repositories/auth-repository.ts`, `backend/src/http/routes/phantom-auth.ts`
- Modify: `backend/src/http/app.ts` (registrar as rotas), `backend/src/repositories/user-repository.ts`, `backend/package.json` (adicionar `"@noble/curves": "^1.4.0"`)
- Test: `backend/test/auth/phantom-challenge.test.ts`, `backend/test/http/phantom-auth.test.ts`

**Interfaces:**
- Produces:
  - `buildSignInMessage(p: { host: string; wallet: string; nonce: string; issuedAt: Date; expiresAt: Date }): string`;
  - `verifySignature(message: string, signatureB58: string, walletB58: string): boolean`. Usa `ed25519.verify` e devolve `false` em vez de lançar para entrada malformada;
  - `AuthRepository`:
    - `createChallenge(wallet, message, expiresAt): Promise<string /*nonce*/>`;
    - `consumeChallenge(nonce, wallet, now): Promise<{ message: string } | null>`, com `update … set used_at = now() where nonce=$1 and wallet_address=$2 and used_at is null and expires_at > $3 returning message`;
    - `deleteExpiredChallenges(now)`;
    - `incrementSignupCount(ipHash, day, limit): Promise<boolean>`. Faz upsert e devolve `false` se ultrapassar o limite;
  - `UserRepository.findByWallet(wallet): Promise<User | null>`.
- Rotas (todas respondem 403 `{ error: 'signin_disabled' }` quando `VISITOR_SIGNIN_ENABLED=false`):
  - `POST /api/auth/phantom/challenge {walletAddress}` → `200 { nonce, message }`. Endereço inválido → 400 `invalid_wallet_address`.
  - `POST /api/auth/phantom/verify {walletAddress, nonce, signature}` → `200 { status: 'signed_in' }`, com `mp_session` de visitante, ou `200 { status: 'needs_signup' }`, com `mp_signup`. Falha → 401 `invalid_signature` (inclui nonce reutilizado, expirado ou de outra carteira).
  - `POST /api/auth/signup {displayName}` → `201 { status: 'signed_in' }`.
    - `mp_signup` ausente ou expirado → 401 `signup_expired`.
    - Nome inválido → 400 `invalid_display_name`.
    - Limite por IP → 429 `rate_limited`.
- `mp_signup`: assinado, `httpOnly`, `sameSite lax`, `maxAge` de 600 s e valor `<wallet>:<issuedAtMs>`.
- `handle`: `v_` + 8 primeiros caracteres da carteira. Em caso de colisão, sufixo `_2`, `_3`, e assim por diante.

- [ ] **Step 1: Testes que falham.** Nos testes, assinar com `Keypair.generate()` e `ed25519.sign(msgBytes, kp.secretKey.slice(0, 32))`.
  - `phantom-challenge.test.ts`:
    - a mensagem contém o host, a carteira, `Nonce: <nonce>` e a frase "Isso não autoriza nenhuma transação.";
    - a assinatura válida devolve `true`;
    - mensagem alterada, outra carteira ou assinatura em base58 inválido devolvem `false`.
  - `phantom-auth.test.ts`:
    1. Carteira nova: challenge → verify → `needs_signup`. Depois, signup com `{displayName: ' Ana '}` → 201, e `/api/me` (Task 4) ou `/api/session` mostram `role: 'visitor'`. O usuário salvo tem `displayName 'Ana'` e `handle` começando com `v_`.
    2. Carteira já cadastrada pelo operador → `signed_in` direto.
    3. Verify com o mesmo nonce duas vezes → a segunda dá 401.
    4. Nonce expirado (avançar o relógio com `vi.setSystemTime` em 6 min) → 401.
    5. Assinatura feita por outra keypair → 401.
    6. Signup sem `mp_signup` → 401 `signup_expired`. Com `mp_signup` de 11 min atrás → 401.
    7. `displayName` com `'   '`, com 41 caracteres ou com `'\u0007x'` → 400 `invalid_display_name`.
    8. Sexto signup do mesmo IP no mesmo dia → 429.
    9. Dois signups simultâneos com a mesma carteira (`Promise.all`) → os dois terminam em sessão de visitante do **mesmo** `userId`.
    10. `VISITOR_SIGNIN_ENABLED=false` → challenge 403 `signin_disabled`.
- [ ] **Step 2:** `npx vitest run test/auth test/http/phantom-auth.test.ts`. Esperado: FAIL.
- [ ] **Step 3: Implementar.**
  - O challenge chama `deleteExpiredChallenges(now)` antes de criar o novo.
  - O host da mensagem vem de `req.hostname`.
  - A mensagem é guardada no challenge; o verify usa **somente** a mensagem guardada.
  - O nonce é `randomBytes(16)` em hex.
  - O signup trata `DuplicateUser` em corrida relendo `findByWallet`.
  - O `ipHash` é `sha256(SESSION_SECRET + req.ip + yyyy-mm-dd)`.
  - Os rate limits por rota usam `config.rateLimit`, como no `/login`.
- [ ] **Step 4:** Rodar `npx vitest run`. Esperado: PASS.
- [ ] **Step 5:** `git commit -m "feat(backend): Phantom sign-in (challenge/verify) and visitor signup"`

### Task 4: Escopo do visitante nas rotas e `/api/me`

**Files:**
- Create: `backend/src/http/routes/me.ts`
- Modify: `backend/src/http/routes/users.ts`, `backend/src/http/routes/payments.ts`, `backend/src/http/routes/ops.ts`, `backend/src/http/app.ts`
- Test: `backend/test/http/visitor-scope.test.ts`. Acrescentar a `test/helpers/http-app.ts` o helper `visitorCookie(userId)`, que assina `v2:vis:<id>:<now>`.

**Interfaces:**
- Consumes: `req.session` e `requireOperator` (Task 2).
- Produces:
  - `GET /api/me` → operador: `{ role: 'operator' }`; visitante: `{ role: 'visitor', user: UserDTO }`. Se o usuário do cookie não existe mais → 401;
  - `PaymentRepository.findByIdForUser(id, userId)`, ou checar `p.userId` na rota.

O escopo segue a tabela do spec ("O que o visitante pode fazer").

- [ ] **Step 1:** Testes que falham em `visitor-scope.test.ts`. São duas contas, A e B, e cada uma tem um pagamento simulado:
  - Visitante A:
    - `GET /api/users` → 403;
    - `POST /api/users` → 403;
    - `GET /api/ops/status` → 403;
    - `POST /payments/:id/reprocess` → 403.
  - `GET /api/users/B/balance` → 404. `GET /api/users/A/balance` → 200.
  - `GET /api/payments?userId=B` → só os pagamentos de A.
  - `GET /api/payments/:idDeB` → 404.
  - `POST /payments/:idDeB/simulate` → 404.
  - `POST /api/payments` com `{userId: B, provider: 'simulated', amountCents: '5000'}` → 201, com o pagamento criado para A.
  - Provider `ozav` → 422 `provider_not_enabled`.
  - `GET /api/me` de visitante → `{ role: 'visitor', user: { id: A, ... } }`.
  - Operador: tudo continua como hoje (o `payments.test.ts` existente cobre).
- [ ] **Step 2:** `npx vitest run test/http/visitor-scope.test.ts`. Esperado: FAIL.
- [ ] **Step 3: Implementar.**
  - Visitante cria pagamento com `createdVia: 'visitor'`. Passar `createdVia` por `processor.createRecharge({..., createdVia})` até `payments.create`.
  - Os limites de valor e as cotas entram na Task 5.
- [ ] **Step 4:** Rodar `npx vitest run`. Esperado: PASS.
- [ ] **Step 5:** `git commit -m "feat(backend): scope API to the visitor's own data; /api/me"`

### Task 5: Política de compras do visitante e status público

**Files:**
- Create: `backend/src/processing/visitor-policy.ts`
- Modify: `backend/src/http/routes/payments.ts`, `backend/src/repositories/payment-repository.ts`, `backend/src/http/app.ts`
- Create: `backend/src/http/routes/public.ts`
- Test: `backend/test/processing/visitor-policy.test.ts`, `backend/test/http/visitor-purchases.test.ts`

**Interfaces:**
- Produces:
  - `createVisitorPolicy({ env, payments, token, now? })` devolve:
    - `checkCreate(userId: string, amountCents: bigint): Promise<PolicyResult>`;
    - `checkPay(): Promise<PolicyResult>`;
    - `purchasesOpen(): Promise<boolean>`.
  - `type PolicyResult = { ok: true } | { ok: false; error: 'amount_out_of_range' | 'purchases_closed' | 'daily_limit' | 'open_payment'; minCents?: bigint; maxCents?: bigint }`.
  - `PaymentRepository`:
    - `visitorTotals(since: Date, staleBefore: Date): Promise<{ cents: bigint }>`;
    - `visitorUserStats(userId, since, staleBefore): Promise<{ count: number; openAwaiting: number }>`.
  - Ambos contam só `created_via = 'visitor'`, `status <> 'FAILED'` e excluem `status = 'AWAITING_PAYMENT' and created_at < staleBefore`.
  - `openAwaiting` conta `AWAITING_PAYMENT` com `created_at >= staleBefore`.
- **"Compras fechadas"** acontece quando qualquer um vale: `!VISITOR_SIGNIN_ENABLED`, `paused`, `configIssues.length > 0`, `lowSol`, falha na consulta à rede, ou teto diário atingido. O status da rede fica em cache por 30 s dentro da política.
- **Respostas HTTP de visitante** em `POST /api/payments`:
  - 422 `amount_out_of_range` com `minCents` e `maxCents`;
  - 409 `purchases_closed`;
  - 429 `daily_limit` (3 por carteira, ou o teto somado ultrapassado com este valor);
  - 409 `open_payment`.
- `POST /payments/:id/simulate` de visitante chama `checkPay()` e responde 409 `purchases_closed`.
- `GET /api/public/status` (sem sessão) → `{ visitorPurchasesOpen: boolean }`.

- [ ] **Step 1: Testes que falham.** Usar o `FakeChain` (`config.paused`, `minterNativeBalance`) e `vi.setSystemTime`.
  - Valor: `1099` e `10001` → `amount_out_of_range` com min 1100 e max 10000.
  - Quarta compra do dia na mesma carteira → `daily_limit`. Uma compra `FAILED` não conta.
  - Teto: com `VISITOR_DAILY_CAP_CENTS=15000`, duas compras de 10000 em contas diferentes → a segunda dá `daily_limit`.
  - Com um `AWAITING_PAYMENT` recente → `open_payment`. Depois de 31 min → permitido, e o antigo não conta para o teto.
  - Pagamento do operador (`created_via='operator'`) não conta em nada.
  - `FakeChain` com `paused = true` → create 409 `purchases_closed` e simulate 409 `purchases_closed`. Também `/api/public/status` → `{ visitorPurchasesOpen: false }`.
  - Saldo de SOL abaixo de `LOW_SOL_THRESHOLD_LAMPORTS` → `purchases_closed`.
  - Fluxo feliz: visitante cria R$ 50 → simulate → `idle()` → `MINTED` e mint para a carteira dele.
- [ ] **Step 2:** `npx vitest run test/processing/visitor-policy.test.ts test/http/visitor-purchases.test.ts`. Esperado: FAIL.
- [ ] **Step 3: Implementar** a política e ligá-la nas rotas, só para `req.session.role === 'visitor'`.
  - Rate limit de 5/min em `POST /api/payments`. Usar `config.rateLimit` com `keyGenerator` por IP e aplicar a todos: o operador também fica com 5/min, e isso é aceitável.
- [ ] **Step 4:** Rodar `npx vitest run`. Esperado: PASS.
- [ ] **Step 5:** `git commit -m "feat(backend): visitor purchase limits, purchases-closed and public status"`

### Task 6: Tailwind v4 e componentes Spell UI

**Files:**
- Modify: `frontend/package.json` (dependências: `@radix-ui/react-slot`, `clsx`, `tailwind-merge`; devDependencies: `tailwindcss`, `@tailwindcss/vite`), `frontend/vite.config.ts`, `frontend/tsconfig.json`, `frontend/src/main.tsx`
- Create: `frontend/src/tailwind.css`, `frontend/src/lib/utils.ts`, `frontend/src/components/spell/animated-gradient.tsx`, `frontend/src/components/spell/pop-button.tsx`
- Test: `frontend/src/components/spell/spell.test.tsx`

**Interfaces:**
- Produces:
  - `cn(...inputs: ClassValue[]): string`;
  - `default export AnimatedGradient({ config, style, className })`, como no original;
  - `PopButton` com `color: Color | 'marica'`, `size`, `asChild`;
  - alias `@/` → `frontend/src/`.

`tailwind.css`, sem preflight, com os tokens que o PopButton usa:
```css
@layer theme, base, components, utilities;
@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/utilities.css" layer(utilities);
@theme { --color-ring: #ffd23f; --color-background: #06150f; --color-primary-foreground: #1a1400; }
@custom-variant dark (&:where(.dark, .dark *));
```
O `@custom-variant dark` com a classe `.dark` faz o `default` do PopButton ficar sempre na versão clara. Esse é o secundário claro do esboço.

- [ ] **Step 1: Teste que falha** em `spell.test.tsx`:
  - `render(<PopButton color="marica">Entrar</PopButton>)` → botão com classes contendo `bg-[#ffd23f]` e `border-b-4`;
  - `render(<AnimatedGradient config={{ preset: 'custom', color1: '#06150f', color2: '#3dffa8', color3: '#ffd23f' }} />)` não lança no jsdom (sem WebGL2) e renderiza um `canvas`.
- [ ] **Step 2:** `cd frontend && npx vitest run src/components/spell`. Esperado: FAIL (módulo não existe).
- [ ] **Step 3: Implementar.**
  - Copiar os dois arquivos do registro, com o cabeçalho MIT.
  - No gradiente, trocar `import { useTheme } from "next-themes"` por `const useTheme = () => ({ resolvedTheme: 'dark' as const })`.
  - Adicionar `marica` ao tipo `Color` e ao mapa de cores.
  - Configurar o plugin `tailwindcss()` no Vite, o `resolve.alias` e `paths` no tsconfig (`"baseUrl": ".", "paths": { "@/*": ["src/*"] }`).
  - Em `main.tsx`, importar `./tailwind.css` **antes** de `./styles.css`.
  - Com `prefers-reduced-motion: reduce`, passar `speed: 0` (ver Task 8).
- [ ] **Step 4:** `npx vitest run && npm run build`. Esperado: PASS e build sem erros.
- [ ] **Step 5:** `git commit -m "feat(frontend): Tailwind v4 (no preflight) and Spell UI AnimatedGradient/PopButton"`

### Task 7: Entrada, Criar conta e Sem Phantom

**Files:**
- Create: `frontend/src/phantom.ts`, `frontend/src/pages/Entry.tsx` (Entrada + Sem Phantom + campo do operador), `frontend/src/pages/CreateAccount.tsx`
- Modify: `frontend/src/api.ts`, `frontend/src/App.tsx`; remover `frontend/src/pages/Login.tsx` (a lógica de senha passa para `Entry.tsx`)
- Test: `frontend/src/pages/Entry.test.tsx`, `frontend/src/pages/CreateAccount.test.tsx`

**Interfaces:**
- Produces:
  - `phantom.ts`:
    - `getPhantom(): PhantomProvider | null`, lido de `window.phantom?.solana` com `isPhantom`;
    - `connectAndSign(message: (wallet: string) => Promise<string>): Promise<{ wallet: string; signatureB58: string }>`;
    - `isUserRejection(e): boolean`, que verifica `code === 4001`.
  - `api`:
    - `session()` → `{ authenticated; role }`;
    - `me()`;
    - `phantomChallenge(walletAddress)`;
    - `phantomVerify({ walletAddress, nonce, signature })`;
    - `signup(displayName)`;
    - `publicStatus()`.
  - `App`: `role === null` → `<Entry>`; `'visitor'` → app do visitante (Task 8); `'operator'` → app atual.

**Textos (fixos):**
- Título: "Gaste em Maricá" / *"com vantagens"*.
- Subtítulo: "Compre Mum+ e ganhe descontos em restaurantes, hospedagem, cultura e comércio local."
- Botão: "Entrar com Phantom". Rodapé: "Rede de testes Solana · nenhum dinheiro real é cobrado". Link: "Sou operador".
- Sem Phantom: título "Falta só *a Phantom*", com os passos:
  - "1. Instale a carteira Phantom";
  - "2. Em Configurações, ative a rede de testes (Devnet)";
  - "3. Volte aqui e toque em Entrar";
  - botão "Instalar Phantom ↗", que abre `https://phantom.app/download` em nova aba (`rel="noopener noreferrer"`);
  - nota "No celular, abra este site pelo navegador da Phantom."
- Criar conta: título "Bem-vindo! *Vamos criar sua conta*", cartão "Sua carteira" com o endereço curto e "✓ conectada", rótulo "Como quer ser chamado?" e botão "Criar conta".
- Erros:
  - recusa → "Você cancelou na Phantom. Tente de novo quando quiser.";
  - `signup_expired` → "Sua sessão expirou, entre de novo.";
  - `invalid_display_name` → "Use de 2 a 40 caracteres.";
  - `signin_disabled` → "O acesso de visitantes está pausado no momento.";
  - outros → "Não conseguimos entrar agora. Tente de novo.".

- [ ] **Step 1: Testes que falham**, com `window.phantom` mockado:
  - sem Phantom → aparece "Falta só";
  - clique em "Entrar com Phantom" → chama `phantomChallenge` e `signMessage` com os bytes da mensagem, depois `phantomVerify` com a assinatura em base58;
  - `needs_signup` → mostra "Vamos criar sua conta";
  - recusa (`{code: 4001}`) → mensagem de cancelamento;
  - "Sou operador" → campo de senha, e o login chama `api.login`;
  - `CreateAccount`:
    - nome inválido → 400 → "Use de 2 a 40 caracteres.", e o campo mantém o texto;
    - `signup_expired` → volta para a Entrada com "Sua sessão expirou, entre de novo.".
- [ ] **Step 2:** `npx vitest run src/pages`. Esperado: FAIL.
- [ ] **Step 3: Implementar.**
  - Base58 no frontend: escrever um codificador de 15 linhas em `phantom.ts`, sem dependência.
  - `AnimatedGradient` em tela cheia atrás da Entrada; versão suave (`opacity: .35` e véu escuro) em Criar conta e Sem Phantom.
  - Os botões principais são `PopButton color="marica"`; o secundário é `default`.
- [ ] **Step 4:** `npx vitest run && npm run build`. Esperado: PASS.
- [ ] **Step 5:** `git commit -m "feat(frontend): Phantom entry, create-account and no-Phantom screens"`

### Task 8: Carteira do visitante e compra

**Files:**
- Modify: `frontend/src/App.tsx`, `frontend/src/pages/CitizenView.tsx`, `frontend/src/components/RechargeDialog.tsx`, `frontend/src/styles.css`
- Test: `frontend/src/pages/CitizenView.test.tsx`, `frontend/src/components/RechargeDialog.test.tsx`

**Interfaces:**
- Consumes: `api.me()`, `api.publicStatus()` e `PopButton`/`AnimatedGradient`.
- Produces:
  - `CitizenView({ visitor?: UserDTO })`. Com `visitor`, não busca `/api/users`, não mostra o seletor e usa `visitor.id`;
  - `RechargeDialog` ganha `audience?: 'operator' | 'visitor'`, cujo padrão é `allowSimulate ? 'operator' : 'visitor'` (os testes atuais continuam valendo);
  - com `audience='visitor'` e `allowSimulate`, o botão de pagar diz "Pagar agora (demonstração)".

- [ ] **Step 1: Testes que falham**:
  - `CitizenView` com `visitor` não chama `api.users` e não renderiza `select`;
  - mostra a dica "Seus Mum+ aparecem na Phantom quando ela está na rede de testes (Devnet)";
  - com `publicStatus` → `visitorPurchasesOpen: false`, o botão "＋ Comprar Mum+" fica desabilitado e aparece "Compras de demonstração pausadas no momento. Tente mais tarde.";
  - `RechargeDialog` com `audience="visitor" allowSimulate` mostra o título "Comprar Mum+ via Pix" e o botão "Pagar agora (demonstração)";
  - o erro `daily_limit` mostra "Você atingiu o limite de compras de hoje.";
  - o erro `open_payment` mostra "Você já tem uma compra aguardando pagamento.";
  - o erro `purchases_closed` mostra a mensagem de pausa.
- [ ] **Step 2:** `npx vitest run`. Esperado: FAIL.
- [ ] **Step 3: Implementar.**
  - App do visitante: topo com a marca, "Olá, <nome>" e "Sair" (`api.logout` + `phantom.disconnect()` se houver), **sem** abas.
  - `AnimatedGradient` suave atrás do topo da carteira.
  - `PopButton color="marica"` em "＋ Comprar Mum+" e nos botões do diálogo; o provider é `simulated`.
  - Com `prefers-reduced-motion`, o gradiente recebe `speed: 0`.
  - O operador continua com o app e os botões atuais.
- [ ] **Step 4:** `npx vitest run && npm run build`. Esperado: PASS.
- [ ] **Step 5: Verificação visual.**
  - Rodar o backend local (`backend/.env`) com o Vite e abrir no navegador do app.
  - Conferir que o PopButton tem a borda inferior grossa e afunda ao clicar.
  - Conferir que o gradiente se move atrás da Entrada.
  - Conferir que nenhum estilo C2 (`input`, `body`) apagou os utilitários (Review Focus 5).
  - Tirar screenshots a 375 px e a 1280 px.
- [ ] **Step 6:** `git commit -m "feat(frontend): visitor wallet and purchase flow with Spell UI"`

### Task 9: Documentação e variáveis no Railway

**Files:**
- Modify: `README.md`, `README.en.md`, `docs/demo-runbook.md`

- [ ] **Step 1: README PT e EN.** Adicionar a seção "Teste você mesmo" / "Try it yourself", com:
  - o link `https://mumbuca-plus-production.up.railway.app`;
  - os passos: Phantom em Devnet → Entrar com Phantom → Criar conta → ＋ Comprar Mum+ → Pagar agora (demonstração) → ver na Phantom e no Explorer;
  - a frase "nenhum dinheiro real; Solana devnet";
  - os limites, em uma linha.
  - Na seção de arquitetura, uma linha sobre o login por assinatura (SIWS) e o escopo por papel.
- [ ] **Step 2:** `docs/demo-runbook.md`. Caminho principal = Simulado. Roteiro da banca:
  - **operador:** senha;
  - **visitante:** Phantom;
  - **o que fazer se aparecer "compras pausadas":** recarregar SOL da emissora e conferir `VISITOR_SIGNIN_ENABLED`.
- [ ] **Step 3: Verificação final.** Rodar `cd backend && npx vitest run && npm run build` e `cd frontend && npx vitest run && npm run build`. Esperado: tudo passa, e o build gera tudo.
- [ ] **Step 4:** `git commit -m "docs: try-it-yourself (Phantom devnet) and updated demo runbook"`

Depois do merge, nada precisa ser configurado no Railway, porque os padrões valem. A carteira emissora precisa ter SOL suficiente: cada emissão nova gasta cerca de 0,004 SOL.
