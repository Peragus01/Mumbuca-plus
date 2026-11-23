# Provedor OZAV

Implementação: `backend/src/providers/ozav/` (`ozav-client.ts` transporte HTTP, `ozav-signature.ts` webhook,
`ozav-provider.ts` regras). Adaptado do código da Peragus (branch `feat/brs-purchase`): `ozav-client.ts`
(autenticação `X-API-Key`, JSON, timeout), `ozav-brs.ts`/`brs-progression.ts` (cotação, transferência, leitura de
status/perna de origem/`amounts.source`) e `customer-event.ts` (assinatura de webhook). Nada do ledger Solana/BRS,
onboarding ou Supabase da Peragus foi copiado.

## Corredor

**Somente BRL → BRS**, em sandbox e live (`OZAV_TARGET_CURRENCY=BRS`, `OZAV_TARGET_CHAIN` padrão `solana`).
Nenhum outro ativo é usado.

## Variáveis de ambiente

| Variável | Uso |
|---|---|
| `PROVIDER_ENV` | `sandbox` ou `live`; a chave precisa ter o prefixo correspondente (`ozav_sk_test_` / `ozav_sk_live_`), validado no `loadEnv` e na fábrica |
| `OZAV_BASE_URL` | padrão `https://developers.ozav.io/v2` |
| `OZAV_API_KEY` | enviada no header `X-API-Key`; nunca aparece em mensagens de erro nem logs |
| `OZAV_CUSTOMER_ID`, `OZAV_WALLET_ID` | cliente e carteira de destino |
| `OZAV_WEBHOOK_SECRET` | segredo completo do endpoint (`ozav_whsec_...`); opcional (sem ele, `verifyWebhook` rejeita tudo) |
| `OZAV_TARGET_CURRENCY`, `OZAV_TARGET_CHAIN` | `BRS` / `solana` |

## Fluxo

- `createCharge`: `POST /quotes` (BRL → BRS, `source_rail: pix`, `spread_bps: 0`, `Idempotency-Key: <paymentId>:quote`)
  e `POST /transfers` (`Idempotency-Key: <paymentId>`, `metadata.mumbuca_payment_id`). Só `201` na transferência é
  sucesso; qualquer outro resultado vira `ProviderUnavailableError` e o processador recupera por metadata com
  `findChargeByPaymentId` (`GET /transfers?customer_id=`, paginado por `starting_after`, até 20 páginas).
- `fetchPayment`: `GET /transfers/{id}`. Pago = status em `payment_confirmed|converting|payout_initiated|completed`
  **ou** `source_leg.status = completed`. Valor = `amounts.source.amount` com moeda `BRL`, via `parseBrlToCents`
  (centavos truncados, nunca arredondados; campo inválido vai para `review`). `failed|cancelled` rejeitado,
  `expired` expirado, `awaiting_payment` pendente, `needs_review`/desconhecido `review`.
- `simulatePayment`: `POST /transfers/{id}/simulate`, somente com `env = sandbox`.

## Webhook

Header `X-OZAV-Signature: t=<unix>,v1=<hex>`; HMAC-SHA256 com o segredo completo sobre `` `${t}.` + corpo bruto ``,
comparação em tempo constante, janela de ±300 s. `X-OZAV-Event-ID` deve ser igual ao `id` do envelope. Eventos
`transfer.updated|transfer.completed|transfer.failed` devolvem o id da transferência e
`metadata.mumbuca_payment_id`; outros tipos (ex.: `customer.updated`) são ignorados. O corpo do evento é só
notificação: o estado real vem de `fetchPayment`.

Suposições a confirmar com a OZAV: o formato de `data` nos eventos de transferência (o código aceita o objeto da
transferência em `data` ou em `data.transfer`); a sequência de estados do corredor BRS; e se o campo `livemode`
do envelope deve ser conferido contra `PROVIDER_ENV`.

## Limitação `webhooks:write`

Na Peragus, o registro do endpoint de webhook exige a permissão `webhooks:write` na chave e possível habilitação no
provedor; isso não foi verificado para a chave deste projeto. Sem webhook, o reconciliador por polling
(`fetchPayment`) continua cobrindo todos os casos.

## Sonda do corredor BRS no sandbox (pendente)

`npm run probe:ozav -w backend` (`backend/scripts/ozav-brs-probe.ts`) cota R$ 1.000 BRL → BRS e, se aceito, cria a
transferência e chama `simulate`, imprimindo só os status (nunca a chave). **Ainda não foi executada**: não há chave
sandbox da OZAV nesta máquina. Executar uma vez quando o dono fornecer a chave sandbox e registrar aqui o resultado.

A Peragus registrou anteriormente "indisponível para este corredor" para BRL → BRS no sandbox. Se isso se repetir,
registrar a resposta aqui, avisar o dono e usar o provedor `SIMULADO` como caminho garantido da demo (sem
introduzir outro ativo).
