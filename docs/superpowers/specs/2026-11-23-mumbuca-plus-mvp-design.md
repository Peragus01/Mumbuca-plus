# Mumbuca+ MVP — Design: pagamento liquidado → DvP automático na Solana

Data: 2026-11-23 · Revisão 2 (mesma data): **pivô Polygon → Solana**, decidido pelo dono · Status: aguardando aprovação da revisão · Prazo: 3 dias até a apresentação

> **Revisão 2.** A versão aprovada usava ERC-20 na Polygon Amoy com deploy pelo Remix. O dono decidiu **Solana only**, com o token emitido por um **programa Anchor próprio**. Toda a rota (BRL → BRS → Mum+) passa a ficar numa única rede. Tudo o que não depende da rede continua como aprovado: provedores, OZAV, máquina de estados, idempotência, dashboard e segurança.

## 1. Intenção e porquê

Esta é uma prova de conceito técnica para a apresentação presencial (PPT + site aberto ao vivo) da proposta acadêmica **Mumbuca+**, baseada no relatório "Renda Básica de Cidadania — Mumbuca" (Faculdade Sebrae, 2026). O relatório propõe modernizar a moeda social de Maricá com carteira dupla, POS próprio, IA e operação sem papel. A única menção a tokenização é a "carteira dupla tokenizada".

O MVP prova a **fundação** sob esses módulos: dinheiro real que entra por uma instituição de pagamento vira saldo digital rastreável e auditável, com entrega contra pagamento (DvP) e sem emissão duplicada. O repositório também serve para evidenciar o conhecimento regulatório, de mercado financeiro, de compliance e de web3 do dono (ver README).

História contada: **uma cidadã faz uma recarga em BRL via Pix. Quando o parceiro de liquidez confirma a liquidação do BRL, o sistema emite automaticamente Mumbuca+ (1 Mum+ = R$ 1,00) na carteira Solana dela (Phantom), com assinatura verificável no Solana Explorer (devnet).**

## 2. Objetivos, não-objetivos, anti-objetivos

**Objetivos**
- Token SPL (Token-2022) "Mumbuca+" (Mum+) emitido por um **programa Anchor** implantado na **Solana devnet**.
- Backend que detecta a liquidação do BRL na OZAV, valida consultando a API da OZAV e chama `mint_for_payment` automaticamente.
- Quantidade emitida igual ao valor BRL efetivamente recebido (1:1), sem duplicidade mesmo com reenvios, timeouts de RPC, expiração de blockhash ou reinícios.
- Dashboard com aparência de produto real:
  - visão da cidadã: saldo, recarga e histórico;
  - visão do operador: todos os pagamentos, estados, assinaturas e simulação.
- Dois caminhos de demonstração:
  - **OZAV sandbox**, o caminho garantido;
  - **Pix real de R$ 11 na OZAV live**, o ponto alto, se passar no ensaio.
- Mais um fallback de simulação local.

**Não-objetivos**
- Conversão BRL→BRS ou qualquer lógica de BRS. O BRS fica do lado do parceiro; o Mumbuca+ só observa a liquidação do BRL.
- Integração real com Mercado Pago. Só o adaptador fica desenhado, sem chamadas (ver §6.3).
- KYC/onboarding por pagador, resgate de Mum+ em reais, mainnet, carteira dupla, crédito externo, POS e IA.
- Restrição de transferências a carteiras credenciadas (transfer hook). Fica como fase futura citada no README.
- Dados reais de beneficiários ou do CadÚnico.

**Anti-objetivos (falha mesmo que "funcione")**
- Emitir duas vezes para o mesmo pagamento.
- Emitir com base apenas no corpo de uma notificação, sem confirmar na API do provedor.
- Chave privada fora do backend: nunca no frontend, nunca no repositório.
- Alterar o repositório ou o deploy da Peragus.
- Desconhecidos conseguindo criar recargas ou disparar emissões pela URL pública.

## 3. Restrições

- **Solana devnet.** O programa é escrito em Rust com **Anchor 1.2.0**, o toolchain que já está instalado no WSL Ubuntu do dono: Anchor CLI 1.2.0, solana-cli 4.1.2 e rustc 1.99.
- **Deploy manual pelo dono.** Ele segue um tutorial passo a passo e usa a Anchor CLI no WSL. O WSL já tem uma keypair de devnet em `~/.config/solana/id.json`.
- Carteira da cidadã: **Phantom**, configurada para devnet.
- Backend em Node.js 22 + TypeScript; frontend em React + TypeScript + Vite. O backend fala com a Solana via `@solana/web3.js` v1, a mesma família usada pela Peragus. O cliente do programa usa o IDL gerado pelo Anchor.
- Repositório GitHub novo e separado (`Peragus01/Mumbuca-`). O código da Peragus é fonte de cópia, não dependência.
- Prazo: 3 dias.
- Sem aviso fixo de "ambiente de teste" na tela, por decisão do dono. A origem de cada pagamento continua visível na visão do operador.
- Mínimo de recarga:
  - R$ 11,00 no live (mínimo OZAV de R$ 10 + R$ 1 de taxa);
  - no sandbox da OZAV, o Pix aceita só de R$ 1.000 a R$ 10.000.
  - Por isso o mínimo e o máximo são definidos **por ambiente** e configuráveis.
- O corredor OZAV é **somente BRL→BRS**, por decisão do dono. Nenhum outro ativo entra no projeto.

## 4. Abordagens consideradas

**Como construir o sistema:**

| | Abordagem | Troca | Decisão |
|---|---|---|---|
| **A** | Repositório novo, copiando só as peças úteis da Peragus | Algumas horas de esqueleto; código enxuto e próprio | **Escolhida pelo dono** |
| B | Copiar o backend Peragus inteiro e podar | Arrasta 61 migrações, KYC, saques e Supabase | Descartada |
| C | A Peragus detecta o pagamento e chama o Mumbuca+ | Mexe no backend Peragus em uso | Descartada |

**Como o token existe na Solana (revisão 2):**

| | Abordagem | Troca | Decisão |
|---|---|---|---|
| **A** | **Programa Anchor próprio**: autoridade de emissão numa PDA; um recibo PDA por pagamento (dedup on-chain); teto, limite por emissão, pausa e papéis no programa | Mais trabalho em Rust; preserva on-chain as garantias de DvP e exactly-once | **Escolhida pelo dono** |
| B | Token SPL padrão com o backend como autoridade de emissão; dedup no banco + memo | Mais rápido; a rede não impõe dedup, teto nem pausa | Descartada |

## 5. Arquitetura

```
 Navegador (React/Vite, servido pelo backend)             Phantom da cidadã
   ├─ Visão Cidadã: saldo Mum+, Recarregar, histórico              ▲
   └─ Visão Operador: pagamentos, estados, assinaturas, simular    │ Mum+ (Token-2022)
            │ HTTPS (sessão por login)                             │
            ▼                                                      │
 Backend Fastify (1 serviço Railway)                               │
   ├─ PaymentProvider (interface)                                  │
   │    ├─ OzavProvider (sandbox | live, pela chave)               │
   │    ├─ SimulatedProvider (local, "SIMULADO")                   │
   │    └─ MercadoPagoProvider (stub não implementado)             │
   ├─ POST /webhooks/payments  → verifica assinatura → RECEIVED    │
   ├─ Reconciler (loop a cada N s) → consulta provedor             │
   ├─ PaymentProcessor (máquina de estados, 1 por vez)             │
   ├─ WalletRegistry (endereços Solana base58)                     │
   ├─ TokenGateway Solana (keypair do minter só no servidor) ──────┤
   └─ Postgres (Railway)                                           │
                                                                   │
 Programa Anchor mumbuca_plus + mint Token-2022 na devnet ─────────┘
```

O sistema tem um único serviço (API, processador e arquivos estáticos do frontend) e um Postgres, ambos no Railway. Não há fila externa: os pagamentos são processados um por vez, no mesmo processo.

### 5.1 Programa Anchor `mumbuca_plus`

**Contas:**
- `Config`, PDA `["config"]`. Campos:
  - papéis: `admin`, `minter` e `pauser` (Pubkey);
  - `mint` (Pubkey);
  - limites: `cap` (u64, em unidades), `max_mint_per_tx` (u64), `total_minted` (u64);
  - `paused` (bool) e `bump`.
- **Mint Token-2022**, PDA `["mint"]`:
  - decimals **2**, de modo que 1 unidade = R$ 0,01. Os centavos viram unidades na proporção 1:1 e o u64 comporta o teto com folga;
  - autoridade de emissão: a PDA `Config`; sem autoridade de congelamento;
  - extensões **MetadataPointer + TokenMetadata**: name `Mumbuca+`, symbol `Mum+` e uri configurável (vazia por padrão). Assim a Phantom exibe nome e símbolo.
- `PaymentReceipt`, PDA `["receipt", payment_ref]` (`payment_ref: [u8; 32]`). Campos: `payment_ref`, `recipient`, `amount` (u64), `slot` (u64) e `bump`.
  - Ela é criada com `init`. Uma segunda emissão com o mesmo `payment_ref` falha porque a conta já existe: é a **dedup on-chain**.

**Instruções:**
- `initialize(cap: u64, max_mint_per_tx: u64, minter: Pubkey, pauser: Pubkey, uri: String)`
  - O signatário vira `admin`.
  - Cria a `Config`, o mint Token-2022 com metadata e define `total_minted = 0`.
  - Valores propostos: cap `1_000_000_000` (10.000.000 Mum+) e `max_mint_per_tx` `2_000_000` (20.000 Mum+).
- `mint_for_payment(payment_ref: [u8; 32], amount: u64)`. Validações:
  - o signatário é o `config.minter`;
  - `!paused`;
  - `amount > 0` e `amount <= max_mint_per_tx`;
  - `total_minted + amount <= cap`, com aritmética checada.
- Efeitos de `mint_for_payment`, nesta ordem:
  1. `init` do `PaymentReceipt`.
  2. Cria a ATA Token-2022 do destinatário se não existir (`init_if_needed`, pago pelo minter).
  3. `mint_to` assinado pela PDA `Config`.
  4. `total_minted += amount`.
  5. `emit!(MintedForPayment { recipient, amount, payment_ref, slot })`.
- Administração:
  - `set_minter(new)` e `set_pauser(new)` são só do admin;
  - `set_max_mint_per_tx(v)` é só do admin e exige `v > 0`;
  - `pause()` e `unpause()` são só do pauser.
- **A pausa bloqueia só `mint_for_payment`.** As transferências de Mum+ continuam funcionando, porque o programa não intercepta transferências.

**Erros (`#[error_code]`):** `Unauthorized`, `Paused`, `InvalidAmount`, `ExceedsMaxPerTx`, `CapExceeded`, `MathOverflow`. Um `payment_ref` repetido aparece como falha de criação de conta já existente; o backend trata esse caso como `PaymentRefAlreadyUsed`.

**`payment_ref`:** `keccak256(utf8("<provider>:<providerPaymentId>"))`, 32 bytes, calculado pelo backend como na versão aprovada.

**Testes do programa:** em Rust, com `cargo test` no WSL, usando LiteSVM ou o harness que o Anchor 1.2 recomendar, rodando o `.so` compilado. Os casos estão em §9.

**Deploy e inicialização pelo dono**, seguindo `docs/solana-deploy.md`:
1. `anchor build` e `anchor deploy --provider.cluster devnet` no WSL.
2. Script `initialize`, com admin = keypair CLI do dono e minter = keypair operacional do backend (só em `.env`/Railway).
3. Emissão manual de teste.
4. Conferência no Solana Explorer.
5. Opcional: build verificável (`anchor build --verifiable`) para verificação pública do programa.

### 5.2 Modelo de dados (Postgres)

- `users`:
  - `id` (uuid);
  - `handle`, um identificador fictício como "maria.demo";
  - `display_name` fictício;
  - `wallet_address`: **chave pública Solana em base58**, validada e única;
  - `created_at`.
- `payments`:
  - `id` (uuid), que também é o `Idempotency-Key` e a `metadata.mumbuca_payment_id` na OZAV;
  - `user_id`, `provider`, `provider_env`;
  - `provider_payment_id`, único por provedor;
  - `requested_amount_cents` e `received_amount_cents`;
  - `status`, `pix_br_code` e `pix_expires_at`;
  - `payment_ref` (hex de 32 bytes, único);
  - **`mint_amount_units`** (texto), **`tx_signature`** (base58) e **`slot`**;
  - `needs_review`, `amount_mismatch`, `failure_reason`, `last_error`, `attempts` e timestamps.
- `payment_events`: log append-only de transições e eventos do provedor (dedup por id do evento), com o corpo original para auditoria.

Valores monetários ficam sempre em **centavos inteiros**. Na conversão para o token, **`amount_units = cents`**, porque o token tem 2 decimais.

### 5.3 Máquina de estados

```
RECEIVED → VALIDATING → APPROVED → MINT_PENDING → MINTED
    └──────────┴────────────┴───────────┴────────→ FAILED
```

- **AWAITING_PAYMENT** vem antes de RECEIVED: é a cobrança criada, aguardando o Pix.
- **RECEIVED**: chegou um sinal.
- **VALIDATING**: o backend faz `GET` no provedor. Nunca confia no corpo do webhook.
- **APPROVED**: o BRL está liquidado e confere com a referência, a carteira e o mínimo.
- **MINT_PENDING**: a transação foi enviada. A **assinatura é gravada antes de aguardar a confirmação**.
- **MINTED**: a transação foi confirmada com commitment `confirmed`; o slot é gravado.
- **FAILED**: sempre com motivo. Os casos são:
  - pagamento rejeitado, expirado ou cancelado;
  - valor abaixo do mínimo;
  - carteira inexistente;
  - metadata que não confere;
  - erro definitivo do programa após as tentativas.
- Falhas transitórias **não** vão para FAILED: RPC fora, timeout, 5xx do provedor, blockhash expirado ou falta de SOL na carteira emissora. O pagamento fica no estado atual e o reconciler tenta de novo.

As transições são guardadas no banco com update condicional pelo estado anterior.

### 5.4 Idempotência e recuperação (camadas)

1. **Webhook:** dedup pelo id do evento do provedor.
2. **Pagamento:** `provider_payment_id` único e transição condicional de estado.
3. **Emissão:** antes de reenviar depois de timeout ou resultado incerto, o backend:
   - consulta a **existência da PDA `PaymentReceipt`** e o status da assinatura gravada;
   - se a PDA existe, marca MINTED e recupera a assinatura pela primeira transação da PDA (`getSignaturesForAddress`);
   - se a PDA não existe e o blockhash da transação gravada já expirou, reenvia com segurança.
4. **Programa:** o `init` da PDA `PaymentReceipt` faz qualquer duplicata falhar. É a garantia final, imposta pela rede.

### 5.5 Valor pago × valor emitido

Sem mudança em relação à versão aprovada:
- Emite-se o valor BRL efetivamente recebido, `amounts.source` (BRL) da transferência OZAV.
- Uma divergência entre o valor solicitado e o recebido não bloqueia a emissão: ela é emitida e sinalizada ao operador.
- Um valor abaixo do mínimo leva a FAILED (`amount_below_minimum`).
- Transferência `failed`, `cancelled` ou `expired` com a perna de origem concluída vai para **revisão** e não emite.

## 6. Provedores

Sem mudança em relação à versão aprovada: interface `PaymentProvider`, OZAV (BRL→BRS, conta OZAV da Peragus autorizada pelo dono, webhook HMAC e reconciler), Mercado Pago como stub e SimulatedProvider.

Na OZAV, o destino da transferência continua sendo a carteira gerenciada da conta na Solana. O Mum+ é emitido à parte, pelo programa.

## 7. Dashboard

Login único de demonstração; visual de app real; sem faixa de "teste".

**Visão Cidadã:** igual à versão aprovada, com estas diferenças:
- endereço Solana abreviado (`7xKX…9fQa`);
- saldo lido da ATA Token-2022 pelo backend;
- link "ver na rede" para `https://explorer.solana.com/tx/<assinatura>?cluster=devnet`.

**Visão Operador:** igual à versão aprovada, com estas diferenças:
- assinatura com link para o Solana Explorer (devnet);
- cadastro de usuários com endereço Solana;
- **saldo de SOL da carteira emissora**, com alerta se estiver baixo.

## 8. Segurança

- **Keypair do minter:**
  - só em variável de ambiente do Railway (`MINTER_SECRET_KEY`);
  - carteira dedicada, com SOL de devnet;
  - nunca no frontend nem no git.
- Admin e pauser são a keypair CLI do dono, separada da carteira do backend.
- `max_mint_per_tx`, o teto e a pausa limitam o dano de um vazamento.
- **Webhook e login:** iguais à versão aprovada.
- Só chaves públicas Solana válidas entram no registro de carteiras.

## 9. Testes (TDD obrigatório)

**Programa** (Rust, `cargo test` no WSL):
- `initialize` cria a config e o mint com 2 decimais, name e symbol.
- O minter emite o valor certo, cria a ATA e registra o recibo.
- O mesmo `payment_ref` falha na segunda vez.
- Quem não é minter recebe `Unauthorized`.
- A pausa bloqueia a emissão, mas as transferências continuam.
- Quem não é pauser não pausa.
- `ExceedsMaxPerTx`, `CapExceeded` e `InvalidAmount` são cobertos.
- O admin troca o minter, e o minter antigo deixa de emitir.

**Backend:** mesmos casos da versão aprovada, adaptados à Solana:
- blockhash expirado sem recibo leva a reenvio;
- "transação enviada, resposta perdida" é recuperada pela PDA;
- falta de SOL fica em APPROVED com `last_error`.

**Integração de cadeia:** o TokenGateway roda contra um `solana-test-validator` local (no WSL) com o programa carregado.

**Ponta a ponta manual:** ensaio com sandbox, simulado e live de R$ 11.

## 10. Plano de demonstração e contingência

1. Login e visão da cidadã com o saldo atual.
2. **Caminho garantido:**
   - recarga OZAV sandbox de R$ 1.000;
   - o operador clica em "Simular pagamento";
   - os estados avançam e os Mum+ aparecem na Phantom (devnet);
   - abrir a transação no Solana Explorer.
3. **Ponto alto:** recarga de R$ 11 com Pix real e emissão automática.
4. **Idempotência:** clicar em "Reprocessar" e mostrar que nada é emitido de novo. Mostrar também a PDA de recibo do pagamento no explorador.
5. **Contingência:**
   - OZAV fora: usar o `SIMULADO`;
   - sem internet: vídeo gravado no PPT.

Ensaio na véspera: SOL de devnet na carteira emissora, programa implantado e inicializado com o minter correto, chaves OZAV certas por ambiente e Pix real de R$ 11 testado.

## 11. Cronograma (3 dias, replanejado)

- **Dia 1:**
  - remover o código EVM;
  - programa Anchor com testes;
  - tutorial de deploy;
  - o dono implanta na devnet;
  - adaptar o domínio do backend à Solana.
- **Dia 2:**
  - TokenGateway Solana com integração local;
  - processador, reconciler e API;
  - deploy no Railway.
- **Dia 3:** dashboard, ensaios e vídeo de contingência.

## 12. Dependências externas (bloqueiam a demo)

- **Solana devnet:**
  - SOL na keypair CLI do dono (deploy e inicialização) e na carteira emissora;
  - o airdrop de devnet tem limite: usar o faucet oficial se o `solana airdrop` falhar;
  - RPC de devnet público ou de um provedor com chave.
- **OZAV:**
  - chave de sandbox + `OZAV_CUSTOMER_ID`/`OZAV_WALLET_ID`;
  - para o ponto alto, chave live + IDs live;
  - segredo de webhook (opcional).
- **Infraestrutura:** conta Railway (projeto novo + Postgres).
- **Carteira:** Phantom instalada e em devnet no notebook da apresentação.

## 13. Deixado ao construtor

Fica com quem implementa:
- estrutura interna de pastas e nomes de módulos;
- biblioteca de UI;
- intervalos de polling e de backoff;
- formato de logs;
- escolha do harness de teste Rust compatível com Anchor 1.2;
- escolha do RPC de devnet.
