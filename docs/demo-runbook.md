# Runbook de implantação e demonstração do Mumbuca+

Documento para o dono do projeto. Cobre o deploy no Railway, a checklist da véspera, o roteiro da apresentação, as contingências e a gravação do vídeo reserva. O deploy do programa na Solana devnet está em [solana-deploy.md](solana-deploy.md).

Nenhum valor de segredo aparece aqui. Preencha as variáveis **somente no painel do Railway** (ou no `.env` local, que está no `.gitignore`), nunca no chat nem no git.

## 1. Deploy no Railway

O repositório já traz `railway.json` (build `npm ci --include=dev && npm run build`, start `npm start`, healthcheck `GET /api/session`) e `.node-version` (Node 22). O servidor escuta em `0.0.0.0` na porta `PORT` (o Railway injeta `PORT`).

1. Crie o projeto `mumbuca-plus` no Railway e um serviço apontando para o repositório GitHub (raiz do repositório, sem "root directory").
2. Adicione o plugin PostgreSQL. No serviço da aplicação, defina `DATABASE_URL` com a referência à variável do plugin e `DATABASE_SSL=true`.
3. Preencha as demais variáveis da seção 5 no painel. As migrações rodam sozinhas na subida.
4. Gere o domínio público (Settings, Networking). Abra a URL HTTPS: deve aparecer o login.
5. (Opcional) Webhook do parceiro de liquidez: se a chave tiver o escopo `webhooks:write`, registre `https://<domínio>/webhooks/payments` e coloque o segredo retornado em `OZAV_WEBHOOK_SECRET`. Sem isso, o reconciler (polling a cada `RECONCILE_INTERVAL_MS`) cobre a confirmação; só fica um pouco mais lento.
6. Confira os logs: a subida deve mostrar `Server listening`. Se aparecer `startup failed: Invalid environment configuration`, a lista abaixo da mensagem diz quais variáveis faltam ou estão inválidas (os valores nunca são impressos).

Teste local equivalente: `npm ci && npm run build && npm start` na raiz, com um `.env` baseado em `backend/.env.example`. Abra `http://localhost:3000`.

## 2. Checklist da véspera

Marque cada item e anote data e hora.

- [ ] **SOL da minter acima do limite.** O saldo da minter na devnet deve ser maior que `LOW_SOL_THRESHOLD_LAMPORTS` (padrão 100000000 lamports, 0,1 SOL). O painel do operador mostra o saldo e um alerta quando está baixo. Se faltar: `solana transfer <MINTER_PUBKEY> 1 --allow-unfunded-recipient` ou o faucet https://faucet.solana.com.
- [ ] **`config.minter` é a pubkey da minter.** No WSL, na raiz do repositório:
  ```bash
  export SOLANA_RPC_URL=https://api.devnet.solana.com
  export PROGRAM_ID=<program id>
  npm run init:program -w backend -- --verify \
    --admin-keypair ~/.config/solana/id.json --minter <MINTER_PUBKEY> --pauser $(solana address)
  ```
  Deve terminar com `OK: config.admin/minter/pauser match the expected values.`
- [ ] **Programa não pausado.** O painel do operador deve mostrar "Ativo". Se estiver pausado, veja a seção 4.
- [ ] **Phantom em devnet** (Settings, Developer Settings, Testnet Mode, Solana Devnet), com a carteira da cidadã de demonstração e o token Mum+ visível (ele aparece depois da primeira emissão para a carteira; emita um valor de teste se necessário).
- [ ] **Chaves do ambiente certo.** `PROVIDER_ENV=sandbox` com `OZAV_API_KEY` começando com `ozav_sk_test_`, ou `PROVIDER_ENV=live` com `ozav_sk_live_`. O backend recusa subir com combinação errada. `OZAV_CUSTOMER_ID` e `OZAV_WALLET_ID` devem ser do mesmo ambiente.
- [ ] **Railway no ar.** A URL HTTPS abre o login; `GET /api/session` responde `{"authenticated":false}`; o último deploy está ativo.
- [ ] **Variáveis setadas** no serviço: `PROGRAM_ID`, `SOLANA_RPC_URL`, `MINTER_SECRET_KEY`, `DATABASE_URL`, `DEMO_PASSWORD`, `SESSION_SECRET` e as demais da seção 5.
- [ ] **Painel sem alerta de configuração.** O painel do operador não deve mostrar "Configuração on-chain divergente". O backend confere na subida que `config.minter` é a carteira emissora, que `max_mint_per_tx` (2000000) é pelo menos `MAX_RECHARGE_CENTS` e que o programa não está pausado; se algo não bater, o log mostra `ON-CHAIN PROGRAM CONFIG MISMATCH` e o painel lista o problema.
- [ ] **Ensaio sandbox:** recarga de R$ 1.000, Simular, `Emitido`; ver 1.000 Mum+ na Phantom; abrir a transação no Solana Explorer (cluster devnet); clicar em Reprocessar e confirmar que nenhuma nova transação aparece. Anote a assinatura e a PDA de recibo.
- [ ] **Ensaio simulado:** recarga `SIMULADO` de R$ 50, `Emitido`.
- [ ] **Ensaio do visitante:** com a Phantom em Devnet, Entrar com Phantom, Criar conta, ＋ Comprar Mum+ (R$ 11), Gerar Pix, Pagar agora (demonstração); ver os Mum+ na Phantom e no Explorer.
- [ ] **Ensaio live (se houver chave live):** `PROVIDER_ENV=live`, chave e IDs live, `MIN_RECHARGE_CENTS=1100`, `MAX_RECHARGE_CENTS=2000000`; recarga de R$ 11 paga via Pix pelo dono; esperar `Emitido` com 11 Mum+. Se falhar, registre o motivo aqui e use o sandbox como caminho principal.
- [ ] **Vídeo de contingência gravado** (seção 6) e embutido no PPT.
- [ ] Internet do local conferida e plano B (celular como roteador).

## 3. Roteiro da apresentação

O caminho principal é o **Simulado**: nenhum dinheiro real e nenhuma dependência do parceiro de liquidez. Site: https://mumbuca-plus-production.up.railway.app

1. **Operador (senha).** Abra o endereço de acesso do operador (não há link na tela pública; o dono tem o endereço) e entre com `DEMO_PASSWORD`. Mostre o painel: saldo de SOL da minter, estado do programa ("Ativo") e a lista de pagamentos.
2. **Visitante (Phantom).** Em outra janela ou no celular, com a Phantom em Devnet (Settings, Developer settings, Testnet mode, Solana Devnet):
   - clique em **Entrar com Phantom** (assina uma mensagem; nenhuma transação é autorizada);
   - na primeira vez, clique em **Criar conta** e escolha um nome de exibição;
   - clique em **＋ Comprar Mum+**, escolha um valor (R$ 11 a R$ 100) e clique em **Gerar Pix**;
   - clique em **Pagar agora (demonstração)**;
   - os estados avançam até **Emitido** e os Mum+ aparecem na Phantom (Devnet).
3. **Solana Explorer.** Abra a transação no Explorer (cluster devnet) e mostre a **PDA de recibo** do pagamento.
4. **Painel do operador.** Volte ao painel e mostre o pagamento do visitante, com a assinatura e o estado **Emitido**.
5. **Idempotência:** clicar em **Reprocessar** no pagamento já emitido e mostrar que nada novo é emitido (mesma assinatura, saldo igual). Isso demonstra a idempotência do **banco de dados**: o pagamento já está `Emitido` e o backend nem chega a falar com a rede. Para a **prova on-chain**: abrir no Solana Explorer a **PDA de recibo** do pagamento (ela só existe porque a emissão ocorreu) ou, no terminal, repetir `npm run smoke:mint -w backend -- <PUBKEY> 100 <PAYMENT_REF>` com um `payment_ref` já usado (veja [solana-deploy.md](solana-deploy.md), seção 6): a rede rejeita com `PaymentRefAlreadyUsed`, porque a PDA de recibo já existe.
6. **Opcional (parceiro real):** só se o ensaio live passou, recarga de R$ 11 com Pix real, pago ao vivo, com emissão automática. O parceiro de liquidez real (OZAV) é opcional; a demonstração não depende dele.
7. **Contingência** (seção 4): compras pausadas, parceiro fora, sem internet (vídeo gravado).

Limites do visitante: R$ 11 a R$ 100 por compra, 3 compras por carteira a cada 24 h, R$ 2.000 por 24 h somando todos os visitantes, 1 compra pendente por vez. Uma compra não paga expira em 30 minutos.

## 4. Contingências

| Problema | O que fazer |
| --- | --- |
| Visitante vê "compras pausadas" | As compras de visitantes pausam sozinhas quando o SOL da minter está baixo, quando a emissão está pausada, quando a configuração on-chain diverge ou quando `VISITOR_SIGNIN_ENABLED=false`. (1) Recarregue a minter com SOL da devnet: `solana transfer <MINTER_PUBKEY> 1 --allow-unfunded-recipient` ou https://faucet.solana.com (cada emissão nova gasta cerca de 0,004 SOL). (2) Confira `VISITOR_SIGNIN_ENABLED` no painel do Railway (deve ser `true` ou estar ausente). (3) Confira o painel do operador: se mostrar "Pausado", veja a linha do programa pausado; se mostrar "Configuração on-chain divergente", veja a linha seguinte. |
| Parceiro de liquidez fora do ar ou Pix não confirma | Criar a recarga com o provedor `SIMULADO` (R$ 11 a R$ 20.000) e clicar em Simular pagamento. O caminho on-chain é o mesmo. O `SIMULADO` continua disponível mesmo com `PROVIDER_ENV=live` (atrás da senha da demonstração; emite tokens de devnet). A consulta ao parceiro feita pelo reconciler corre fora da fila de processamento, então um parceiro lento não atrasa o `SIMULADO`. |
| Sem internet no local | Passar o vídeo gravado (seção 6) no PPT. |
| SOL da minter baixo (alerta no painel) | Enviar SOL: `solana transfer <MINTER_PUBKEY> 1 --allow-unfunded-recipient` ou faucet https://faucet.solana.com. Pagamentos que falharam por falta de saldo voltam a ser processados pelo reconciler ou por Reprocessar. |
| Programa pausado (painel mostra "Pausado") | Só a keypair `pauser` executa `unpause` (o admin apenas troca o pauser com `set_pauser`). No WSL, com `SOLANA_RPC_URL` e `PROGRAM_ID` exportados: `npm run unpause:program -w backend -- --pauser-keypair <caminho do JSON do pauser>` (para pausar de propósito: `npm run pause:program -w backend -- --pauser-keypair <caminho>`). O script nunca imprime chaves nem a URL do RPC. Depois confira o painel. Pagamentos aprovados durante a pausa ficam aguardando (`token_paused`) e são emitidos depois. |
| Painel mostra "Configuração on-chain divergente" | `config.minter` diferente da carteira emissora, `max_mint_per_tx` menor que a recarga máxima, ou programa pausado. Corrija o deploy (`MINTER_SECRET_KEY` certo, `MAX_RECHARGE_CENTS` <= 2000000, `unpause`) e reinicie o serviço. Pagamentos pagos não falham por isso: ficam `APPROVED` aguardando (`program_unauthorized` ou `program_error`) e são emitidos depois da correção, pelo reconciler ou por Reprocessar. |
| RPC público lento ou com limite | Trocar `SOLANA_RPC_URL` por um RPC de provedor com chave e reiniciar o serviço. |
| Pagamento travado | Reprocessar no painel. Se continuar, olhar os logs do Railway (só aparecem classes de erro, nunca segredos). |
| Webhook não chega | O reconciler cobre. Aguarde até `RECONCILE_INTERVAL_MS`. |

## 5. Variáveis de ambiente

Modelo em `backend/.env.example`. Nenhum valor aqui.

| Variável | O que é |
| --- | --- |
| `DATABASE_URL` | String de conexão do PostgreSQL (no Railway, referência ao plugin). |
| `DATABASE_SSL` | `true` para exigir TLS no Postgres (Railway); `false` no local. |
| `PORT` | Porta HTTP (o Railway injeta; padrão 3000). |
| `DEMO_PASSWORD` | Senha única do login da demonstração (mínimo 12 caracteres). |
| `SESSION_SECRET` | Segredo que assina o cookie de sessão (mínimo 32 caracteres). |
| `SOLANA_RPC_URL` | Endpoint RPC da Solana (devnet). |
| `SOLANA_CLUSTER` | `devnet` ou `localnet` (links do explorer e rótulo no painel). |
| `PROGRAM_ID` | Program id do programa Mumbuca+ implantado. |
| `MINTER_SECRET_KEY` | Chave secreta da minter (array JSON de 64 bytes ou base58). Só no painel do Railway; nunca no git. |
| `PROVIDER_ENV` | `sandbox` ou `live`; define qual prefixo de chave é aceito. |
| `OZAV_BASE_URL` | URL base da API do parceiro de liquidez (tem padrão). |
| `OZAV_API_KEY` | Chave de API do parceiro, do mesmo ambiente que `PROVIDER_ENV`. |
| `OZAV_CUSTOMER_ID` | ID do cliente no parceiro. |
| `OZAV_WALLET_ID` | ID da carteira de liquidação no parceiro. |
| `OZAV_WEBHOOK_SECRET` | Segredo de assinatura dos webhooks (opcional; sem ele os webhooks são rejeitados e o reconciler cobre). |
| `OZAV_TARGET_CURRENCY` | Moeda de destino da rota (fixa em `BRS`). |
| `OZAV_TARGET_CHAIN` | Rede de destino no parceiro (padrão `solana`). |
| `MIN_RECHARGE_CENTS` | Recarga mínima, em centavos. Sandbox: `100000`; live: `1100`. |
| `MAX_RECHARGE_CENTS` | Recarga máxima, em centavos. Sandbox: `1000000`; live: `2000000`. Deve ser no máximo `2000000` (o `max_mint_per_tx` on-chain); um valor recebido acima do máximo vai para revisão e nunca é emitido. |
| `RECONCILE_INTERVAL_MS` | Intervalo do reconciler em ms (padrão 5000). |
| `MINT_CONFIRM_TIMEOUT_MS` | Tempo máximo para confirmar a emissão on-chain (padrão 60000). |
| `RPC_TIMEOUT_MS` | Tempo máximo de cada chamada ao RPC da Solana, em ms (padrão 12000). Uma chamada travada vira erro temporário e é tentada de novo. |
| `MAX_MINT_ATTEMPTS` | Rejeições definitivas do programa (por exemplo `CapExceeded`) antes de o pagamento ser marcado como `FAILED` (padrão 5). Erros temporários de rede não contam. Programa pausado, minter não autorizada (`Unauthorized`) e erros desconhecidos do programa também não contam: o pagamento fica `APPROVED` aguardando a correção. |
| `LOW_SOL_THRESHOLD_LAMPORTS` | Saldo da minter abaixo do qual o painel alerta (padrão 100000000). |
| `VISITOR_MIN_CENTS` | Opcional. Compra mínima do visitante, em centavos (padrão 1100). |
| `VISITOR_MAX_CENTS` | Opcional. Compra máxima do visitante, em centavos (padrão 10000). |
| `VISITOR_MAX_PURCHASES_PER_DAY` | Opcional. Compras por carteira a cada 24 h (padrão 3). |
| `VISITOR_DAILY_CAP_CENTS` | Opcional. Teto de compras somando todos os visitantes em 24 h, em centavos (padrão 200000). |
| `VISITOR_SIGNUPS_PER_IP_PER_DAY` | Opcional. Contas novas por IP a cada 24 h (padrão 5). |
| `VISITOR_SIGNIN_ENABLED` | Opcional. `false` desliga o login e as compras de visitantes (padrão `true`). |
| `LOG_LEVEL` | Opcional: nível de log (padrão `info`). |
| `NODE_ENV` | Em produção use `production` (cookie de sessão seguro, só HTTPS). Local sobre http: `development`. |

## 6. Como gravar o vídeo de contingência

1. Use o ambiente sandbox, com a checklist toda verde. Feche notificações; deixe o navegador em tela cheia e a Phantom em devnet.
2. Grave a tela (OBS Studio, ou Win+Alt+R no Windows) em 1080p, com microfone se for narrar.
3. Siga o roteiro da seção 3: operador com senha, visitante com Phantom (Comprar Mum+, Pagar agora), estados até Emitido, Phantom com o saldo, Solana Explorer com a transação e a PDA de recibo, Reprocessar sem nova emissão. Se o ensaio live passou, inclua o Pix de R$ 11.
4. Mostre a barra de endereço (URL do Railway) e o cluster devnet no explorador; não mostre `MINTER_SECRET_KEY`, chaves de API nem o painel de variáveis do Railway.
5. Exporte em MP4, teste no computador da apresentação sem internet, incorpore ao PPT e guarde uma cópia no celular.
