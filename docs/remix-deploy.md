# Deploy do Mumbuca+ (Mum+) no Remix — Polygon Amoy

Este guia leva você, passo a passo, do zero até o contrato `MumbucaPlus` publicado e verificado na rede de testes **Polygon Amoy**, usando apenas o navegador (Remix) e a MetaMask. Não é preciso instalar nada.

> **Aviso:** o Mum+ é um token de DEMONSTRAÇÃO, só para testnet. Não tem valor monetário.

## Antes de começar

- MetaMask instalada no navegador.
- Arquivo `contracts/contracts/MumbucaPlus.sol` deste repositório (você vai colar o conteúdo no Remix).
- **Nunca** cole chaves privadas em arquivos do repositório, em chats ou em prints. A chave da conta minter (passo 2) só pode ir para o `.env` local do backend (que não vai para o git) e para as variáveis do Railway.

Valores usados neste guia:

| Item | Valor |
|---|---|
| Nome / símbolo / decimais | `Mumbuca+` / `Mum+` / 18 |
| Compilador | `0.8.24`, optimizer ligado com `200` runs |
| OpenZeppelin | `5.1.0` (mesma versão do `contracts/package.json`) |
| `cap_` (teto total, 10.000.000 Mum+) | `10000000000000000000000000` |
| `maxMintPerTx_` (máx. por mint, 20.000 Mum+) | `20000000000000000000000` |

---

## Passo 1 — Adicionar a Polygon Amoy na MetaMask e pegar POL de teste

1. Na MetaMask, abra a lista de redes e escolha adicionar uma rede manualmente. Preencha:
   - **Chain ID:** `80002`
   - **Símbolo da moeda:** `POL`
   - **Block explorer:** `https://amoy.polygonscan.com`
   - Nome da rede: `Polygon Amoy` (qualquer nome serve).
   - **RPC URL:** use a URL pública de RPC da Amoy listada na documentação oficial da Polygon (https://docs.polygon.technology). A MetaMask pode também sugerir a rede automaticamente.
2. Selecione a rede Polygon Amoy.
3. Pegue POL de teste na **faucet oficial da Polygon: https://faucet.polygon.technology** (escolha a rede Amoy, cole o endereço da sua conta principal e confirme). Aguarde o saldo aparecer na MetaMask.

## Passo 2 — Criar a conta "minter" do backend

O backend precisa de uma carteira própria que assina os `mint`. Ela deve ser **diferente** da sua conta principal (admin).

1. Na MetaMask, crie uma **segunda conta** (por exemplo "Mumbuca minter").
2. Copie o **endereço público** dela (começa com `0x`). Vamos chamá-lo de `ENDERECO_MINTER`.
3. Exporte a **chave privada** dessa segunda conta (menu da conta → Detalhes da conta → mostrar chave privada). Guarde-a **somente** em:
   - o `.env` local do backend (variável `MINTER_PRIVATE_KEY`), que não é versionado; e
   - as variáveis do serviço no Railway.

   Não a cole em arquivos do repositório, em documentos ou em conversas.
4. Da sua conta principal, envie cerca de **0,5 POL** para `ENDERECO_MINTER`, para pagar o gás dos mints. (A conta minter também pode usar a faucet.)

## Passo 3 — Colar e compilar o contrato no Remix

1. Abra https://remix.ethereum.org.
2. No explorador de arquivos, crie um arquivo chamado `MumbucaPlus.sol` e cole todo o conteúdo de `contracts/contracts/MumbucaPlus.sol`.
3. **Fixe a versão da OpenZeppelin:** nas quatro linhas `import` do topo, acrescente `@5.1.0` logo depois de `@openzeppelin/contracts`. Fica assim:

   ```solidity
   import {ERC20} from "@openzeppelin/contracts@5.1.0/token/ERC20/ERC20.sol";
   import {ERC20Capped} from "@openzeppelin/contracts@5.1.0/token/ERC20/extensions/ERC20Capped.sol";
   import {AccessControl} from "@openzeppelin/contracts@5.1.0/access/AccessControl.sol";
   import {Pausable} from "@openzeppelin/contracts@5.1.0/utils/Pausable.sol";
   ```

   Isso faz o Remix baixar exatamente a versão 5.1.0, igual à do projeto. (Essa alteração é só no Remix; o arquivo do repositório continua sem o `@5.1.0`.)
4. Abra a aba **Solidity Compiler** e configure:
   - **Compiler:** `0.8.24`
   - Em *Advanced Configurations*, marque **Enable optimization** com valor `200`.
5. Clique em **Compile MumbucaPlus.sol**. Deve aparecer um check verde, sem erros.

## Passo 4 — Fazer o deploy (Injected Provider – MetaMask)

1. Abra a aba **Deploy & Run Transactions**.
2. Em **Environment**, escolha **Injected Provider – MetaMask**. A MetaMask pede para conectar: aceite, com a **conta principal** selecionada e a rede **Polygon Amoy**. Confirme que o Remix mostra a rede/Chain ID `80002`.
3. Em **Contract**, escolha `MumbucaPlus`.
4. Preencha os parâmetros do construtor:
   - `admin`: o endereço da **sua conta principal** (a que vai administrar o contrato).
   - `cap_`: `10000000000000000000000000`
   - `maxMintPerTx_`: `20000000000000000000000`

> **ATENÇÃO — confira o `admin` antes de confirmar!** O construtor **não valida** o endereço de `admin`. Se você colocar um endereço errado (ou `0x000…000`), ninguém terá o papel de administrador do contrato e **isso não pode ser corrigido depois** — será preciso fazer um novo deploy. Copie o endereço direto da MetaMask e compare os primeiros e últimos caracteres antes de clicar em **Deploy**.

5. Clique em **Deploy** e confirme a transação na MetaMask.
6. Quando a transação for confirmada, o contrato aparece em **Deployed Contracts**. Copie o endereço dele (ícone de copiar). Esse é o `TOKEN_ADDRESS`.

## Passo 5 — Dar o papel de minter à conta do backend

Ainda em **Deployed Contracts**, expanda o contrato `MumbucaPlus`.

1. Na função `MINTER_ROLE` (botão azul, só leitura), clique e copie o valor retornado (um `bytes32`).
2. Na função `grantRole`, preencha:
   - `role`: o valor do `MINTER_ROLE` copiado acima
   - `account`: `ENDERECO_MINTER` (o endereço público da conta do passo 2)
3. Clique em **transact** e confirme na MetaMask **com a conta principal** (somente o admin pode conceder papéis).
4. Confira: chame `hasRole` com `role` = `MINTER_ROLE` e `account` = `ENDERECO_MINTER`. Deve retornar `true`.

## Passo 6 — Teste manual de mint

Aqui você prova, na prática, que o mint funciona e que a mesma referência de pagamento não pode ser usada duas vezes. Faça com a **conta principal**.

1. **Dar o papel de minter temporariamente à sua conta principal:** chame `grantRole` com `role` = valor de `MINTER_ROLE` e `account` = o endereço da sua conta principal. Confirme na MetaMask.
2. **Mintar 1 Mum+:** chame `mint` com:
   - `to`: o endereço da sua conta principal
   - `amount`: `1000000000000000000` (isto é 1 Mum+, pois o token tem 18 casas decimais)
   - `paymentRef`: `0x0000000000000000000000000000000000000000000000000000000000000001`

   Confirme na MetaMask.
3. **Ver o saldo:** chame `balanceOf` com o endereço da sua conta principal. Deve retornar `1000000000000000000`.
4. **Testar a proteção contra repetição:** chame `mint` de novo com **exatamente os mesmos** valores (mesmo `paymentRef` terminado em `…0001`). A transação deve falhar com o erro **`PaymentRefAlreadyUsed`**. Em alguns casos o Remix mostra esse erro já na estimativa de gás, antes de abrir a MetaMask — é o comportamento esperado. Também dá para consultar `paymentRefUsed` com o `paymentRef` `0x…0001`: retorna `true`.
5. **Remover o papel temporário (importante):** chame `revokeRole` com `role` = valor de `MINTER_ROLE` e `account` = o endereço da sua conta principal. Confirme na MetaMask. Depois confira com `hasRole` que retorna `false`.

Assim, no fim, apenas a conta minter do backend (passo 5) pode mintar.

> Referências de pagamento são únicas para sempre: o `0x…0001` usado aqui fica "queimado" neste contrato. O backend usará outras referências.

## Passo 7 — Ver o token na MetaMask

1. Na MetaMask (conta principal, rede Amoy), vá em **Tokens → Importar tokens**.
2. Preencha:
   - **Endereço do contrato do token:** o `TOKEN_ADDRESS`
   - **Símbolo:** `Mum+`
   - **Casas decimais:** `18`
3. Confirme. Você deve ver o saldo de `1 Mum+` do teste do passo 6.

## Passo 8 — Verificar o contrato no explorer

Verificar publica o código-fonte no explorer, para qualquer pessoa conferir o contrato.

1. Crie uma chave de API gratuita no Etherscan (a chave da API v2 funciona para várias redes, incluindo a Polygon Amoy). Não coloque essa chave em arquivos do repositório.
2. No Remix, ative o plugin **Contract Verification** (pelo gerenciador de plugins, se ainda não estiver ativo) e abra-o.
3. Selecione o contrato `MumbucaPlus` já implantado, escolha a rede **Polygon Amoy** e informe o `TOKEN_ADDRESS`. Informe a chave da API do Etherscan quando o plugin pedir.
4. Informe os **argumentos do construtor exatamente iguais** aos do passo 4 (`admin`, `cap_` e `maxMintPerTx_`, com os mesmos valores). Se algum valor diferir, a verificação falha.
5. Envie a verificação e aguarde. Depois abra o contrato no explorer (`https://amoy.polygonscan.com/address/<TOKEN_ADDRESS>`) e confirme que o código aparece como verificado.

Se a verificação falhar, confira nesta ordem: versão do compilador `0.8.24`, optimizer `200`, imports com `@5.1.0` e os argumentos do construtor.

## Passo 9 — Anotar o que o backend precisa

Anote (fora do git, ou nas variáveis do Railway):

- `TOKEN_ADDRESS`: endereço do contrato (passo 4).
- Hash da transação de deploy (aparece no console do Remix e na MetaMask, aba Atividade) — útil para auditoria.
- `ENDERECO_MINTER`: endereço público da conta minter (passo 2).
- `MINTER_PRIVATE_KEY`: chave privada da conta minter. Vai **somente** para o `.env` local e para as variáveis do Railway.

Envie ao time apenas o `TOKEN_ADDRESS` (público) e o hash da transação. **Nunca** envie a chave privada.

---

## Referência rápida do contrato

- Papéis: `DEFAULT_ADMIN_ROLE` (concede/revoga papéis, chama `setMaxMintPerTx`), `MINTER_ROLE` (chama `mint`), `PAUSER_ROLE` (chama `pause`/`unpause`). O `admin` do construtor recebe `DEFAULT_ADMIN_ROLE` e `PAUSER_ROLE`.
- `mint(to, amount, paymentRef)`: só `MINTER_ROLE`; falha com `InvalidMintAmount` (valor 0), `MintAmountExceedsLimit` (acima de `maxMintPerTx`) ou `PaymentRefAlreadyUsed` (referência repetida).
- `pause()`: bloqueia apenas novos mints; transferências continuam funcionando. `unpause()` volta ao normal.
- `setMaxMintPerTx(newLimit)`: só o admin altera o limite por mint.
