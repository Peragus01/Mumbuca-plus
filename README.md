# Mumbuca+

🇧🇷 Português · [🇺🇸 English](README.en.md)

**Infraestrutura de tokenização para moedas sociais: um pagamento em reais, liquidado por um parceiro regulado, vira automaticamente saldo digital rastreável na carteira do cidadão, com entrega condicionada ao pagamento (DvP) e compliance desde o desenho.**

> Prova de conceito da proposta **Mumbuca+**, desenvolvida a partir do relatório *"Renda Básica de Cidadania — Mumbuca"* (Faculdade Sebrae, Administração de Empresas, Turma T9, disciplina Empreendedorismo & Impacto Social, 2026). Não é um sistema oficial da Prefeitura de Maricá nem do Banco Comunitário Mumbuca. Roda na **Solana devnet**.

---

## Sumário

1. [O problema](#1-o-problema)
2. [O que o Mumbuca+ faz](#2-o-que-o-mumbuca-faz)
3. [A rota do dinheiro: BRL → BRS → Mumbuca+](#3-a-rota-do-dinheiro-brl--brs--mumbuca)
4. [Parceiro de liquidez e compliance](#4-parceiro-de-liquidez-e-compliance)
5. [Tese jurídica: o Mum+ é um utility token do ecossistema de Maricá](#5-tese-jurídica-o-mum-é-um-utility-token-do-ecossistema-de-maricá)
6. [Fundamentos de mercado financeiro aplicados](#6-fundamentos-de-mercado-financeiro-aplicados)
7. [Compliance by design](#7-compliance-by-design)
8. [Arquitetura](#8-arquitetura)
9. [Fluxo ponta a ponta](#9-fluxo-ponta-a-ponta)
10. [Engenharia web3 e segurança](#10-engenharia-web3-e-segurança)
11. [O token Mumbuca+ (Mum+)](#11-o-token-mumbuca-mum)
12. [Como isso fortalece a política pública](#12-como-isso-fortalece-a-política-pública)
13. [Escopo da prova de conceito](#13-escopo-da-prova-de-conceito)
14. [Estrutura do repositório e documentação](#14-estrutura-do-repositório-e-documentação)
15. [Referências](#15-referências)

---

## 1. O problema

A Mumbuca é a moeda social de Maricá (RJ). Criada em 2013 e gerida pelo Banco Comunitário Mumbuca, ela tem paridade fixa com o real (1 Mumbuca = R$ 1,00) e sustenta a Renda Básica de Cidadania do município. Segundo o relatório, em 2026 o programa atende **mais de 93 mil beneficiários**, paga **230 Mumbucas por mês** e movimenta um orçamento anual **acima de R$ 256 milhões**.

O relatório aponta gargalos que a tecnologia pode atacar:

| Gargalo (relatório) | Como a tokenização ajuda |
|---|---|
| Processos físicos: cartões plásticos e papel térmico | Saldo e comprovante 100% digitais, verificáveis on-chain |
| Rastreabilidade e prestação de contas manuais | Cada emissão tem uma assinatura pública, auditável por qualquer pessoa |
| Arranjo fechado, difícil de integrar | Padrão aberto (SPL Token-2022), integrável a carteiras e instituições de pagamento |
| Dependência fiscal exclusiva de repasses públicos | Entrada de recursos por instituições de pagamento abre caminho a recargas e parcerias |

O relatório propõe uma **carteira dupla tokenizada**. Este repositório constrói a **fundação técnica** dessa carteira: a ponte automática, auditável e em conformidade entre o dinheiro que entra pelo sistema de pagamentos e o token que chega ao cidadão.

## 2. O que o Mumbuca+ faz

1. A cidadã escolhe um valor e faz uma **recarga via Pix**.
2. O **parceiro de liquidez** recebe os reais, já com KYC, KYB e KYT aplicados na entrada.
3. O backend do Mumbuca+ **detecta a liquidação** por webhook assinado ou por consulta periódica e **confirma direto na API do parceiro**. Uma notificação sozinha nunca dispara emissão.
4. Com o pagamento liquidado, o backend executa `mint_for_payment` no programa Solana: **entrega contra pagamento (DvP)**.
5. Os **Mumbuca+ (Mum+) aparecem na carteira Phantom** da cidadã, 1 Mum+ para cada R$ 1,00 liquidado.
6. A transação fica **pública e verificável** no Solana Explorer.
7. Nenhum pagamento gera emissão duplicada, mesmo com reenvios, quedas de rede ou reinícios do servidor.

## 3. A rota do dinheiro: BRL → BRS → Mumbuca+

```mermaid
flowchart LR
    A["Cidadã<br/>paga R$ via Pix"] -->|BRL| B["Parceiro de liquidez<br/>KYC · KYB · KYT"]
    B -->|"BRL → BRS<br/>(real tokenizado, Solana)<br/>sem perna de câmbio"| C[("Reserva em BRS<br/>custódia segregada")]
    B -.->|"evento: BRL liquidado"| D["Backend Mumbuca+<br/>valida na API do parceiro"]
    D -->|"DvP: mint 1:1"| E["Programa Mumbuca+<br/>Solana"]
    E -->|"Mum+"| F["Carteira da cidadã<br/>Phantom"]
```

- **BRL:** o cidadão paga em reais, pelo Pix, a moeda que ele já usa.
- **BRS:** o parceiro de liquidez converte os reais em **BRS**, um token referenciado no real que roda na Solana. A conversão BRL→BRS **não tem perna de câmbio**: não há cotação contra moeda estrangeira nem trava de câmbio, e a taxa é 1:1 no mesmo padrão monetário. O BRS fica em **custódia segregada** e forma a **reserva em reais** que lastreia a emissão.
- **Mumbuca+:** com a liquidação do BRL confirmada, o sistema emite **Mum+ na mesma quantidade em reais** na carteira do cidadão. O Mum+ é a camada de **moeda social**: é nela que entram as regras da política pública, como território, incentivo ao comércio local e crédito controlado.

Do começo ao fim, **o valor está sempre denominado em reais**: BRL, depois BRS (real tokenizado) e por fim Mum+ (moeda social com paridade com o real). **Nenhuma perna envolve moeda estrangeira.** E a rota inteira roda numa única rede: o BRS e o Mum+ estão ambos na Solana.

> **Ambientes:** a mesma rota BRL → BRS → Mumbuca+ roda no ambiente de testes do parceiro (Pix simulado) e no ambiente real (Pix de verdade, mínimo de R$ 11). O ativo de reserva (BRS) é definido por uma única variável de ambiente.

## 4. Parceiro de liquidez e compliance

O Mumbuca+ **não guarda dinheiro, não converte moedas e não faz o Pix**. Essas funções ficam com um **parceiro de liquidez regulado**, integrado pela Peragus, que já mantém essa integração em produção. O parceiro fornece:

- **Liquidez:** recebimento do Pix em reais e conversão BRL→BRS.
- **Custódia** segregada da reserva.
- **KYC** (*Know Your Customer*): identificação e verificação de pessoas físicas.
- **KYB** (*Know Your Business*): identificação e verificação de pessoas jurídicas, incluindo beneficiários finais.
- **KYT** (*Know Your Transaction*): monitoramento e triagem das transações, com rastreio de origem e destino dos recursos.
- **PLD/FT:** prevenção à lavagem de dinheiro e ao financiamento do terrorismo, com triagem de listas restritivas e sanções.
- **Eventos assinados** de liquidação (webhook com HMAC-SHA256) e **API de consulta** como fonte da verdade.

| Responsabilidade | Quem cumpre |
|---|---|
| Receber o Pix e liquidar em reais | Parceiro de liquidez |
| KYC, KYB, KYT, PLD/FT e sanções | Parceiro de liquidez |
| Converter BRL em BRS e custodiar a reserva | Parceiro de liquidez |
| Notificar a liquidação (webhook assinado + API de consulta) | Parceiro de liquidez |
| Validar a liquidação, executar o DvP e emitir a moeda social | Mumbuca+ |
| Regras da política pública (território, incentivo, crédito) | Gestor do ecossistema (Município e Banco Comunitário) |

**Por que esse desenho:**
- **Segregação de funções:** a parte financeira regulada fica com quem tem licença, estrutura e responsabilidade por ela. O Mumbuca+ fica com a camada de política pública.
- **Agnóstico de provedor:** o núcleo de emissão só conhece a interface `PaymentProvider`. O parceiro atual, o Mercado Pago (desenhado, ainda sem integração) e um provedor simulado são adaptadores intercambiáveis.
- **Reaproveitamento com risco controlado:** a integração vem de código já usado em produção pela Peragus.

## 5. Tese jurídica: o Mum+ é um utility token do ecossistema de Maricá

### 5.1 A tese

O **Mumbuca+ (Mum+) é um token de utilidade (utility token)** do ecossistema da moeda social de Maricá. Ele dá ao titular acesso a produtos e serviços da rede credenciada do município, dentro das regras de um programa público. Por isso fica **fora do conceito legal de "ativo virtual"** da Lei nº 14.478/2022 e, consequentemente, fora das regras de câmbio aplicáveis a prestadores de serviços de ativos virtuais. **Quem regula o uso desse token é o gestor do próprio ecossistema:** o Município de Maricá, por lei municipal, e o Banco Comunitário Mumbuca, que administra a rede.

### 5.2 Fundamentos

1. **A lei exclui expressamente os tokens de utilidade do conceito de ativo virtual.** O art. 3º da Lei nº 14.478/2022 define ativo virtual como *"a representação digital de valor que pode ser negociada ou transferida por meios eletrônicos e utilizada para realização de pagamentos ou com propósito de investimento"*. No inciso III, exclui os *"instrumentos que provejam ao seu titular acesso a produtos ou serviços especificados ou a benefício proveniente desses produtos ou serviços, a exemplo de pontos e recompensas de programas de fidelidade"*.
2. **O Mum+ é instrumento de acesso a um benefício de programa público.** Ele só é aceito na rede credenciada de Maricá e carrega as regras da política pública: o incentivo de 5% no comércio local e as categorias essenciais do crédito externo (saúde, transporte e emergência), previstos no relatório. Como os pontos de um programa de fidelidade, ele vale dentro de um ecossistema definido por quem o administra.
3. **Não há propósito de investimento.** A paridade é fixa (1 Mum+ = R$ 1,00) e não há rendimento, valorização, oferta pública nem mercado secundário promovido pelo emissor. A CVM, no Parecer de Orientação nº 40/2022, separa os tokens de utilidade dos tokens que são valores mobiliários pela ausência de expectativa de retorno sobre o esforço de terceiros.
4. **Sem "ativo virtual", não há câmbio de ativo virtual.** O art. 76-A da Resolução BCB nº 277/2022, incluído pela Resolução BCB nº 521/2025, leva ao mercado de câmbio a *prestação de serviços de ativos virtuais*. Como o Mum+ não é ativo virtual, a emissão e a circulação dele não entram nessa regra. Além disso, nenhuma etapa da rota envolve moeda estrangeira.
5. **Quem regula o token é o gestor do ecossistema.** A Mumbuca é uma moeda social instituída e disciplinada pelo Município de Maricá (o relatório cita a Lei Municipal nº 3.673/2025) e operada pelo Banco Comunitário Mumbuca. Credenciamento de lojistas, regras de uso, limites e emissão contra entrada de reais são decisões desse gestor. O Mumbuca+ só leva essas regras para um token. As moedas sociais seguem esse modelo desde o Banco Palmas (1998): **lastro em reais, paridade 1:1, circulação territorial e ausência de curso forçado**, como descreve o próprio Banco Central.
6. **Cada camada tem o seu regulador.** A operação financeira fica com quem é regulado para ela:

| Camada | Instrumento | Natureza | Quem regula / responde |
|---|---|---|---|
| Entrada | BRL via Pix | moeda nacional | Banco Central (Pix) e a instituição recebedora (parceiro de liquidez) |
| Reserva | BRS | ativo referenciado no real | Parceiro de liquidez, no regime de prestadores de serviços de ativos virtuais |
| Uso | Mum+ | utility token da moeda social | Município de Maricá e Banco Comunitário Mumbuca |

### 5.3 Como o desenho técnico reforça a tese

- **DvP (Delivery versus Payment):** o Mum+ só é entregue contra liquidação confirmada em reais. Não existe pré-emissão, pré-venda ou oferta pública: o supply nasce exclusivamente de pagamentos liquidados e validados na fonte.
- **Paridade fixa e sem formação de preço:** não há livro de ofertas, cotação nem negociação promovida pelo sistema.
- **Governança on-chain do gestor:** os papéis de administrador e pausador ficam com o gestor do ecossistema, que pode suspender emissões e ajustar limites.
- **Utilidade especificada no código:** o próximo passo é restringir as transferências do Mum+ a carteiras credenciadas (lojistas e beneficiários da rede) com um *transfer hook* do Token-2022. Isso materializa on-chain a "utilidade especificada" do art. 3º, III.

### 5.4 Objeções antecipadas

- **"Um token com paridade em real, aceito na rede, é meio de pagamento."** O Mum+ circula só numa rede credenciada e definida pelo gestor público, para acesso a um benefício de programa, exatamente a hipótese do art. 3º, III. A restrição de transferências a carteiras credenciadas torna essa delimitação verificável on-chain.
- **"Município não pode emitir moeda."** E o Mum+ não é moeda. Emitir moeda é competência da União (CF, art. 21, VII), e legislar sobre sistema monetário é privativo dela (CF, art. 22, VI). O Mum+ é instrumento de um programa municipal, **sem curso forçado**: ninguém é obrigado a aceitá-lo.
- **"A compra de BRS pode ser câmbio pelo art. 76-A, IV."** A aquisição do BRS é feita pelo parceiro de liquidez, que é quem presta o serviço de ativos virtuais e cumpre as obrigações do seu regime. Isso não altera a natureza do Mum+ nem transforma o ecossistema Mumbuca+ em operação de câmbio.

## 6. Fundamentos de mercado financeiro aplicados

| Conceito | Como aparece no Mumbuca+ |
|---|---|
| **DvP (Delivery versus Payment)** | O ativo (Mum+) só é entregue depois da liquidação do pagamento (BRL), eliminando o risco de principal: ninguém recebe token sem ter pago |
| **Finalidade de liquidação** | O BRL é considerado liquidado só pelo status oficial do parceiro, e o Mum+ só é considerado entregue após a confirmação da transação na rede (commitment `confirmed`) |
| **Lastro 1:1 e reserva segregada** | Cada Mum+ corresponde a R$ 1,00 recebido, mantido como BRS em custódia segregada do parceiro |
| **Fonte da verdade (*golden source*)** | A API do parceiro é a fonte oficial do pagamento. O webhook só avisa e nunca decide |
| **Idempotência e exactly-once** | Cada pagamento gera no máximo uma emissão, garantida pelo banco de dados e pelo programa (um recibo on-chain por `paymentRef`) |
| **Reconciliação contínua** | Um reconciliador compara periodicamente o estado local com o do parceiro e o da blockchain, e retoma o que ficou pendente |
| **Trilha de auditoria** | Cada transição de estado e cada evento recebido ficam registrados (append-only) com o corpo original |
| **Máquina de estados de liquidação** | `AWAITING_PAYMENT → RECEIVED → VALIDATING → APPROVED → MINT_PENDING → MINTED` (ou `FAILED`), com transições atômicas |
| **Valores em unidades mínimas** | Todo valor é tratado em centavos inteiros, sem ponto flutuante, eliminando erros de arredondamento |
| **Limites de exposição** | Teto de supply, limite por emissão e valores mínimo e máximo por recarga |

## 7. Compliance by design

- **KYC, KYB e KYT na porta de entrada:** todo real que entra passa pelos controles do parceiro de liquidez antes de existir qualquer emissão.
- **PLD/FT:** a arquitetura respeita a Lei nº 9.613/1998. Origem dos recursos identificada pelo parceiro, rastreabilidade on-chain do destino e trilha de auditoria completa do evento à assinatura on-chain.
- **Travel Rule (Recomendação 16 do GAFI/FATF):** a vinculação entre pagador, pagamento e carteira de destino fica registrada ponta a ponta.
- **LGPD (Lei nº 13.709/2018) e minimização de dados:** a camada Mumbuca+ guarda só o necessário (identificador, carteira, valores e eventos). A identificação civil fica com o parceiro regulado. A demonstração usa apenas dados fictícios, sem CadÚnico.
- **Segregação de funções e menor privilégio:** a chave que administra o programa é separada da conta que emite. O emissor só tem o papel de emitir, e o administrador e o pausador ficam com o gestor.
- **Circuit breaker:** a pausa de emergência suspende novas emissões sem afetar saldos.
- **Gestão de chaves:** a chave de emissão fica só no servidor, em variável de ambiente, e nunca no navegador nem no repositório.
- **Transparência para órgãos de controle:** cada emissão tem uma assinatura pública verificável no explorador. O painel do operador mostra origem, valores, estado e divergências de cada pagamento.

## 8. Arquitetura

```mermaid
flowchart TB
    subgraph Usuarios["Usuários"]
        C["Cidadã<br/>navegador + Phantom"]
        O["Operador<br/>painel de gestão"]
    end

    subgraph Backend["Backend Mumbuca+ (Node.js + TypeScript)"]
        API["API + Dashboard<br/>(login)"]
        WH["POST /webhooks/payments<br/>verifica assinatura HMAC"]
        PP["PaymentProvider<br/>Parceiro · Simulado · Mercado Pago"]
        PROC["Processador de liquidação<br/>máquina de estados + DvP"]
        REC["Reconciliador<br/>consulta periódica"]
        WR["Registro de carteiras"]
        MS["Serviço de emissão<br/>chave do minter só no servidor"]
        DB[("Postgres<br/>pagamentos e trilha de auditoria")]
    end

    LP["Parceiro de liquidez<br/>Pix · KYC · KYB · KYT · custódia"]
    SC["Programa Mumbuca+ (Anchor)<br/>Token-2022 · Solana devnet"]
    EX["Solana Explorer<br/>verificação pública"]

    C --> API
    O --> API
    API --> PROC
    LP -->|webhook assinado| WH --> PROC
    REC --> PROC
    PROC <--> PP <--> LP
    PROC --> WR
    PROC --> MS --> SC
    PROC <--> DB
    SC --> EX
    SC -->|Mum+| C
```

| Módulo | Responsabilidade |
|---|---|
| Programa Anchor | Emissão controlada, teto de supply, pausa e recibo on-chain por pagamento (bloqueio de emissão duplicada) |
| PaymentProvider | Interface única para qualquer instituição de pagamento ou parceiro de liquidez |
| Webhook Handler | Recebe eventos, verifica a assinatura e registra sem confiar no conteúdo |
| Validador | Consulta o pagamento na API oficial do parceiro e confere status, valor e referência |
| Registro de carteiras | Liga cada usuário (fictício na demo) a um endereço Solana validado (chave pública base58) |
| Serviço de emissão | Simula, envia `mint`, acompanha a confirmação e recupera falhas sem duplicar |
| Banco de transações | Histórico completo e auditável de cada pagamento e transição |
| Dashboard | Visão da cidadã (saldo, recarga, histórico) e do operador (todos os pagamentos, assinaturas, ações) |

**Tecnologias:** Rust e Anchor 1.2 (programa), SPL Token-2022 com metadata on-chain (token), Solana CLI (implantação), Node.js 22, TypeScript, Fastify e Postgres (backend), `@solana/web3.js` (blockchain), React e Vite (dashboard), Phantom (carteira), Railway (hospedagem).

## 9. Fluxo ponta a ponta

```mermaid
sequenceDiagram
    autonumber
    actor Cidada as Cidadã
    participant Dash as Dashboard
    participant API as Backend Mumbuca+
    participant LP as Parceiro de liquidez
    participant SC as Programa Mum+ (Solana)

    Cidada->>Dash: Recarregar R$ 50
    Dash->>API: POST /api/payments
    API->>LP: cotação + transferência BRL→BRS (metadata: id do pagamento)
    LP-->>API: Pix copia-e-cola + QR
    API-->>Dash: exibe QR (Aguardando Pix)
    Cidada->>LP: paga o Pix (R$ 50)
    Note over LP: KYC · KYB · KYT
    LP-->>API: webhook assinado "transfer.updated"
    Note over API: o aviso nunca decide sozinho
    API->>LP: GET /transfers/{id}
    LP-->>API: BRL liquidado = R$ 50,00
    API->>API: valida valor, referência e carteira
    API->>SC: DvP: mint_for_payment(paymentRef, 50 Mum+)
    SC-->>API: assinatura + confirmação
    API-->>Dash: Emitido ✓ + link Solana Explorer
    SC-->>Cidada: 50 Mum+ na Phantom
```

### Máquina de estados de cada pagamento

```mermaid
stateDiagram-v2
    [*] --> AWAITING_PAYMENT: cobrança criada
    AWAITING_PAYMENT --> RECEIVED: evento do parceiro
    RECEIVED --> VALIDATING: consulta à fonte da verdade
    VALIDATING --> AWAITING_PAYMENT: ainda não liquidado
    VALIDATING --> APPROVED: BRL liquidado
    VALIDATING --> FAILED: rejeitado / expirado / abaixo do mínimo / carteira inexistente
    APPROVED --> MINT_PENDING: transação enviada (assinatura gravada)
    MINT_PENDING --> MINTED: confirmada na blockchain
    MINT_PENDING --> APPROVED: revertida sem emissão
    APPROVED --> FAILED: revert definitivo após várias tentativas
    MINTED --> [*]
    FAILED --> [*]
```

Falhas temporárias, como instabilidade de rede, timeout ou parceiro fora do ar, **não** levam a `FAILED`: o pagamento fica no estado em que está e o reconciliador tenta de novo.

## 10. Engenharia web3 e segurança

**Zero emissão duplicada, em quatro camadas:**
1. Cada evento do parceiro é registrado pelo seu identificador e o repetido é descartado.
2. Cada pagamento muda de estado com atualização condicional e atômica no Postgres, segura contra concorrência entre webhook e reconciliador.
3. Antes de reenviar uma emissão incerta, o backend verifica se já existe o recibo on-chain (PDA) daquele pagamento e recupera a assinatura pela primeira transação do recibo. Se a transação expirou sem recibo, o reenvio é seguro.
4. **No próprio programa:** `mint_for_payment` cria uma conta de recibo (PDA `["receipt", paymentRef]`) por pagamento. Uma segunda emissão com o mesmo `paymentRef` falha na própria rede, uma garantia final que não depende do backend.

**Práticas de engenharia on-chain:**
- **`paymentRef` determinístico:** `keccak256("<provedor>:<id do pagamento>")` liga cada emissão, de forma única e verificável, ao pagamento que a originou. Ele também é a semente da PDA de recibo.
- **PDAs (Program Derived Addresses):** a configuração, o mint e cada recibo são contas derivadas do programa (`["config"]`, `["mint"]`, `["receipt", paymentRef]`). A autoridade de emissão é a PDA de configuração, então nenhuma chave privada consegue emitir Mum+ fora das regras do programa.
- **Controle de acesso por papéis** no estado do programa: `admin`, `minter` e `pauser`, separados.
- **Erros customizados do programa** (`Unauthorized`, `Paused`, `InvalidAmount`, `ExceedsMaxPerTx`, `CapExceeded`): decodificados pelo backend para decidir entre tentar de novo e falhar.
- **Simulação antes do envio:** cada transação é simulada (`simulateTransaction`) antes de ser transmitida. Uma rejeição previsível nunca chega à rede.
- **Classificação de falhas e expiração de blockhash:**
  - erro do programa é definitivo;
  - erro de rede, timeout ou falta de SOL são transitórios;
  - se uma transação expira sem recibo on-chain, o reenvio é seguro e comprovado.
- **Token-2022 com metadata on-chain:** nome e símbolo gravados no próprio mint, sem depender de serviços externos.
- **Eventos** (`MintedForPayment`) para auditoria e indexação.
- **Endereços validados** (chaves públicas base58 de 32 bytes) no registro de carteiras.
- **Testes:**
  - programa testado em Rust contra o runtime da Solana (SVM);
  - backend construído com TDD (vitest), incluindo integração real contra um validador local.

**Outras garantias:**
- **Nada é emitido só porque chegou uma notificação.** O pagamento sempre é confirmado na fonte da verdade.
- O webhook é autenticado por HMAC-SHA256, com janela de tempo e comparação em tempo constante.
- O programa limita o dano de uma eventual chave vazada: teto total, limite por emissão e pausa de emergência.
- Toda a URL pública fica atrás de login. Desconhecidos não criam recargas nem disparam emissões.

## 11. O token Mumbuca+ (Mum+)

| Propriedade | Valor |
|---|---|
| Natureza | Utility token do ecossistema da moeda social de Maricá (ver seção 5) |
| Padrão | SPL Token-2022 (extensões MetadataPointer e TokenMetadata) |
| Nome / símbolo | Mumbuca+ / Mum+ |
| Decimais | 2. 1 unidade = R$ 0,01, então centavos viram unidades sem conversão |
| Autoridade de emissão | PDA do programa: nenhuma chave privada emite fora das regras on-chain |
| Supply inicial | 0. Tudo é emitido contra pagamento liquidado (DvP) |
| Teto de supply | 10.000.000 Mum+ |
| Limite por emissão | 20.000 Mum+ (ajustável pelo administrador) |
| Papéis | Administrador (gestor), Emissor (backend), Pausador (gestor) |
| Pausa | Suspende só novas emissões. Saldos e transferências continuam |
| Rastreabilidade | Evento `MintedForPayment` e conta de recibo on-chain por pagamento |
| Rede | Solana devnet, com o programa Anchor implantado pela Solana/Anchor CLI |

**Paridade:** 1 Mum+ = R$ 1,00.

## 12. Como isso fortalece a política pública

| Objetivo do relatório | Contribuição do Mumbuca+ |
|---|---|
| Modernização e digitalização | Moeda social em padrão aberto, sem cartão nem papel |
| Rastreabilidade | Cada real que entra gera uma emissão pública e auditável |
| Integração com instituições de pagamento | Provedores plugáveis: Pix hoje, outros amanhã |
| Inclusão financeira | Funciona com Pix e carteira digital, sem conta bancária tradicional |
| Sustentabilidade operacional | Menos atendimento manual e logística física, e base para receitas próprias como recargas e parcerias |
| Economia local | O Mum+ é a camada das regras de território e incentivo (5% no comércio local e crédito externo controlado, módulos futuros do relatório) |
| Transparência e controle | Painel de gestão e explorador público para órgãos de controle |

## 13. Escopo da prova de conceito

**Está no escopo:**
- Programa Anchor e token Token-2022 na Solana devnet.
- Recarga Pix pelo parceiro de liquidez, nos ambientes de teste e real (R$ 11).
- Validação na fonte da verdade.
- DvP automático e idempotente.
- Dashboard da cidadã e do operador.
- Simulação local para contingência.

**Fica para fases futuras:**
- Restrição de transferências a carteiras credenciadas (transfer hook do Token-2022).
- Carteira dupla e incentivo de 5%.
- Crédito externo de 25%.
- Maquininhas próprias.
- Assistente de IA.
- Integração com o Mercado Pago.
- Resgate de Mum+ em reais.
- Prova de reservas on-chain.
- Rede principal (mainnet).

**Status:** a implementação está completa; o deploy do programa na devnet e o ensaio ao vivo ainda estão pendentes. Veja o [design](docs/superpowers/specs/2026-11-23-mumbuca-plus-mvp-design.md) e o [plano de implementação](docs/superpowers/plans/2026-11-23-mumbuca-plus-mvp.md).

## 14. Estrutura do repositório e documentação

```
anchor/        programa mumbuca_plus (Rust/Anchor) e testes
backend/       API, webhook, processador, emissão (Node.js + TypeScript)
frontend/      dashboard (React + Vite)
docs/
  superpowers/specs/   documento de design
  superpowers/plans/   plano de implementação
  solana-deploy.md     tutorial de implantação na devnet
  demo-runbook.md      roteiro da demonstração e contingências
```

### Pré-requisitos

- Node.js 22 e npm.
- PostgreSQL acessível (local ou do Railway).
- Para o programa on-chain: WSL (Ubuntu) com a Solana CLI e o Anchor, e a Rust toolchain.
- Variáveis de ambiente: copie `backend/.env.example` para `backend/.env` e preencha (nunca versione esse arquivo).

### Rodar localmente

```bash
npm ci
npm run dev:api   # API em http://localhost:3000
npm run dev:web   # dashboard em http://localhost:5173 (proxy para a API)
```

Build de produção (a API serve o dashboard compilado). Sobre http local, use `NODE_ENV=development` para o cookie de sessão não exigir HTTPS:

```bash
npm ci && npm run build && npm start
```

### Testes

```bash
npm test -w backend
npm test -w frontend
npm run test:chain -w backend   # integração contra solana-test-validator no WSL
# programa Anchor, no WSL, dentro de anchor/:
cargo test
```

### Implantar o programa na devnet

Veja [docs/solana-deploy.md](docs/solana-deploy.md).

### Implantar no Railway e demonstrar

O `railway.json` na raiz configura build, start e healthcheck. O passo a passo do deploy, a checklist da véspera, o roteiro da apresentação e as contingências estão em [docs/demo-runbook.md](docs/demo-runbook.md).

## 15. Referências

- Relatório *"Renda Básica de Cidadania — Mumbuca"*. Faculdade Sebrae, 2026. Inclui as fontes FGV, UFF, Banco Mumbuca, CODEMAR e Prefeitura de Maricá citadas nele.
- Brasil. **Constituição Federal**, arts. 21, VII, e 22, VI (competência da União sobre moeda e sistema monetário).
- Brasil. **Lei nº 14.478/2022**, marco legal dos prestadores de serviços de ativos virtuais. Art. 3º: definição de ativo virtual e exclusões. [planalto.gov.br](https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2022/lei/l14478.htm)
- Brasil. **Lei nº 12.865/2013**, arranjos e instituições de pagamento.
- Brasil. **Lei nº 9.613/1998**, prevenção à lavagem de dinheiro.
- Brasil. **Lei nº 13.709/2018** (LGPD), proteção de dados pessoais.
- Banco Central do Brasil. **Resoluções BCB nº 519, 520 e 521/2025**, sobre prestadores de serviços de ativos virtuais e a inclusão de operações com ativos virtuais no mercado de câmbio (art. 76-A da Resolução BCB nº 277/2022). [Texto da Resolução BCB nº 521](https://www.bcb.gov.br/estabilidadefinanceira/exibenormativo?tipo=Resolu%C3%A7%C3%A3o%20BCB&numero=521)
- Comissão de Valores Mobiliários. **Parecer de Orientação nº 40/2022**, criptoativos e o mercado de valores mobiliários.
- GAFI/FATF. **Recomendação 16** (Travel Rule) e orientações sobre ativos virtuais e VASPs.
- Banco Central do Brasil. Apresentação sobre moedas sociais e bancos comunitários. [bcb.gov.br](https://www.bcb.gov.br/pre/microFinancas/arquivos/horario_arquivos/apres_62.pdf)
- Revista Pesquisa FAPESP. *Bancos comunitários impulsionam o desenvolvimento local*. [revistapesquisa.fapesp.br](https://revistapesquisa.fapesp.br/bancos-comunitarios-impulsionam-o-desenvolvimento-local/)
- Anchor: [anchor-lang.com](https://www.anchor-lang.com)
- Solana: [solana.com/docs](https://solana.com/docs)
- Solana Explorer (devnet): [explorer.solana.com](https://explorer.solana.com/?cluster=devnet)

---

*Mumbuca+ é uma proposta de modernização de política pública. Os tokens desta demonstração circulam apenas em rede de testes.*
