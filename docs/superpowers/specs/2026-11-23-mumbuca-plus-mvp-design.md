# Mumbuca+ MVP — Design: pagamento confirmado → mint automático na Polygon Amoy

Data: 2026-11-23 · Status: rascunho para aprovação · Prazo: 3 dias até a apresentação

## 1. Intenção e porquê

Prova de conceito técnica para a apresentação presencial (PPT + site aberto ao vivo) da proposta acadêmica **Mumbuca+** (relatório "Renda Básica de Cidadania — Mumbuca", Faculdade Sebrae, 2026). O relatório propõe modernizar a moeda social de Maricá (carteira dupla, POS próprio, IA, paperless); a única menção a tokenização é a "carteira dupla tokenizada". O MVP prova a **fundação** sob esses módulos: dinheiro real que entra por uma instituição de pagamento vira saldo digital rastreável e auditável, sem emissão duplicada.

História contada: **uma cidadã faz uma recarga em BRL via Pix; quando o provedor (OZAV) confirma a chegada do BRL, o sistema emite automaticamente Mumbuca+ (1 M+ = R$ 1,00) na carteira MetaMask dela, com hash verificável na PolygonScan Amoy.**

## 2. Objetivos, não-objetivos, anti-objetivos

**Objetivos**
- Token ERC-20 "Mumbuca+" (M+) implantado na Polygon Amoy (chain 80002) via Remix.
- Backend que detecta a chegada de BRL na OZAV, valida consultando a API da OZAV e executa `mint` automaticamente.
- Quantidade emitida = valor BRL efetivamente recebido (1:1), sem duplicidade mesmo com reenvios, timeouts de RPC ou reinícios.
- Dashboard com aparência de produto real: visão da cidadã (saldo, recarga, histórico) e visão do operador (todos os pagamentos, estados, hashes, simulação).
- Dois caminhos de demonstração: **OZAV sandbox (garantido)** e **Pix real de R$ 11 na OZAV live (ponto alto, se passar no ensaio)**; mais um fallback de simulação local.

**Não-objetivos**
- Conversão BRL→BRS ou qualquer lógica de BRS/Solana (BRS é do lado Peragus/OZAV; o Mumbuca+ só observa a chegada do BRL).
- Integração real com Mercado Pago (apenas o adaptador desenhado, sem chamadas — ver §6.3).
- KYC/onboarding por pagador, resgate/conversibilidade de M+ em reais, mainnet, carteira dupla, crédito externo, POS, IA.
- Dados reais de beneficiários ou CadÚnico.

**Anti-objetivos (falha mesmo que "funcione")**
- Emitir duas vezes para o mesmo pagamento.
- Emitir com base apenas no corpo de uma notificação, sem confirmar na API do provedor.
- Chave privada fora do backend (nunca no frontend, nunca no repositório).
- Alterar o repositório ou o deploy da Peragus.
- Desconhecidos conseguindo criar recargas ou disparar emissões pela URL pública.

## 3. Restrições

- Polygon Amoy, chain ID 80002; Solidity + OpenZeppelin; deploy **manual pelo dono via Remix + MetaMask** (sem Hardhat/Foundry para implantação).
- Backend Node.js 22 + TypeScript; frontend React + TypeScript + Vite.
- Repositório GitHub **novo e separado** (`MumbucaPlus`); código da Peragus é fonte de cópia, não dependência.
- Prazo: 3 dias.
- Sem aviso fixo "ambiente de teste" na tela (decisão do dono: aparência real). A origem de cada pagamento continua visível na visão do operador (ver §7).
- Mínimo de recarga: R$ 11,00 no live (regra Peragus: mínimo OZAV R$ 10 + R$ 1 de taxa). No sandbox da OZAV o Pix aceita apenas R$ 1.000–10.000, então o mínimo/máximo é **por ambiente** e configurável.

## 4. Abordagens consideradas

| | Abordagem | Troca | Decisão |
|---|---|---|---|
| **A** | Repositório novo, copiando só as peças úteis da Peragus (cliente OZAV, verificação HMAC do webhook, "GET como verdade", varredura de eventos) | Algumas horas para montar esqueleto e tabelas; código enxuto e próprio | **Escolhida pelo dono** |
| B | Copiar o backend Peragus inteiro e podar | Começa "pronto", mas arrasta 61 migrações, trava de ambiente amarrada a Solana, KYC, saques, Supabase | Descartada |
| C | Peragus detecta o pagamento e chama o Mumbuca+ só para emitir | Reaproveita o webhook existente, mas exige mexer no backend Peragus em uso e acopla a demo ao deploy dela | Descartada |

## 5. Arquitetura

```
 Navegador (React/Vite, servido pelo backend)            MetaMask da cidadã
   ├─ Visão Cidadã: saldo M+, Recarregar, histórico              ▲
   └─ Visão Operador: pagamentos, estados, hashes, simular       │ Transfer/Minted
            │ HTTPS (sessão por login)                           │
            ▼                                                    │
 Backend Fastify (1 serviço Railway)                             │
   ├─ PaymentProvider (interface)                                │
   │    ├─ OzavProvider (sandbox | live, pela chave)             │
   │    ├─ SimulatedProvider (local, "SIMULADO")                 │
   │    └─ MercadoPagoProvider (stub não implementado)           │
   ├─ POST /webhooks/payments  → verifica assinatura → RECEIVED  │
   ├─ Reconciler (loop a cada N s) → consulta provedor           │
   ├─ PaymentProcessor (máquina de estados, 1 por vez)           │
   ├─ WalletRegistry                                             │
   ├─ MintService (viem, chave MINTER só no servidor) ───────────┤
   └─ Postgres (Railway)                                         │
                                                                 │
 Contrato MumbucaPlus (ERC-20) na Polygon Amoy ──────────────────┘
```

Um único serviço (API + processador + arquivos estáticos do frontend) e um Postgres, ambos no Railway. Sem fila externa: o processamento roda no mesmo processo, um pagamento por vez (evita conflito de nonce com uma única carteira emissora).

### 5.1 Smart contract `MumbucaPlus.sol`

OpenZeppelin Contracts v5:
- `ERC20("Mumbuca+", "M+")`, 18 decimais, supply inicial zero.
- `ERC20Capped(cap)` — cap definido no construtor (proposta: 10.000.000 M+).
- `AccessControl` com papéis: `DEFAULT_ADMIN_ROLE` (MetaMask do dono), `MINTER_ROLE` (carteira operacional do backend), `PAUSER_ROLE` (dono).
- **Pausa só da emissão**, não das transferências: `mint` tem `whenNotPaused` (OZ `Pausable`); `pause()/unpause()` restritos a `PAUSER_ROLE`.
- `mint(address to, uint256 amount, bytes32 paymentRef)`:
  - exige `MINTER_ROLE`, não pausado, `to != 0`, `amount > 0`, `amount <= maxMintPerTx`;
  - **dedup on-chain**: `require(!paymentRefUsed[paymentRef])`, marca como usado;
  - emite `MintedForPayment(to, amount, paymentRef)` além do `Transfer` padrão.
- `maxMintPerTx` ajustável pelo admin (proposta inicial: 20.000 M+) — limita o dano se a chave do minter vazar.
- `paymentRef = keccak256("<provider>:<providerPaymentId>")`, calculado pelo backend.

Testes do contrato: rodados localmente antes do deploy (ver §9). Deploy, concessão de `MINTER_ROLE` ao backend, mint manual de teste e verificação na PolygonScan Amoy (plugin de verificação do Remix com chave da API Etherscan/PolygonScan) são feitos pelo dono seguindo um tutorial passo a passo entregue junto (`docs/remix-deploy.md`).

### 5.2 Modelo de dados (Postgres)

- `users`: `id` (uuid), `handle` (identificador fictício, ex.: "maria.demo"), `display_name` fictício, `wallet_address` (checksum, único), `created_at`.
- `payments`: `id` (uuid, também o `Idempotency-Key` e a `metadata.mumbuca_payment_id` na OZAV), `user_id`, `provider` (`ozav` | `simulated` | `mercadopago`), `provider_env` (`sandbox` | `live` | `local`), `provider_payment_id` (único por provider), `requested_amount_cents`, `received_amount_cents`, `status`, `pix_br_code`, `pix_expires_at`, `payment_ref` (bytes32 hex, único), `mint_amount_wei` (texto), `tx_hash`, `block_number`, `failure_reason`, `attempts`, timestamps.
- `payment_events`: log append-only de cada transição e de cada webhook recebido (id do evento do provedor único → dedup de webhook), com corpo bruto para auditoria.

Valores monetários sempre em **centavos inteiros**; conversão para o token: `amount_wei = cents × 10^16`.

### 5.3 Máquina de estados

```
RECEIVED → VALIDATING → APPROVED → MINT_PENDING → MINTED
    └──────────┴────────────┴───────────┴────────→ FAILED
```
- Antes de RECEIVED o pagamento existe como cobrança criada aguardando Pix (`AWAITING_PAYMENT`, estado de exibição; expira com o Pix).
- **RECEIVED**: chegou sinal (webhook válido ou reconciler viu mudança).
- **VALIDATING**: backend faz `GET` do pagamento no provedor. Nunca confia no corpo do webhook.
- **APPROVED**: provedor confirma BRL recebido (OZAV: `source_leg.status === "completed"` com status de transferência em `payment_confirmed | converting | payout_initiated | completed`), `metadata.mumbuca_payment_id` confere, carteira do usuário existe, valor recebido ≥ mínimo.
- **MINT_PENDING**: tx enviada; hash gravado **antes** de aguardar confirmação.
- **MINTED**: recibo com sucesso (1 confirmação); grava bloco.
- **FAILED**: com motivo (pagamento rejeitado/expirado/cancelado, abaixo do mínimo, carteira inexistente, metadata não confere, revert). Valor recebido diferente do solicitado **não** é falha (ver §5.5). Falhas transitórias (RPC/timeout/5xx do provedor) **não** vão para FAILED: ficam no estado atual e são reprocessadas pelo reconciler com backoff.

Transições guardadas no banco (update condicional por estado anterior) para que webhook e reconciler concorrentes não processem o mesmo pagamento duas vezes.

### 5.4 Idempotência e recuperação (camadas)

1. Webhook: dedup pelo id do evento do provedor (`payment_events`).
2. Pagamento: `provider_payment_id` único; transição condicional de estado.
3. Mint: antes de reenviar após timeout/erro desconhecido, o backend consulta `paymentRefUsed(paymentRef)` no contrato e o recibo do hash gravado. Se já usado → MINTED (recupera hash pelo evento `MintedForPayment`). Se não → reenvia.
4. Contrato: `paymentRefUsed` faz qualquer duplicata reverter — garantia final.

### 5.5 Valor pago × valor emitido

Emite-se o **valor BRL efetivamente recebido** informado pela OZAV na perna de origem: `amounts.source` (moeda BRL) da transferência consultada, isto é, o valor pago no Pix **antes** de qualquer taxa/conversão (*decisão minha*: a taxa da OZAV incide sobre o lado BRS, que está fora do escopo; um Pix de R$ 11 emite 11 M+). O mínimo do ambiente é comparado com esse mesmo valor. Se diferir do valor solicitado: emite o recebido e registra a divergência visível ao operador (não bloqueia). Se o recebido estiver abaixo do mínimo do ambiente → FAILED (`amount_below_minimum`). Taxas do provedor ficam registradas apenas para transparência.

## 6. Provedores

### 6.1 Interface `PaymentProvider`
```
createCharge({paymentId, amountCents, user}) → {providerPaymentId, pixBrCode, expiresAt}
verifyWebhook(rawBody, headers) → {providerPaymentId, eventId} | invalid
fetchPayment(providerPaymentId) → {status: pending|approved|rejected|expired, receivedAmountCents, metadata}
listRecentEvents?(cursor) → eventos (fallback de detecção)
simulatePayment?(providerPaymentId)   // só sandbox/simulated
```
O núcleo (processor, mint) só conhece essa interface.

### 6.2 OZAV (copiado/adaptado da Peragus, branch `feat/brs-purchase`)
- Host `developers.ozav.io`, prefixo `/v2`; header `X-API-Key`; `Idempotency-Key` em POST. A **chave** escolhe o ambiente (`ozav_sk_test_` / `ozav_sk_live_`); o backend recusa subir se a chave não bater com `PROVIDER_ENV`.
- Todos os depósitos entram na **conta OZAV da Peragus** (um `OZAV_CUSTOMER_ID` + `OZAV_WALLET_ID` fixos por ambiente), distinguindo pagadores pela `metadata.mumbuca_payment_id`. Sem KYC por pagador. **Decisão do dono (2026-11-23)**: o uso da mesma conta OZAV da Peragus está autorizado, inclusive para o Pix real de R$ 11; o backend Peragus em produção tolera transferências que não criou. O Mumbuca+ nunca altera nem reage a transferências sem `metadata.mumbuca_payment_id`.
- Cobrança em dois passos, como na Peragus: `POST /v2/quotes` (`source{currency:"BRL",amount}`, `target{currency, chain}`, `source_rail:"pix"`, `spread_bps:0`) e depois `POST /v2/transfers` com `quote_id`, `source {type:"fiat_payment", currency:"BRL", rail:"pix"}`, `destination {type:"wallet", wallet_id, chain}` e `metadata.mumbuca_payment_id`. Corredor único nos dois ambientes: **BRL→BRS** (Solana) para a carteira gerenciada da conta, definido por variável (`OZAV_TARGET_CURRENCY=BRS`). **Decisão do dono (2026-11-23):** nenhum outro ativo entra no Mumbuca+. Só a perna de origem (BRL) dispara a emissão. Validar cedo (Task 6) que o sandbox aceita a cotação BRL→BRS (o registro da Peragus mostra uma resposta "indisponível para este corredor"); se não aceitar, a demonstração garantida usa o provedor `SIMULADO`. Resposta traz `source.payment_instructions.br_code` e `expires_at`. Status aceitos: `awaiting_payment`, `payment_confirmed`, `converting`, `payout_initiated`, `completed`, `failed`, `cancelled`, `expired`, `needs_review` (este último → aguarda e alerta o operador, não emite).
- Fonte do código a copiar: branch local `feat/brs-purchase` do repositório `PeragusSVM` (ler com `git show feat/brs-purchase:<caminho>`): `app/backend/src/providers/ozav-client.ts`, `src/providers/ozav-brs.ts`, `src/webhooks/customer-event.ts`, `src/brs/brs-progression.ts`, `src/application/import-ozav-onramp-events.ts`, e o contrato de campos em `docs/operations/brs-ozav-contract.md`. Remover a regex que só aceita chave de teste e os fixtures Peragus.
- Detecção, em duas vias:
  - **Webhook** `POST /webhooks/payments`: header `X-OZAV-Signature: t=…,v1=…`, HMAC-SHA256 com o segredo `ozav_whsec_…` sobre `"<t>." + corpo bruto`, `timingSafeEqual`, janela ±300 s, `X-OZAV-Event-ID` = `id` do envelope. Eventos `transfer.updated|completed|failed`.
  - **Reconciler** (garantido): a cada ~5 s consulta `GET /v2/transfers/{id}` dos pagamentos abertos (e/ou `GET /v2/events`). Necessário porque a permissão para registrar um webhook novo (`webhooks:write`) não está confirmada.
- Sandbox: botão do operador chama `POST /v2/transfers/{id}/simulate` (pode parar em `payment_confirmed`, o que basta).
- Live: R$ 11 pago pelo próprio dono, via Pix real, para a conta da Peragus.

### 6.3 Mercado Pago
Classe `MercadoPagoProvider` existe com a interface e lança "não implementado". `docs/providers/mercadopago.md` lista o que a integração real exigiria, citando a documentação oficial consultada na implementação. Sem chamadas reais no MVP.

### 6.4 SimulatedProvider
Provedor 100% local para quando a OZAV estiver fora: cria cobrança fictícia; botão do operador marca como aprovada; passa pelo **mesmo** pipeline e gera mint real na Amoy. Rotulado `SIMULADO` na visão do operador.

## 7. Dashboard

Login único de demonstração (senha em variável de ambiente, sessão por cookie httpOnly). Protege toda a URL pública: ninguém de fora cria recargas nem dispara mint. Visual de app real, identidade Mumbuca+, sem faixa de "teste".

**Visão Cidadã** (seletor de usuário fictício no topo):
```
 Mumbuca+                                     [maria.demo ▾]
 ┌────────────────────────────────────────────────────────┐
 │ Saldo  1.011,00 M+          0x8f3…a21c  [copiar]       │
 │ [ Recarregar ]                                         │
 ├────────────────────────────────────────────────────────┤
 │ Histórico                                              │
 │ 23/11 14:02  R$ 11,00  → 11 M+   Emitido  ver na rede ↗│
 │ 23/11 13:40  R$ 1.000  → 1.000 M+ Emitido ver na rede ↗│
 └────────────────────────────────────────────────────────┘
 Recarregar: valor (mín. do ambiente) → QR Pix + copia-e-cola
 → status ao vivo: Aguardando Pix → Pagamento confirmado → Emitindo → Emitido ✓
```
Saldo lido do contrato (`balanceOf`) pelo backend.

**Visão Operador**: tabela de todos os pagamentos — usuário, carteira, origem (`OZAV live` / `OZAV sandbox` / `SIMULADO`), valor solicitado, valor recebido, M+ emitidos, estado, hash com link `https://amoy.polygonscan.com/tx/<hash>`, motivo de falha, divergências; botões "Simular pagamento" (sandbox/simulado) e "Reprocessar" (pagamentos travados); cadastro de usuários de demo (handle fictício + endereço Polygon); saldo de POL da carteira emissora (alerta se baixo).

Atualização por polling curto (~2 s) na tela de recarga em andamento.

## 8. Segurança

- Chave privada do `MINTER_ROLE` só em variável de ambiente do Railway; carteira dedicada, só com POL de teste; nunca no frontend nem no git (`.env` no `.gitignore`, `.env.example` sem valores).
- Admin/pauser = MetaMask do dono, separada da carteira do backend.
- `maxMintPerTx` + cap + pausa limitam o dano de vazamento.
- Webhook: assinatura verificada sobre o corpo bruto, janela de tempo, dedup por event id; corpo nunca usado como verdade.
- Login com senha forte, rate limit no login, cookie `httpOnly`/`secure`/`sameSite`.
- Somente endereços válidos (checksum) no registro de carteiras.

## 9. Testes (TDD obrigatório)

- **Contrato**: suíte local que compila o mesmo `MumbucaPlus.sol` e testa em EVM local — mint correto, cap, `maxMintPerTx`, permissões (não-minter reverte), pausa bloqueia só mint, `paymentRef` repetido reverte, evento emitido. *Decisão minha*: usar Hardhat **apenas como executor de testes local**, nunca para implantação; se o dono preferir, alternativa é solc-js + EVM em memória no vitest.
- **Backend** (vitest + Postgres em memória/PGlite, OZAV e RPC mockados): pagamento rejeitado; expirado; webhook com assinatura inválida/fora da janela; webhook duplicado; carteira inexistente; falha de RPC/timeout no envio e na confirmação; reprocessamento sem duplicar (incluindo "tx enviada, resposta perdida"); valor recebido ≠ solicitado; abaixo do mínimo; webhook e reconciler concorrentes no mesmo pagamento; mint confirmado grava hash e bloco.
- **Ponta a ponta manual**: roteiro de ensaio (sandbox, simulado, live R$ 11) com evidências (prints/hash).

## 10. Plano de demonstração e contingência

1. Login → visão cidadã com saldo atual.
2. **Caminho garantido**: recarga OZAV sandbox (R$ 1.000) → operador clica "Simular pagamento" → estados avançam → M+ aparecem na MetaMask → abrir PolygonScan.
3. **Ponto alto** (se o ensaio live passar): recarga de R$ 11 → pagar o Pix real pelo celular → emissão automática.
4. Mostrar idempotência: reenviar o mesmo evento / clicar "Reprocessar" → nada é emitido de novo.
5. Contingência: OZAV fora → `SIMULADO`; sem internet → vídeo gravado do fluxo completo no PPT.

Ensaio na véspera: POL na carteira emissora, `MINTER_ROLE` concedido, chaves OZAV corretas por ambiente, R$ 11 live testado.

## 11. Cronograma (3 dias)

- **Dia 1**: contrato + testes; tutorial Remix; dono implanta e concede papéis; esqueleto do backend, banco, MintService com testes; mint pelo backend na Amoy. *Decisão minha*: o MintService é desenvolvido e testado contra uma EVM local primeiro, para não depender do horário em que o dono fizer o deploy; a integração na Amoy entra assim que o endereço do contrato e o `MINTER_ROLE` existirem.
- **Dia 2**: PaymentProvider, OZAV (cobrança, webhook, reconciler, simulate), SimulatedProvider, máquina de estados e idempotência com testes; deploy Railway.
- **Dia 3**: dashboard (cidadã + operador), login, ensaio sandbox + live, gravação do vídeo de contingência.

## 12. Dependências externas (bloqueiam a demo)

- POL de teste (faucet Amoy) na carteira do dono e na carteira emissora.
- Chave sandbox OZAV (`ozav_sk_test_…`) + `OZAV_CUSTOMER_ID`/`OZAV_WALLET_ID` de sandbox da conta Peragus.
- Para o ponto alto: **chave live OZAV** + ids live (a documentação da Peragus diz que credenciais live não estão disponíveis no workspace e o live nunca foi exercido ponta a ponta).
- Segredo de webhook OZAV e permissão para registrar endpoint (opcional; o reconciler cobre a ausência).
- Conta Railway (projeto novo + Postgres) e repositório GitHub novo.
- RPC Amoy (público ou provedor com chave) e chave da API PolygonScan/Etherscan para verificação.

## 13. Deixado ao construtor

Estrutura de pastas, nomes de módulos, biblioteca de UI/estilo, intervalos exatos de polling/backoff, formato de logs, escolha de RPC público vs. provedor, detalhes do layout além dos esboços acima.
