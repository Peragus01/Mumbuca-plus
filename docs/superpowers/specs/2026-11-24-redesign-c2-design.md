# Redesign visual C2 — "Identidade Maricá, escuro total"

Data: 2026-11-24 · Status: aprovado pelo dono · Tamanho: mudança pequena/média, só frontend

## Intenção

O site funciona, mas o dono achou o visual "muito simples" para a apresentação. Ele quer que o Mumbuca+ pareça um produto real, com a identidade da moeda social de Maricá e o contraste forte de uma carteira cripto, porque vai ser exibido ao vivo num telão.

A direção foi escolhida em mockups: **C2 · Escuro total**.
- **Base:** identidade Maricá, com verde e amarelo, "Moeda social de Maricá" e linguagem de comércio local.
- **Contraste:** o do estilo web3 escuro.
- **Selo:** "on-chain · Solana" junto do saldo.

## Objetivos

Aplicar o tema C2 nas cinco telas e componentes:
- Login;
- visão da cidadã;
- janela de recarga (Pix);
- visão do operador;
- selos de status.

O resultado precisa parecer um produto de fintech pronto, legível no telão e no celular.

## Não-objetivos

- Mudar lógica, API, regras de negócio ou textos de status.
- Alternância claro/escuro: o site fica só escuro.
- Funcionalidades novas. O botão "Onde usar" do mockup **não** entra.

## Anti-objetivos

- Quebrar qualquer teste existente ou comportamento já verificado:
  - a origem aparece só para o operador;
  - não há resposta "velha" ao trocar de conta;
  - o polling para nos estados terminais.
- Contraste insuficiente: texto e controles devem passar WCAG AA sobre o fundo escuro.
- Depender de recursos externos em tempo de execução: nada de fontes do Google, CDN ou imagens remotas. A apresentação pode ter internet ruim.
- QR Code do Pix ilegível: ele fica sempre sobre uma moldura clara.

## Abordagens

| | Abordagem | Troca | Decisão |
|---|---|---|---|
| **A** | Retematizar o CSS atual (tokens em `:root`) e ajustar a marcação de poucas telas | Mudança contida, sem dependências novas, testes preservados | **Escolhida** |
| B | Adotar biblioteca de UI (Tailwind/shadcn) | Muita troca de código perto da apresentação; risco de regressão | Descartada |
| C | Reescrever as telas do zero | Mesmo risco, sem ganho visual sobre A | Descartada |

## Design

**Paleta (tokens CSS):**
- fundo `#06150f`;
- superfícies em verde-escuro translúcido (`rgba(255,255,255,.04–.07)`), com borda sutil;
- texto `#eef6f1` e texto secundário com opacidade de ~70%;
- acentos: amarelo Mumbuca `#ffd23f` (ação primária, marca "+") e verde-neon `#3dffa8` (sucesso, on-chain);
- erro e aviso com tons legíveis sobre o fundo escuro;
- foco visível em amarelo.

**Saldo:** número grande em negrito, com degradê amarelo→verde (`linear-gradient(90deg,#ffd23f,#3dffa8)` com `background-clip:text`). Precisa ter um fallback de cor sólida legível.

**Componentes:**
- **Login:** marca "Mumbuca+" com o "+" em amarelo e o subtítulo "Moeda social de Maricá". Cartão escuro com o campo de senha, botão primário amarelo e mensagem de erro legível.
- **Cidadã:**
  - cabeçalho com a marca e "Olá, <nome>";
  - cartão de saldo com degradê suave amarelo/verde e borda amarela translúcida;
  - abaixo do saldo, a paridade "1 Mum+ = R$ 1,00" e o endereço curto com o botão copiar;
  - selo "● on-chain · Solana";
  - botões "＋ Recarregar" (primário, amarelo) e "Ver na rede ↗" (secundário, abre a carteira no Solana Explorer, cluster devnet);
  - selo "🌿 Comércio local fortalecido";
  - histórico em lista escura, com o status "Emitido" em verde-neon e o link "ver na rede ↗".
- **RechargeDialog:**
  - modal escuro;
  - QR Code numa moldura **clara** (fundo branco e padding), para continuar escaneável;
  - Pix copia-e-cola em fonte monoespaçada;
  - linha do tempo de status com o passo atual em destaque.
- **Operador:**
  - tabela escura legível, com zebra sutil e cabeçalho fixo se for simples;
  - selos de origem: SIMULADO em amarelo, OZAV em verde;
  - alertas (SOL baixo, configuração on-chain divergente, emissão pausada) em faixas de alto contraste;
  - botões Simular e Reprocessar no estilo novo;
  - formulário de cadastro no tema.
- **StatusBadge:** pílulas com cores do tema (Aguardando, Emitindo, Emitido, Falhou), com texto sempre visível, sem depender só da cor.

**Tipografia:** pilha de fontes do sistema. Números do saldo e valores com `font-variant-numeric: tabular-nums`.

**Responsivo:** continua funcionando a 375 px sem rolagem lateral, como hoje.

## Restrições

- React 19 + Vite e CSS puro, como hoje. Sem novas dependências.
- Todos os testes do frontend continuam passando. Os testes podem ser ajustados apenas quando um texto ou papel de acessibilidade mudar de propósito, e qualquer mudança desse tipo deve ser justificada.
- O link "Ver na rede ↗" da carteira usa `https://explorer.solana.com/address/<endereço>?cluster=devnet`.

## Deixado ao construtor

- espaçamentos e raios exatos;
- sombras e animações sutis;
- organização interna do CSS;
- ícones em SVG inline ou emoji, desde que sem dependência externa.

## Revisão (2026-11-24): público visitante e "Benefícios em Maricá"

**Decisão do dono.** O foco do Mumbuca+ é o **público externo**: turistas e visitantes compram Mum+ para gastar em Maricá e, com isso, têm benefícios e descontos na rede da cidade. Parte do lucro é revertida para **cinema e cultura** em Maricá.

Esta revisão substitui os textos da visão do usuário descritos acima:
- **Nome da visão:** "Minha carteira" (antes "Cidadã") no menu e no título.
- **Saudação:** "Bem-vindo a Maricá, <nome>".
- **Rótulo do saldo:** "Seu saldo para gastar em Maricá".
- **Botão primário:** "＋ Comprar Mum+" (antes "＋ Recarregar"). O título da janela vira "Comprar Mum+ via Pix".
- **Selos:** saem "🌿 Comércio local fortalecido". Entram "🎟️ Descontos e benefícios na rede de Maricá" e "🎬 Parte do lucro financia cinema e cultura na cidade".
- **Seção nova "Benefícios em Maricá":** fica abaixo do saldo, com 4 cartões ilustrativos (conteúdo estático, sem backend):
  - Gastronomia: "até 10% off";
  - Hospedagem: "até 15% off";
  - Cultura e cinema: "ingresso com desconto";
  - Comércio local: "cashback de 5%".

  Cada cartão leva o selo "exemplo". **Não usar nomes de estabelecimentos reais.** O rodapé da seção diz: "Benefícios ilustrativos da proposta Mumbuca+."

A visão do operador continua como está, sem mudança de textos.
