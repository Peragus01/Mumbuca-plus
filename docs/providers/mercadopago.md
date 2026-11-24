# Provedor Mercado Pago (stub)

Status: **não implementado neste MVP**. `createMercadoPagoProvider()` (`backend/src/providers/mercadopago-provider.ts`)
lança `Error('Mercado Pago não implementado neste MVP')` em todos os métodos. Este documento lista o que uma
integração real exigiria. Só foram confirmadas (em 2026-11-23) as páginas listadas como "verificadas"; detalhes de
endpoints e campos não verificados devem ser confirmados na documentação oficial antes de implementar.

Ponto de entrada geral: <https://www.mercadopago.com.br/developers>

## O que uma integração real precisa

1. **Credenciais e aplicação** no painel "Suas integrações" (access token de teste e de produção, chave secreta
   do webhook). Páginas específicas de credenciais: a confirmar a partir do ponto de entrada acima.
2. **Criar a cobrança Pix** pela Checkout API / Payments API, enviando o `paymentId` do Mumbuca+ como
   `external_reference` (equivalente ao `metadata.mumbuca_payment_id` da OZAV) e uma chave de idempotência.
   Retornar o código copia-e-cola e a expiração ao `PaymentProvider.createCharge`.
   - Visão geral (verificada): <https://www.mercadopago.com.br/developers/pt/docs/checkout-api-payments/overview>
   - Pix (verificada, via link da visão geral): <https://www.mercadopago.com.br/developers/pt/docs/checkout-api-payments/integration-configuration/integrate-pix>
3. **Consultar o pagamento** (`fetchPayment`) com `GET /v1/payments/{id}` e mapear `status` (`pending`, `approved`,
   `rejected`, `cancelled`, ...) e `transaction_amount` para `ProviderPaymentState`, tratando valor em reais com
   `parseBrlToCents`. A página de referência exata dessa API **não foi verificada**: confirmar a partir do ponto de
   entrada geral.
4. **Webhook com verificação de `x-signature`** (`verifyWebhook`): header no formato `ts=...,v1=...`, validado com
   a chave secreta da aplicação, usando também `x-request-id` e o `data.id` da notificação; depois buscar o
   recurso na API (a notificação não é fonte de verdade do pagamento). Os passos exatos do HMAC para
   implementação manual não estão detalhados na página consultada; confirmar antes de implementar.
   - Webhooks (verificada): <https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks>
5. **Recuperação após POST incerto** (`findChargeByPaymentId`): busca de pagamentos por `external_reference`
   (endpoint de busca a confirmar na documentação).
6. **Sem equivalente de `simulatePayment`** confirmado; testes usariam contas e cartões/Pix de teste da própria
   documentação.
7. Expandir `ProviderEnv`/limites de recarga em `rechargeLimits` e a configuração (`env.ts`) para as credenciais.
