# Deploy do Mumbuca+ na Solana devnet

Tutorial para o dono do projeto. Todos os comandos rodam no **WSL (Ubuntu)**, salvo indicação contrária.

Nomes usados (conferidos contra o IDL em `backend/src/chain/idl/mumbuca_plus.json`):
- Instruções: `initialize`, `mint_for_payment`, `pause`, `unpause`, `set_max_mint_per_tx`, `set_minter`, `set_pauser`.
- Contas/PDAs: `config` (seed `"config"`), `mint` (seed `"mint"`, token Token-2022) e `PaymentReceipt` (seeds `"receipt"` + `payment_ref`).
- Program id esperado: `HfFamsTJgSXssGkCgBqtNsDLD694peLYBbAzs4kuYzZm`.

## 1. Preparar o WSL e a devnet

```bash
solana --version
anchor --version
solana config set --url devnet
```

## 2. Keypair do dono (admin e pauser) e SOL de devnet

```bash
solana address            # pubkey da keypair CLI do dono: é o admin e o pauser
solana airdrop 2          # repita até ter ~5 SOL; se falhar (limite), use o faucet oficial: https://faucet.solana.com
solana balance
```

O deploy do programa custa bem mais que 2 SOL na devnet (o rent do programa depende do tamanho do `.so`). Tenha cerca de **5 SOL** na carteira do dono antes do passo 4, e mais **1 SOL** para o minter (passo 3). Se o deploy falhar por saldo, peça mais SOL e rode `anchor deploy` de novo.

## 3. Keypair do minter (fora do repositório)

```bash
solana-keygen new -o ~/mumbuca-minter.json
solana address -k ~/mumbuca-minter.json     # anote: MINTER_PUBKEY
solana transfer <MINTER_PUBKEY> 1 --allow-unfunded-recipient
```

Nunca coloque esse arquivo dentro do repositório. O conteúdo (o array JSON) vai **somente** para a variável `MINTER_SECRET_KEY` (`.env` local e Railway).

## 4. Build e deploy do programa

O build é muito mais rápido fora do OneDrive. Copie a pasta `anchor/` para o home do WSL e trabalhe de lá:

```bash
mkdir -p ~/mumbuca-anchor
cp -r /mnt/c/Users/ferna/OneDrive/Desktop/MumbucaPlus/anchor/. ~/mumbuca-anchor/
cd ~/mumbuca-anchor
anchor build
anchor deploy --provider.cluster devnet
```

O program id é determinado pela keypair `target/deploy/mumbuca_plus-keypair.json` (esperado: `HfFamsTJgSXssGkCgBqtNsDLD694peLYBbAzs4kuYzZm`). Guarde esse arquivo: sem ele não é possível atualizar o programa. Se você regenerar a keypair, rode `anchor keys sync`, refaça o `anchor build` e atualize `PROGRAM_ID` em todos os lugares. Anote o `PROGRAM_ID` impresso no deploy.

**Se o deploy falhar por formato de programa (SBPF).** O `anchor` 1.2 compila por padrão em SBPF v3, que a devnet pode rejeitar. Nesse caso recompile com SBPF v1 e repita o deploy:

```bash
anchor build --arch v1
anchor deploy --provider.cluster devnet
```

(`--arch` é repassado ao `cargo build-sbf`, que aceita `v0`, `v1`, `v2`, `v3`, `v4`; verificado com `anchor build --help` e `cargo-build-sbf --help`.)

## 5. Inicializar o programa (imediatamente após o deploy)

Rode este passo **logo depois** do `anchor deploy`. A instrução `initialize` usa uma PDA de config fixa e qualquer pessoa pode chamá-la antes de você: quem chamar primeiro define admin, minter e pauser.

Rode **dentro do WSL**, onde existem o `solana` e a keypair `~/.config/solana/id.json`. Use a cópia do repositório no WSL (por exemplo `~/MumbucaPlus`, ou o caminho `/mnt/c/Users/ferna/OneDrive/Desktop/MumbucaPlus`) e instale as dependências **no WSL** (Node 22+ no WSL):

```bash
cd ~/MumbucaPlus        # ou: cd /mnt/c/Users/ferna/OneDrive/Desktop/MumbucaPlus
npm install
export SOLANA_RPC_URL=https://api.devnet.solana.com
export PROGRAM_ID=HfFamsTJgSXssGkCgBqtNsDLD694peLYBbAzs4kuYzZm   # o valor anotado no passo 4
npm run init:program -w backend -- \n  --admin-keypair ~/.config/solana/id.json \n  --minter <MINTER_PUBKEY> \n  --pauser $(solana address)
```

Parâmetros fixos: `cap` = `1000000000` e `max_mint_per_tx` = `2000000` (unidades do token, 2 decimais: `100` = 1 Mum+). O script imprime as PDAs `config` e `mint`, `config.admin`, `config.minter`, `config.pauser` e os links do explorer, e nunca imprime chaves privadas.

**Verificação obrigatória.** O script já compara `config.admin` com a sua keypair CLI e `config.minter`/`config.pauser` com os valores informados, e sai com erro se algo não bater. Para conferir de novo a qualquer momento (sem enviar transação):

```bash
npm run init:program -w backend -- --verify \
  --admin-keypair ~/.config/solana/id.json --minter <MINTER_PUBKEY> --pauser $(solana address)
```

Deve terminar com `OK: config.admin/minter/pauser match the expected values.`. Se o `initialize` falhar com a mensagem "initialize falhou" (programa já inicializado), o script também confere a config existente e avisa. Se `admin` ou `minter` forem outros, alguém inicializou antes de você: **faça um novo deploy com um novo program id** (gere outra keypair do programa, `anchor keys sync`, `anchor build`, `anchor deploy`) e repita este passo.

**URI dos metadados do token.** O `uri` é fixado no `initialize` e não existe instrução para alterá-lo. Por padrão é vazio. Para definir, use `--uri <url>` na primeira (e única) chamada.

## 6. Teste manual de emissão

**Não rode `smoke:mint` agora**: hoje ele ainda é o script da versão EVM. Ele só passa a ser a versão Solana depois da Task 15. Quando a Task 15 existir, com `MINTER_SECRET_KEY`, `SOLANA_RPC_URL` e `PROGRAM_ID` no `.env`:

1. Emita 1 Mum+ (`100` unidades) para a Phantom do dono com `npm run smoke:mint -w backend`.
2. Na Phantom (rede devnet), veja o token chegar. Abra a transação no Solana Explorer (cluster devnet).
3. Repita o mesmo `payment_ref`: a segunda emissão deve falhar, pois a PDA de recibo já existe.

## 7. Opcional: build verificável

```bash
cd ~/mumbuca-anchor
anchor build --verifiable
```

Requer Docker. Depois, a verificação pública do programa pode ser feita com `solana-verify` (instale conforme a documentação oficial do Solana).

## 8. Conferir o recibo no explorador

A PDA de recibo (`["receipt", payment_ref]`) de cada pagamento é a prova on-chain de que aquele pagamento foi emitido uma única vez. Abra essa conta no Solana Explorer (cluster devnet): ela existe apenas se a emissão ocorreu. Esse é o argumento visual do DvP e da deduplicação on-chain.
