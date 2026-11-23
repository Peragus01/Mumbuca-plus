# Mumbuca+

**Infraestrutura de tokenização para moedas sociais: um pagamento em reais confirmado por uma instituição de pagamento vira, automaticamente, saldo digital rastreável na carteira do cidadão.**

> Prova de conceito acadêmica da proposta **Mumbuca+**, desenvolvida a partir do relatório *"Renda Básica de Cidadania — Mumbuca"* (Faculdade Sebrae, Administração de Empresas, Turma T9, disciplina Empreendedorismo & Impacto Social, 2026). Não é um sistema oficial da Prefeitura de Maricá nem do Banco Comunitário Mumbuca. Roda na rede de testes **Polygon Amoy**.

---

## Sumário

1. [O problema](#1-o-problema)
2. [O que o Mumbuca+ faz](#2-o-que-o-mumbuca-faz)
3. [A rota do dinheiro: BRL → BRS → Mumbuca+](#3-a-rota-do-dinheiro-brl--brs--mumbuca)
4. [Provedor de liquidez](#4-provedor-de-liquidez)
5. [Tese jurídica: por que o Mumbuca+ não é uma operação de câmbio](#5-tese-jurídica-por-que-o-mumbuca-não-é-uma-operação-de-câmbio)
6. [Arquitetura](#6-arquitetura)
7. [Fluxo ponta a ponta](#7-fluxo-ponta-a-ponta)
8. [Segurança e garantias](#8-segurança-e-garantias)
9. [O token Mumbuca+ (M+)](#9-o-token-mumbuca-m)
10. [Como isso fortalece a política pública](#10-como-isso-fortalece-a-política-pública)
11. [Escopo da prova de conceito](#11-escopo-da-prova-de-conceito)
12. [Estrutura do repositório e documentação](#12-estrutura-do-repositório-e-documentação)
13. [Referências](#13-referências)

---

## 1. O problema

A Mumbuca é a moeda social de Maricá (RJ). Criada em 2013 e gerida pelo Banco Comunitário Mumbuca, ela tem paridade fixa com o real (1 Mumbuca = R$ 1,00) e sustenta a Renda Básica de Cidadania do município. Segundo o relatório, em 2026 o programa atende **mais de 93 mil beneficiários**, paga **230 Mumbucas por mês** e movimenta um orçamento anual **acima de R$ 256 milhões**.

O relatório aponta gargalos que a tecnologia pode atacar:

| Gargalo (relatório) | Como a tokenização ajuda |
|---|---|
| Processos físicos: cartões plásticos e papel térmico | Saldo e comprovante 100% digitais, verificáveis on-chain |
| Rastreabilidade e prestação de contas manuais | Cada emissão tem um hash público e auditável por qualquer pessoa |
| Dependência de um arranjo fechado, difícil de integrar | Padrão aberto (ERC-20) integrável a qualquer carteira e instituição de pagamento |
| Dependência fiscal exclusiva de repasses públicos | Entrada de recursos por instituições de pagamento abre caminho a novas fontes, como recargas e parcerias |

O relatório propõe uma **carteira dupla tokenizada**. Este repositório constrói a **fundação técnica** dessa carteira: a ponte automática e segura entre o dinheiro que entra pelo sistema de pagamentos e o token que chega ao cidadão.

## 2. O que o Mumbuca+ faz

1. A cidadã escolhe um valor e faz uma **recarga via Pix**.
2. O **provedor de liquidez** (OZAV) recebe os reais.
3. O backend do Mumbuca+ **detecta a chegada do dinheiro** por webhook ou por consulta periódica, e **confirma direto na API do provedor**. Nunca confia apenas na notificação.
4. O backend executa `mint()` no contrato inteligente.
5. Os **Mumbuca+ (M+) aparecem na carteira MetaMask** da cidadã, 1 M+ para cada R$ 1,00 recebido.
6. A transação fica **pública e verificável** na PolygonScan.
7. Nenhum pagamento gera emissão duplicada, mesmo com reenvios, quedas de rede ou reinícios do servidor.

## 3. A rota do dinheiro: BRL → BRS → Mumbuca+

```mermaid
flowchart LR
    A["Cidadã<br/>paga R$ via Pix"] -->|BRL| B["OZAV<br/>provedor de liquidez"]
    B -->|"BRL → BRS<br/>(token do real, Solana)<br/>sem perna de câmbio"| C[("Reserva em BRS<br/>conta custodiada")]
    B -.->|"sinal: BRL recebido"| D["Backend Mumbuca+<br/>valida na API da OZAV"]
    D -->|"mint 1:1"| E["Contrato Mumbuca+<br/>Polygon"]
    E -->|"M+"| F["Carteira da cidadã<br/>MetaMask"]
```

- **BRL:** o cidadão paga em reais, pelo Pix, a moeda que ele já usa.
- **BRS:** o provedor de liquidez converte os reais em **BRS**, um token referenciado no real que roda na Solana e é oferecido pela OZAV. A conversão BRL→BRS **não tem perna de câmbio**: não há cotação contra moeda estrangeira nem trava de câmbio, e a taxa é 1:1 no mesmo padrão monetário. O BRS fica numa carteira custodiada e serve de **reserva em reais** da operação.
- **Mumbuca+:** com a chegada do BRL confirmada, o sistema emite **M+ na mesma quantidade em reais** na carteira do cidadão. O M+ é a camada de **moeda social**: é nela que entram as regras da política pública, como o território, o incentivo ao comércio local e o crédito controlado previsto no relatório.

Do começo ao fim, **o valor está sempre denominado em reais**: BRL, depois BRS (real tokenizado) e por fim M+ (moeda social com paridade com o real). Nenhuma perna envolve moeda estrangeira.

> **Nota sobre o ambiente de testes:** o sandbox da OZAV não oferece o corredor BRL→BRS e aceita Pix só entre R$ 1.000 e R$ 10.000. Por isso, a demonstração em sandbox usa outro corredor disponível (BRL→USDT) **apenas para gerar o evento de "BRL recebido"**. O Mumbuca+ só observa a perna em reais. A rota BRL→BRS é a usada no ambiente real, com mínimo de R$ 11.

## 4. Provedor de liquidez

O Mumbuca+ **não guarda dinheiro, não converte moedas e não faz o Pix**. Essas funções ficam com um **provedor de liquidez** especializado. Na prova de conceito é a **OZAV**, usada por meio da integração que a **Peragus** já mantém em produção.

| Responsabilidade | Quem cumpre |
|---|---|
| Receber o Pix em reais | Provedor de liquidez (OZAV) |
| KYC, PLD/FT e compliance da conta que recebe | Provedor de liquidez (OZAV), sobre a conta da Peragus |
| Converter BRL em BRS e custodiar a reserva | Provedor de liquidez (OZAV) |
| Avisar a chegada do dinheiro (webhook assinado + API de consulta) | Provedor de liquidez (OZAV) |
| Validar o pagamento, decidir e emitir a moeda social | Mumbuca+ |
| Regras da política pública (território, incentivo, crédito) | Mumbuca+ / gestor público |

**Por que esse desenho:**
- **Separação de funções:** a parte financeira regulada fica com quem já opera e responde por ela. O Mumbuca+ fica com a camada de política pública.
- **Troca de provedor sem reescrever o sistema:** o núcleo de emissão só conhece a interface `PaymentProvider`. A OZAV, o Mercado Pago (desenhado, ainda sem integração) e um provedor simulado são adaptadores.
- **Reaproveitamento:** a integração com a OZAV vem de código já usado pela Peragus, o que reduz risco e prazo.

Detalhes técnicos: [`docs/providers/ozav.md`](docs/providers/ozav.md) (criado durante a implementação).

## 5. Tese jurídica: por que o Mumbuca+ não é uma operação de câmbio

> ⚠️ **Esta seção apresenta uma tese em construção, não um parecer jurídico.** Ela precisa ser validada por advogado especializado em regulação financeira antes de qualquer uso fora do ambiente de testes.

### 5.1 Argumentos

1. **Não há moeda estrangeira em nenhuma etapa.** No sentido clássico, câmbio é a troca de moeda nacional por moeda estrangeira (e vice-versa). Na rota BRL → BRS → M+, o valor é sempre denominado em reais e não existe cotação, spread cambial ou trava de câmbio. Na própria documentação da OZAV, o corredor BRL→BRS aparece sem perna de câmbio, ao contrário do BRL→USDT.
2. **O Mumbuca+ não compra, não vende e não troca ativos virtuais com o cidadão.** O que o sistema faz é **emitir moeda social** depois de uma entrada em reais confirmada por terceiro. Não há mesa de negociação, livro de ofertas nem preço. A emissão é 1:1 e definida pela regra da política pública.
3. **A operação financeira regulada fica com uma instituição especializada.** O recebimento do Pix, a conversão BRL→BRS, a custódia e o compliance (KYC, PLD/FT) ficam com o provedor de liquidez. O Mumbuca+ não movimenta recursos de terceiros.
4. **O M+ segue o modelo de moeda social que o Brasil já reconhece.** Moedas sociais de bancos comunitários existem desde o Banco Palmas (1998). Elas têm **lastro em reais, paridade 1:1 e circulação territorial**, e **não têm curso forçado** (ninguém é obrigado a aceitá-las), como descreve material do próprio Banco Central. A Mumbuca já opera assim em Maricá, com base em legislação municipal (o relatório cita a Lei Municipal nº 3.673/2025). O Mumbuca+ só troca o meio, de cartão e app fechado para token.
5. **O desenho evita, por construção, as hipóteses que a regulação de ativos virtuais trata como câmbio:** não há pagamento ou transferência internacional e não há compra ou venda contra moeda estrangeira, que o § 2º do art. 76-A da Resolução BCB nº 277/2022 proíbe.

### 5.2 Ponto de atenção que a tese precisa enfrentar

A **Resolução BCB nº 521/2025** incluiu o art. 76-A na Resolução BCB nº 277/2022, em vigor desde 2 de fevereiro de 2026. Pelo inciso IV, entra no mercado de câmbio a prestação de serviços de ativos virtuais que envolva *"compra, venda ou troca de ativos virtuais referenciados em moeda fiduciária"*. **O texto não distingue entre moeda estrangeira e real.** Uma leitura literal, defendida por parte da doutrina, alcança também stablecoins referenciadas em reais, como o BRS.

Como a tese responde a esse ponto:
- **A compra de BRS é feita pelo provedor de liquidez**, que é quem presta o serviço de ativos virtuais. Se essa perna for enquadrada no art. 76-A, as obrigações decorrentes (identificação, finalidade, reporte) são do provedor. Elas não descaracterizam a política pública nem tornam o Mumbuca+ uma operação de câmbio.
- **A emissão do M+ não é compra e venda por prestadora de serviços de ativos virtuais.** É emissão de moeda social por regra pública, sem contraparte negociando preço. Ainda assim, é preciso confirmar se o M+, como token pareado ao real, seria tratado como "ativo virtual referenciado em moeda fiduciária", e qual seria o papel do emissor numa operação real.
- **Alternativa de desenho, caso o enquadramento da perna BRS seja desfavorável:** o Mumbuca+ pode observar **só a chegada do BRL** (que já é o gatilho técnico hoje) e manter a reserva em reais numa conta de pagamento, sem passar por stablecoin. A arquitetura permite isso sem mudar o núcleo de emissão.

### 5.3 Perguntas para a validação jurídica

1. A aquisição de BRS contra reais, por um provedor de serviços de ativos virtuais, entra no art. 76-A, IV? Há posição do BCB (FAQ, consulta) sobre stablecoins referenciadas em real?
2. O M+, emitido 1:1 por regra de política pública e de circulação territorial, é "ativo virtual" nos termos da Lei nº 14.478/2022? Ou é melhor tratado como moeda social digital, ou como instrumento de um arranjo de pagamento restrito?
3. Qual entidade deve emitir o M+ numa operação real (banco comunitário, município, instituição de pagamento parceira), e qual autorização ela precisa?
4. Quais obrigações de PLD/FT e LGPD recaem sobre a camada Mumbuca+, considerando que o KYC é feito pelo provedor de liquidez?

## 6. Arquitetura

```mermaid
flowchart TB
    subgraph Usuarios["Usuários"]
        C["Cidadã<br/>navegador + MetaMask"]
        O["Operador<br/>painel de gestão"]
    end

    subgraph Backend["Backend Mumbuca+ (Node.js + TypeScript)"]
        API["API + Dashboard<br/>(login)"]
        WH["POST /webhooks/payments<br/>verifica assinatura"]
        PP["PaymentProvider<br/>OZAV · Simulado · Mercado Pago"]
        PROC["Processador de pagamentos<br/>máquina de estados"]
        REC["Reconciliador<br/>consulta periódica"]
        WR["Registro de carteiras"]
        MS["Serviço de emissão<br/>chave do minter só no servidor"]
        DB[("Postgres<br/>pagamentos e eventos")]
    end

    OZ["OZAV<br/>provedor de liquidez"]
    SC["Contrato Mumbuca+ (ERC-20)<br/>Polygon Amoy"]
    EX["PolygonScan<br/>verificação pública"]

    C --> API
    O --> API
    API --> PROC
    OZ -->|webhook assinado| WH --> PROC
    REC --> PROC
    PROC <--> PP <--> OZ
    PROC --> WR
    PROC --> MS --> SC
    PROC <--> DB
    SC --> EX
    SC -->|M+| C
```

| Módulo | Responsabilidade |
|---|---|
| Contrato ERC-20 | Emissão controlada, teto de supply, pausa, bloqueio de emissão duplicada |
| PaymentProvider | Interface única para qualquer instituição de pagamento |
| Webhook Handler | Recebe avisos, verifica assinatura e registra sem confiar no conteúdo |
| Validador | Consulta o pagamento na API oficial do provedor e confere status, valor e referência |
| Registro de carteiras | Liga cada usuário (fictício na demo) a um endereço Polygon |
| Serviço de emissão | Envia `mint`, acompanha a confirmação e recupera falhas sem duplicar |
| Banco de transações | Histórico completo e auditável de cada pagamento e transição |
| Dashboard | Visão da cidadã (saldo, recarga, histórico) e do operador (todos os pagamentos, hashes, ações) |

**Tecnologias:** Solidity e OpenZeppelin (contrato), Remix e MetaMask (implantação), Node.js 22, TypeScript, Fastify e Postgres (backend), viem (blockchain), React e Vite (dashboard), Railway (hospedagem).

## 7. Fluxo ponta a ponta

```mermaid
sequenceDiagram
    autonumber
    actor Cidada as Cidadã
    participant Dash as Dashboard
    participant API as Backend Mumbuca+
    participant OZAV as OZAV (liquidez)
    participant SC as Contrato M+ (Polygon)

    Cidada->>Dash: Recarregar R$ 50
    Dash->>API: POST /api/payments
    API->>OZAV: cotação + transferência (metadata: id do pagamento)
    OZAV-->>API: Pix copia-e-cola + QR
    API-->>Dash: exibe QR (Aguardando Pix)
    Cidada->>OZAV: paga o Pix (R$ 50)
    OZAV-->>API: webhook assinado "transfer.updated"
    Note over API: Nunca confia no corpo do aviso
    API->>OZAV: GET /transfers/{id}
    OZAV-->>API: BRL recebido = R$ 50,00
    API->>API: valida valor, referência e carteira
    API->>SC: mint(carteira, 50 M+, paymentRef)
    SC-->>API: tx hash + confirmação
    API-->>Dash: Emitido ✓ + link PolygonScan
    SC-->>Cidada: 50 M+ na MetaMask
```

### Máquina de estados de cada pagamento

```mermaid
stateDiagram-v2
    [*] --> AWAITING_PAYMENT: cobrança criada
    AWAITING_PAYMENT --> RECEIVED: aviso do provedor
    RECEIVED --> VALIDATING: consulta à API oficial
    VALIDATING --> AWAITING_PAYMENT: ainda não pago
    VALIDATING --> APPROVED: BRL confirmado
    VALIDATING --> FAILED: rejeitado / expirado / abaixo do mínimo / carteira inexistente
    APPROVED --> MINT_PENDING: transação enviada (hash gravado)
    MINT_PENDING --> MINTED: confirmada na blockchain
    MINT_PENDING --> APPROVED: revertida sem emissão
    APPROVED --> FAILED: revert definitivo após várias tentativas
    MINTED --> [*]
    FAILED --> [*]
```

Falhas temporárias, como instabilidade de rede, timeout ou provedor fora do ar, **não** levam a `FAILED`: o pagamento fica no estado em que está e o reconciliador tenta de novo.

## 8. Segurança e garantias

**Zero emissão duplicada, em quatro camadas:**
1. Cada aviso do provedor é registrado pelo seu identificador e o repetido é descartado.
2. Cada pagamento muda de estado com atualização condicional no banco, o que impede dois processamentos simultâneos.
3. Antes de reenviar uma emissão incerta, o backend pergunta ao contrato se aquele pagamento já foi emitido.
4. **No próprio contrato:** `mint(to, amount, paymentRef)` recusa qualquer `paymentRef` repetido. Essa garantia final não depende do backend.

**Outras garantias:**
- **Nada é emitido só porque chegou uma notificação.** O pagamento sempre é confirmado na API oficial do provedor.
- O webhook é autenticado por assinatura HMAC-SHA256 com janela de tempo.
- **A chave privada de emissão fica só no servidor**, nunca no navegador nem no repositório. A conta que administra o contrato é separada da conta que emite.
- O contrato limita o dano de uma eventual chave vazada: teto total, limite por emissão e pausa de emergência.
- Todos os valores são tratados em **centavos inteiros**, sem erros de arredondamento.
- Toda a URL pública fica atrás de login. Desconhecidos não criam recargas nem disparam emissões.
- Na demonstração não há nenhum dado real de beneficiário nem do CadÚnico.

## 9. O token Mumbuca+ (M+)

| Propriedade | Valor |
|---|---|
| Padrão | ERC-20 (OpenZeppelin v5) |
| Nome / símbolo | Mumbuca+ / M+ |
| Decimais | 18 |
| Supply inicial | 0. Tudo é emitido contra pagamento confirmado |
| Teto de supply | 10.000.000 M+ |
| Limite por emissão | 20.000 M+ (ajustável pelo administrador) |
| Papéis | Administrador (gestor), Emissor (backend), Pausador (gestor) |
| Pausa | Suspende só novas emissões. Os saldos e as transferências continuam |
| Rastreabilidade | Evento `MintedForPayment(carteira, valor, paymentRef)` em cada emissão |
| Rede | Polygon Amoy (chain ID 80002). O contrato é implantado e verificado pelo Remix |

**Paridade experimental:** 1 M+ = R$ 1,00, só nesta demonstração. Na prova de conceito não há resgate nem conversibilidade garantida.

## 10. Como isso fortalece a política pública

| Objetivo do relatório | Contribuição do Mumbuca+ |
|---|---|
| Modernização e digitalização | Moeda social em padrão aberto, sem cartão nem papel |
| Rastreabilidade | Cada real que entra gera uma emissão pública e auditável |
| Integração com instituições de pagamento | Provedores plugáveis: Pix hoje, outros amanhã |
| Inclusão financeira | Funciona com Pix e carteira digital, sem conta bancária tradicional |
| Sustentabilidade operacional | Menos atendimento manual e logística física. Base para receitas próprias, como recargas e parcerias |
| Economia local | O M+ é a camada onde entram as regras de território e incentivo (5% no comércio local e crédito externo controlado, módulos futuros do relatório) |
| Transparência e controle | Painel de gestão e explorador público para órgãos de controle |

## 11. Escopo da prova de conceito

**Está no escopo:**
- Contrato ERC-20 na Polygon Amoy.
- Recarga Pix pela OZAV, nos ambientes sandbox e real (R$ 11).
- Validação na API do provedor.
- Emissão automática e idempotente.
- Dashboard da cidadã e do operador.
- Simulação local para contingência.

**Fica para fases futuras:**
- Carteira dupla e incentivo de 5%.
- Crédito externo de 25%.
- Maquininhas próprias.
- Assistente de IA.
- Integração real com o Mercado Pago.
- Resgate de M+ em reais.
- Rede principal (mainnet).
- Integração com o CadÚnico.

**Status:** o design está aprovado e a implementação está em andamento. Veja o [design](docs/superpowers/specs/2026-11-23-mumbuca-plus-mvp-design.md) e o [plano de implementação](docs/superpowers/plans/2026-11-23-mumbuca-plus-mvp.md).

## 12. Estrutura do repositório e documentação

```
contracts/     contrato MumbucaPlus.sol e testes
backend/       API, webhook, processador, emissão (Node.js + TypeScript)
frontend/      dashboard (React + Vite)
docs/
  superpowers/specs/   documento de design
  superpowers/plans/   plano de implementação
  remix-deploy.md      tutorial de implantação pelo Remix
  providers/           OZAV e Mercado Pago
  demo-runbook.md      roteiro da demonstração e contingências
```

Instruções para rodar localmente e para implantar serão adicionadas aqui quando a implementação terminar.

## 13. Referências

- Relatório *"Renda Básica de Cidadania — Mumbuca"*. Faculdade Sebrae, 2026. Inclui as fontes FGV, UFF, Banco Mumbuca, CODEMAR e Prefeitura de Maricá citadas nele.
- Brasil. **Lei nº 14.478/2022**, marco legal dos prestadores de serviços de ativos virtuais.
- Banco Central do Brasil. **Resoluções BCB nº 519, 520 e 521/2025**, sobre prestadores de serviços de ativos virtuais e a inclusão de operações com ativos virtuais no mercado de câmbio (art. 76-A da Resolução BCB nº 277/2022). [Texto da Resolução BCB nº 521](https://www.bcb.gov.br/estabilidadefinanceira/exibenormativo?tipo=Resolu%C3%A7%C3%A3o%20BCB&numero=521)
- Banco Central do Brasil. Apresentação sobre moedas sociais e bancos comunitários (microfinanças). [bcb.gov.br](https://www.bcb.gov.br/pre/microFinancas/arquivos/horario_arquivos/apres_62.pdf)
- Revista Pesquisa FAPESP. *Bancos comunitários impulsionam o desenvolvimento local*. [revistapesquisa.fapesp.br](https://revistapesquisa.fapesp.br/bancos-comunitarios-impulsionam-o-desenvolvimento-local/)
- Barbieri Advogados. *O paradoxo das stablecoins: quando o real digital encontra o IOF*. Leitura do art. 76-A, IV, aplicada a stablecoins em real. [barbieriadvogados.com](https://www.barbieriadvogados.com/o-paradoxo-das-stablecoins-quando-o-real-digital-encontra-o-iof/)
- OpenZeppelin Contracts v5: [docs.openzeppelin.com/contracts/5.x](https://docs.openzeppelin.com/contracts/5.x/)
- Polygon Amoy: [amoy.polygonscan.com](https://amoy.polygonscan.com)

---

*Mumbuca+ é uma proposta acadêmica de modernização de política pública. Os tokens desta demonstração circulam apenas em rede de testes.*
