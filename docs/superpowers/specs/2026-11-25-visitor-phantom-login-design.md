# Conta de visitante com login pela Phantom

Data: 2026-11-25 · Status: rascunho para aprovação do dono · Tamanho: projeto (backend + frontend)

## Intenção

O Mumbuca+ vai para o **portfólio** do dono. Qualquer pessoa com uma carteira Phantom na Solana **devnet** precisa conseguir testar o produto de ponta a ponta, sem pedir senha a ninguém:

1. criar uma conta;
2. comprar Mum+ (pagamento simulado);
3. ver os Mum+ chegarem de verdade na própria carteira, na devnet.

A banca e o dono continuam entrando como **operador**, com a senha atual (`DEMO_PASSWORD`), e veem tudo.

Hoje o site tem uma senha única. Quem entra vê todos os usuários e pagamentos, cadastra contas e reprocessa emissões. Por isso não dá para simplesmente abrir o site: é preciso separar operador e visitante.

## Objetivos

- **Entrada do visitante pela Phantom** (decisão do dono). O site pede que a Phantom assine uma mensagem com um código único, e o servidor confere a assinatura. Não há senha nem e-mail.
- **Área "Criar conta"** (decisão do dono). Na primeira entrada de uma carteira nova, o visitante informa um nome de exibição e a conta é criada, ligada àquela carteira.
- O visitante vê só o que é dele:
  - a própria carteira (saldo, benefícios, histórico);
  - a compra de Mum+ pelo fluxo simulado, até a emissão on-chain.
- O operador continua exatamente como hoje.
- Abrir o site ao público sem permitir que alguém esvazie a carteira emissora ou veja dados de outros.

## Não-objetivos

- Outras carteiras (Solflare, Backpack) ou o kit Wallet Adapter. Isso fica para depois, se o dono pedir; o backend já fica pronto para isso.
- Pagamento real ou pelo parceiro de liquidez para visitantes. Visitante usa **só o provedor simulado**.
- Login por e-mail, recuperação de conta, perfis com foto.
- Painel do operador filtrado para o visitante. Ele vê o histórico na própria carteira, que já mostra status e link para a rede.

## Anti-objetivos

- Um visitante ver carteira, nome ou pagamento de outra pessoa.
- Um visitante conseguir reprocessar pagamentos, cadastrar usuários, usar outro provedor ou ver `/api/ops/status`.
- Alguém conseguir drenar o SOL da carteira emissora ou o teto de emissão com scripts.
- Quebrar o fluxo do operador ou os testes existentes.
- Guardar qualquer dado pessoal além do endereço público da carteira e de um nome de exibição.
- Fazer um estranho acreditar que pagou dinheiro real.

## Abordagens

| | Abordagem | Troca | Decisão |
|---|---|---|---|
| **1** | Falar direto com a Phantom (`window.phantom.solana`, `signMessage`) e verificar a assinatura ed25519 no backend | Sem dependências novas no frontend, menor superfície. Só Phantom; no celular exige o navegador interno da Phantom | **Escolhida pelo dono** |
| 2 | Solana Wallet Adapter (seletor com várias carteiras) | Mais carteiras e melhor no celular, mas várias dependências, bundle maior e mais o que testar perto da apresentação | Descartada por ora |
| 3 | Login terceirizado (Privy, Dynamic etc.) | Depende de conta e chaves em serviço externo no dia da apresentação | Descartada |

## Design

### Sessões e papéis

- O cookie assinado `mp_session` passa a carregar o papel:
  - `v2:op:<issuedAt>` para o operador (login por senha, como hoje);
  - `v2:vis:<userId>:<issuedAt>` para o visitante.
- Um cookie `v1:<issuedAt>` ainda válido continua sendo tratado como operador até expirar (12 h), para não derrubar quem já está logado durante o deploy.
- `GET /api/session` passa a responder `{ authenticated, role: 'operator' | 'visitor' | null }`.
- A checagem central de sessão vira uma função que devolve `{ role, userId? } | null`. O hook do `/api` anexa isso à requisição.

### Login com Phantom

1. `POST /api/auth/phantom/challenge` com `{ walletAddress }`.
   - Valida o endereço (base58, 32 bytes).
   - Gera um nonce aleatório (128 bits) e o guarda na tabela nova `auth_challenges(nonce pk, wallet_address, expires_at, used_at)`, com validade de 5 minutos.
   - Devolve a mensagem exata a assinar, no estilo SIWS (Sign-In With Solana):
     - linha de abertura: `<host> quer que você entre com sua conta Solana:`;
     - o endereço da carteira;
     - a frase "Entrar no Mumbuca+ (Solana devnet). Isso não autoriza nenhuma transação.";
     - `Nonce`, `Emitido em` e `Expira em`.
2. O frontend chama `window.phantom.solana.connect()` e `signMessage(bytes)`. Envia `POST /api/auth/phantom/verify` com `{ walletAddress, nonce, signature (base58) }`.
3. O servidor faz as verificações e consome o nonce:
   - recria a mensagem a partir do nonce guardado (nunca a partir de texto do cliente);
   - confere carteira, validade e nonce ainda não usado;
   - verifica a assinatura ed25519 com a chave pública da carteira;
   - marca o nonce como usado de forma atômica (`update … where used_at is null returning`).
4. O que acontece depois depende de a carteira já ter conta:
   - **Carteira já tem conta** (inclusive uma cadastrada antes pelo operador): sessão de visitante para esse usuário. Resposta `{ status: 'signed_in' }`.
   - **Carteira nova:** não cria nada ainda. Emite um cookie curto e assinado `mp_signup = <wallet>:<issuedAt>` (10 min). Resposta `{ status: 'needs_signup' }`.
5. `POST /api/auth/signup` com `{ displayName }` exige um `mp_signup` válido.
   - Cria o usuário com `wallet_address` = carteira verificada, `display_name` saneado (2–40 caracteres, sem controle) e `handle` = `v_` + 8 primeiros caracteres da carteira (com sufixo se colidir).
   - Abre a sessão de visitante e apaga `mp_signup`.
   - Se duas abas criarem a mesma conta ao mesmo tempo, a restrição `unique` da carteira decide, e a segunda requisição só entra na conta existente.

### O que o visitante pode fazer (escopo no servidor)

| Rota | Operador | Visitante |
|---|---|---|
| `GET /api/me` (nova) | `{ role }` | `{ role, user }` |
| `GET /api/users`, `POST /api/users` | sim | **403** |
| `GET /api/users/:id/balance` | sim | só o próprio id; outro → 404 |
| `GET /api/payments?userId=` | sim | ignora o parâmetro, sempre os próprios |
| `GET /api/payments/:id` | sim | só se o pagamento é dele; senão 404 |
| `POST /api/payments` | como hoje | `userId` vem da sessão (o do corpo é ignorado) e `provider` deve ser `simulated`; mais os limites abaixo |
| `POST /api/payments/:id/simulate` | sim | só o próprio pagamento |
| `POST /api/payments/:id/reprocess` | sim | **403** |
| `GET /api/ops/status` | sim | **403** |
| `GET /api/public/status` (nova, sem sessão) | — | `{ visitorPurchasesOpen: boolean }` |

Recurso de outra pessoa responde **404** e não 403, para não revelar se o id existe. A regra fica no servidor; o frontend só esconde o que o visitante não pode usar.

### Limites para abrir ao público

Os valores são minha proposta e podem ser ajustados por variável de ambiente:

| Limite | Padrão | Variável |
|---|---|---|
| Valor por compra de visitante | R$ 11 a R$ 100 | `VISITOR_MIN_CENTS=1100`, `VISITOR_MAX_CENTS=10000` |
| Compras por carteira em 24 h | 3 | `VISITOR_MAX_PURCHASES_PER_DAY=3` |
| Pagamento em aberto por visitante | 1 de cada vez | — |
| Total emitido para visitantes em 24 h (todas as contas) | R$ 2.000 | `VISITOR_DAILY_CAP_CENTS=200000` |
| Contas novas por IP em 24 h | 5 | `VISITOR_SIGNUPS_PER_IP_PER_DAY=5` |
| Liga/desliga geral | ligado | `VISITOR_SIGNIN_ENABLED=true` |

- **Faixa de valor.** Os limites de visitante só **estreitam** `rechargeLimits()` (R$ 11 a R$ 20.000 no simulado), nunca alargam. O mínimo de R$ 11 vem do mínimo do parceiro de liquidez, e o processador o confere de novo depois do pagamento. Se a configuração tentar descer abaixo de R$ 11, o boot falha.
- **O que conta como compra de visitante.** Nova coluna `payments.created_via text not null default 'operator'`, com valor `'visitor'` quando o pagamento nasce de uma sessão de visitante. Só esses entram nos limites de 24 h. As demonstrações do operador nunca consomem a cota dos visitantes, nem o contrário.
- **Como o teto diário soma.** Soma o valor pedido (`requested_amount_cents`) dos pagamentos de visitante criados nas últimas 24 h, **exceto os FAILED**. Ou seja, o valor é **reservado na criação**: pagamentos pendentes não conseguem estourar o teto depois. A contagem de 3 compras por carteira segue a mesma regra.
- **Checagens repetidas na hora de pagar.** `POST /payments/:id/simulate` de visitante repete a checagem de "compras fechadas" (SOL baixo, pausa, configuração divergente, interruptor). O teto já foi reservado na criação, então não precisa ser recontado.
- **"Um pagamento em aberto".** Só bloqueia um pagamento de visitante em `AWAITING_PAYMENT` criado há menos de 30 minutos. Pagamentos já pagos estão nas mãos do sistema (processador e reconciliador) e não bloqueiam o visitante. Um pagamento parado para revisão também não bloqueia. Passados 30 minutos, um `AWAITING_PAYMENT` deixa de bloquear e de contar para as 3 compras e para o teto. Ele continua no histórico como "Aguardando", sem nova transição de estado.
- **Taxa por IP** (`@fastify/rate-limit`): challenge 20/min, verify 10/min, signup 5/min, criar pagamento 5/min. `main.ts` já confia em um proxy (Railway), então o IP do cliente está correto.
- **Compras fechadas** quando há SOL baixo na emissora (`lowSol`), emissão pausada, configuração on-chain divergente, teto diário atingido ou interruptor desligado.
  - O servidor responde `409 { error: 'purchases_closed' }`.
  - O frontend mostra: "Compras de demonstração pausadas no momento. Tente mais tarde."
- **Contas por IP:** contar contas novas por IP exige guardar o IP. Proposta: guardar só um hash do IP com sal (`SESSION_SECRET`) numa tabela de contagem, apagado após 24 h. Assim nenhum IP fica em claro.

### Frontend

- **Tela de entrada (substitui `Login.tsx`):**
  - marca C2 e botão primário amarelo **"Entrar com Phantom"**;
  - linha de apoio: "Use sua Phantom na rede de testes (devnet). Nenhum dinheiro real é cobrado.";
  - link discreto **"Acesso do operador"**, que abre o campo de senha atual.
- **Sem Phantom no navegador:**
  - texto e link para instalar a Phantom (phantom.app, nova aba);
  - no celular, dica para abrir o site pelo navegador dentro da Phantom;
  - dica de como ativar a devnet na Phantom (Configurações → Configurações do desenvolvedor → Modo testnet → Solana Devnet).
- **Tela "Criar conta"** (quando o servidor diz `needs_signup`):
  - mostra a carteira curta já verificada;
  - campo "Como quer ser chamado?" e botão "Criar conta".
- **Visitante logado:**
  - sem a aba "Operador" e sem o seletor de conta; a "Minha carteira" usa `GET /api/me`;
  - o diálogo de compra usa o fluxo simulado (`allowSimulate`), com os valores dentro dos limites de visitante e um aviso curto se as compras estiverem fechadas;
  - "Sair" encerra a sessão; na Phantom, opcionalmente, `disconnect()`.
- **Operador:** igual a hoje, com a aba "Operador" e o seletor de conta.
- O acesso à Phantom é feito por uma pequena camada `phantom.ts` tipada, que facilita os testes com um mock.

### Visual (UX) — Spell UI

**Decisão do dono:** usar os componentes originais do [Spell UI](https://spell.sh) (licença MIT, repositório `xxtomm/spell-ui`), em vez de recriar os efeitos. O esboço aprovado para o visual tem quatro telas: Entrada, Criar conta, Minha carteira e Sem Phantom.

- **Tom:** o visitante vê **só telas**. Nenhuma regra ou texto técnico aparece; os limites só aparecem como mensagens curtas quando atingidos.
- **`AnimatedGradient`** (shader WebGL2):
  - é o fundo da tela de **Entrada**, em tela cheia;
  - aparece mais suave (opacidade menor, sob um véu escuro) em Criar conta, Sem Phantom e no topo de Minha carteira;
  - usa `preset: "custom"` com as cores de Maricá: `color1 #06150f`, `color2 #3dffa8`, `color3 #ffd23f`, ajustando `speed`, `swirl` e `softness` até ficar parecido com o esboço;
  - **sem WebGL2**, fica o fundo escuro C2 sólido;
  - com `prefers-reduced-motion`, o gradiente fica parado.
- **`PopButton`** (borda inferior grossa que "afunda" ao clicar):
  - é o botão principal em todas as telas do visitante: Entrar com Phantom, Criar conta, ＋ Comprar Mum+, Instalar Phantom;
  - também nos botões do diálogo de compra (Pix);
  - o painel do operador continua com os botões atuais.
- **Cores dos botões:**
  - **Principal:** uma variante nova `marica` (fundo `#ffd23f`, borda `#a8840a`, texto `#1a1400`). O `amber` original usa texto branco sobre âmbar, o que não passa no contraste WCAG AA. A variante nova é só uma entrada a mais no mapa de cores do componente.
  - **Secundário:** `default`.
  - O `purple` não é usado, porque não faz parte da identidade de Maricá.
- **Título da Entrada:** "Gaste em Maricá *com vantagens*", com a segunda linha em itálico serifado e amarelo, no estilo do exemplo do Spell UI.
- **Fonte DynaPuff do PopButton:** não é usada. Nada de fontes externas; continua a fonte do sistema.

**Como entra no projeto:**
- Tailwind CSS v4 pelo plugin `@tailwindcss/vite`, importando **só `theme` e `utilities`**, sem o `preflight`. Assim o reset do Tailwind não mexe no CSS C2 existente.
- Dependências novas:
  - `tailwindcss`, `@tailwindcss/vite`;
  - `@radix-ui/react-slot`;
  - `clsx` e `tailwind-merge`, para o `cn` em `src/lib/utils.ts`.
- Alias `@/` → `src/` no Vite e no TypeScript, para os imports originais funcionarem.
- **Código dos componentes:**
  - fica em `src/components/spell/`, copiado do registro, com cabeçalho de atribuição MIT;
  - a única alteração no `animated-gradient` é trocar o `useTheme` do `next-themes` (feito para Next.js) por um retorno fixo `"dark"`, porque o site é só escuro;
  - no `pop-button`, a única alteração é a variante `marica`.
- Nos testes (jsdom não tem WebGL2), o gradiente não pode quebrar: ele precisa simplesmente não desenhar nada.

### Dados

- **Migração `002_visitor_auth.sql`:**
  - `auth_challenges`;
  - coluna `payments.created_via` (`'operator'` por padrão);
  - `signup_ip_counts(ip_hash, day, count)`;
  - um índice em `payments(user_id, created_at)` para as contagens por carteira.
- A tabela `users` não muda. Visitantes e contas criadas pelo operador são o mesmo tipo de registro.
- O nonce expirado é apagado pelo próprio fluxo, numa limpeza oportunista no challenge.

### Documentação

- **README PT/EN:** seção "Teste você mesmo" com o link do site, os passos (Phantom em devnet → Entrar → Criar conta → Comprar Mum+ → ver na Phantom e no Explorer) e os limites da demonstração.
- **`docs/demo-runbook.md`:** atualizar para o caminho Simulado, a cópia "visitante" e o novo login.

## Restrições

- Node 22, Fastify 5, React 19 e Vite, como hoje.
- Backend: a verificação ed25519 usa `@noble/curves` (`ed25519.verify`), adicionado como dependência direta. Ele já vem com `@solana/web3.js`, então não entra código novo de terceiros.
- Frontend: as dependências novas são só as do Spell UI (ver "Visual").
- TDD, como no resto do projeto:
  - testes de rota com PGlite para cada linha da tabela de escopo;
  - assinatura válida e inválida, nonce reutilizado ou expirado, carteira trocada;
  - corrida no signup;
  - limites e "compras fechadas".
- A chave da emissora continua só no servidor. Nada de segredo no frontend nem no repositório.
- Mensagens de erro genéricas e logs só com a classe do erro, como hoje.

## Deixado ao construtor

- texto exato das telas, dentro do tom C2 e da cópia de visitante;
- estrutura interna do código de sessão e dos testes;
- como a contagem diária é calculada (consulta em `payments` ou contador), desde que correta sob concorrência razoável;
- disposição visual das dicas de "sem Phantom" e "ativar devnet".

## Escolhas minhas para o dono conferir

1. Os valores dos limites da tabela acima.
2. A frase "Nenhum dinheiro real é cobrado" na tela de entrada. Antes o dono pediu para não ter faixa de "ambiente de teste", mas agora o site fica aberto a estranhos, e um aviso discreto evita que alguém pense que pagou de verdade. O resto do app continua sem faixa.
3. Uma carteira já cadastrada pelo operador entra direto na conta existente, sem passar por "Criar conta".
4. Visual: as cores de Maricá no gradiente (em vez do Prism azul e branco) e a variante amarela `marica` no botão (em vez do `amber` com texto branco, que não passa no contraste).
5. O visitante não vê o painel do operador. O histórico na carteira já mostra os estados e o link para a rede.
6. Revisão do construtor:
   - o mínimo para visitante é **R$ 11**, porque R$ 10 conflitava com o mínimo já existente;
   - compras de visitante ficam marcadas em `payments.created_via`;
   - o teto é reservado na criação;
   - uma compra não paga em 30 minutos deixa de bloquear o visitante.
