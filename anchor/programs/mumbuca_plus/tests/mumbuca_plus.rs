//! Integration tests: run the compiled `target/deploy/mumbuca_plus.so` inside LiteSVM
//! (which ships the SPL Token-2022 and Associated Token Account programs by default).
//!
//! Build the program first (`anchor build`), then run `cargo test`.

use anchor_lang::{
    prelude::Pubkey,
    solana_program::instruction::{AccountMeta, Instruction},
    system_program, AccountDeserialize, AnchorDeserialize, Discriminator, Id, InstructionData,
    ToAccountMetas,
};
use anchor_spl::{
    associated_token::AssociatedToken,
    token_2022::Token2022,
    token_interface::{
        spl_token_2022::{
            self,
            extension::{
                metadata_pointer::MetadataPointer, BaseStateWithExtensions, StateWithExtensions,
            },
            state::{Account as SplTokenAccount, Mint as SplMint},
        },
        spl_token_metadata_interface::state::TokenMetadata,
    },
};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use litesvm::{types::TransactionResult, LiteSVM};
use mumbuca_plus::{errors::MumbucaError, events::MintedForPayment, state::{Config, PaymentReceipt}};
use solana_keypair::Keypair;
use solana_message::Message;
use solana_signer::Signer;
use solana_transaction::Transaction;

const CAP: u64 = 1_000_000_000;
const MAX_PER_TX: u64 = 2_000_000;
const URI: &str = "https://mumbuca.example/mum.json";
const LAMPORTS: u64 = 10_000_000_000;

struct Env {
    svm: LiteSVM,
    admin: Keypair,
    minter: Keypair,
    pauser: Keypair,
    citizen: Keypair,
    other: Keypair,
}

fn config_pda() -> Pubkey {
    Pubkey::find_program_address(&[b"config"], &mumbuca_plus::ID).0
}

fn mint_pda() -> Pubkey {
    Pubkey::find_program_address(&[b"mint"], &mumbuca_plus::ID).0
}

fn receipt_pda(payment_ref: &[u8; 32]) -> Pubkey {
    Pubkey::find_program_address(&[b"receipt", payment_ref.as_ref()], &mumbuca_plus::ID).0
}

fn ata(owner: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[owner.as_ref(), Token2022::id().as_ref(), mint_pda().as_ref()],
        &AssociatedToken::id(),
    )
    .0
}

fn pref(n: u8) -> [u8; 32] {
    [n; 32]
}

fn err_code(e: MumbucaError) -> u32 {
    6000 + e as u32
}

impl Env {
    /// Fresh SVM + program + funded actors, without calling `initialize`.
    fn bare() -> Self {
        let mut svm = LiteSVM::new();
        let so = concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/deploy/mumbuca_plus.so");
        let bytes = std::fs::read(so).expect("run `anchor build` first: missing mumbuca_plus.so");
        svm.add_program(mumbuca_plus::ID, &bytes).unwrap();
        svm.warp_to_slot(100);
        let mut env = Env {
            svm,
            admin: Keypair::new(),
            minter: Keypair::new(),
            pauser: Keypair::new(),
            citizen: Keypair::new(),
            other: Keypair::new(),
        };
        for pk in [
            env.admin.pubkey(),
            env.minter.pubkey(),
            env.pauser.pubkey(),
            env.citizen.pubkey(),
            env.other.pubkey(),
        ] {
            env.svm.airdrop(&pk, LAMPORTS).unwrap();
        }
        env
    }

    fn new() -> Self {
        Self::with_limits(CAP, MAX_PER_TX)
    }

    fn with_limits(cap: u64, max_per_tx: u64) -> Self {
        let mut env = Self::bare();
        env.initialize(cap, max_per_tx).expect("initialize");
        env
    }

    fn send(&mut self, ix: Instruction, payer: &Keypair, signers: &[&Keypair]) -> TransactionResult {
        self.svm.expire_blockhash();
        let msg = Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &self.svm.latest_blockhash());
        let tx = Transaction::new(signers, msg, self.svm.latest_blockhash());
        self.svm.send_transaction(tx)
    }

    fn initialize(&mut self, cap: u64, max_per_tx: u64) -> TransactionResult {
        let ix = Instruction {
            program_id: mumbuca_plus::ID,
            accounts: mumbuca_plus::accounts::Initialize {
                admin: self.admin.pubkey(),
                config: config_pda(),
                mint: mint_pda(),
                token_program: Token2022::id(),
                system_program: system_program::ID,
            }
            .to_account_metas(None),
            data: mumbuca_plus::instruction::Initialize {
                cap,
                max_mint_per_tx: max_per_tx,
                minter: self.minter.pubkey(),
                pauser: self.pauser.pubkey(),
                uri: URI.to_string(),
            }
            .data(),
        };
        let admin = self.admin.insecure_clone();
        self.send(ix, &admin, &[&admin])
    }

    fn mint_with(&mut self, signer: &Keypair, recipient: &Pubkey, payment_ref: [u8; 32], amount: u64) -> TransactionResult {
        let ix = Instruction {
            program_id: mumbuca_plus::ID,
            accounts: mumbuca_plus::accounts::MintForPayment {
                minter: signer.pubkey(),
                config: config_pda(),
                receipt: receipt_pda(&payment_ref),
                recipient: *recipient,
                recipient_token_account: ata(recipient),
                mint: mint_pda(),
                token_program: Token2022::id(),
                associated_token_program: AssociatedToken::id(),
                system_program: system_program::ID,
            }
            .to_account_metas(None),
            data: mumbuca_plus::instruction::MintForPayment { payment_ref, amount }.data(),
        };
        let signer = signer.insecure_clone();
        self.send(ix, &signer, &[&signer])
    }

    fn mint(&mut self, payment_ref: [u8; 32], amount: u64) -> TransactionResult {
        let minter = self.minter.insecure_clone();
        let citizen = self.citizen.pubkey();
        self.mint_with(&minter, &citizen, payment_ref, amount)
    }

    fn admin_ix(&mut self, signer: &Keypair, data: Vec<u8>) -> TransactionResult {
        let ix = Instruction {
            program_id: mumbuca_plus::ID,
            accounts: mumbuca_plus::accounts::AdminUpdate { admin: signer.pubkey(), config: config_pda() }
                .to_account_metas(None),
            data,
        };
        let signer = signer.insecure_clone();
        self.send(ix, &signer, &[&signer])
    }

    fn pauser_ix(&mut self, signer: &Keypair, data: Vec<u8>) -> TransactionResult {
        let ix = Instruction {
            program_id: mumbuca_plus::ID,
            accounts: mumbuca_plus::accounts::PauserUpdate { pauser: signer.pubkey(), config: config_pda() }
                .to_account_metas(None),
            data,
        };
        let signer = signer.insecure_clone();
        self.send(ix, &signer, &[&signer])
    }

    fn pause(&mut self, signer: &Keypair) -> TransactionResult {
        self.pauser_ix(signer, mumbuca_plus::instruction::Pause {}.data())
    }

    fn unpause(&mut self, signer: &Keypair) -> TransactionResult {
        self.pauser_ix(signer, mumbuca_plus::instruction::Unpause {}.data())
    }

    fn config(&self) -> Config {
        let acc = self.svm.get_account(&config_pda()).expect("config account");
        Config::try_deserialize(&mut acc.data.as_slice()).unwrap()
    }

    fn receipt(&self, payment_ref: &[u8; 32]) -> PaymentReceipt {
        let acc = self.svm.get_account(&receipt_pda(payment_ref)).expect("receipt account");
        PaymentReceipt::try_deserialize(&mut acc.data.as_slice()).unwrap()
    }

    fn balance(&self, owner: &Pubkey) -> u64 {
        match self.svm.get_account(&ata(owner)) {
            None => 0,
            Some(acc) => StateWithExtensions::<SplTokenAccount>::unpack(&acc.data).unwrap().base.amount,
        }
    }

    fn transfer(&mut self, from: &Keypair, to: &Pubkey, amount: u64) -> TransactionResult {
        // Create the destination ATA (idempotent) and transfer with the plain Token-2022 program.
        let create = Instruction {
            program_id: AssociatedToken::id(),
            accounts: vec![
                AccountMeta::new(from.pubkey(), true),
                AccountMeta::new(ata(to), false),
                AccountMeta::new_readonly(*to, false),
                AccountMeta::new_readonly(mint_pda(), false),
                AccountMeta::new_readonly(system_program::ID, false),
                AccountMeta::new_readonly(Token2022::id(), false),
            ],
            data: vec![1],
        };
        let from = from.insecure_clone();
        self.send(create, &from, &[&from]).expect("create destination ATA");
        let ix = spl_token_2022::instruction::transfer_checked(
            &Token2022::id(),
            &ata(&from.pubkey()),
            &mint_pda(),
            &ata(to),
            &from.pubkey(),
            &[],
            amount,
            2,
        )
        .unwrap();
        self.send(ix, &from, &[&from])
    }
}

fn assert_custom(res: TransactionResult, code: u32) {
    let err = res.expect_err("transaction should fail");
    let dbg = format!("{:?}", err.err);
    assert!(
        dbg.contains(&format!("Custom({code})")),
        "expected Custom({code}), got {dbg}\nlogs:\n{}",
        err.meta.logs.join("\n")
    );
}

#[test]
fn initialize_creates_config_and_token2022_mint_with_metadata() {
    let env = Env::new();

    let cfg = env.config();
    assert_eq!(cfg.admin, env.admin.pubkey());
    assert_eq!(cfg.minter, env.minter.pubkey());
    assert_eq!(cfg.pauser, env.pauser.pubkey());
    assert_eq!(cfg.mint, mint_pda());
    assert_eq!(cfg.cap, CAP);
    assert_eq!(cfg.max_mint_per_tx, MAX_PER_TX);
    assert_eq!(cfg.total_minted, 0);
    assert!(!cfg.paused);

    let mint_acc = env.svm.get_account(&mint_pda()).expect("mint account");
    assert_eq!(mint_acc.owner, Token2022::id());
    let mint = StateWithExtensions::<SplMint>::unpack(&mint_acc.data).unwrap();
    assert_eq!(mint.base.decimals, 2);
    assert_eq!(Option::<Pubkey>::from(mint.base.mint_authority), Some(config_pda()));
    assert_eq!(Option::<Pubkey>::from(mint.base.freeze_authority), None);

    let pointer = mint.get_extension::<MetadataPointer>().unwrap();
    assert_eq!(Option::<Pubkey>::from(pointer.metadata_address), Some(mint_pda()));

    let md = mint.get_variable_len_extension::<TokenMetadata>().unwrap();
    assert_eq!(md.name, "Mumbuca+");
    assert_eq!(md.symbol, "Mum+");
    assert_eq!(md.uri, URI);
    assert_eq!(md.mint, mint_pda());
}

#[test]
fn minter_mints_amount_creates_ata_and_receipt() {
    let mut env = Env::new();
    let citizen = env.citizen.pubkey();
    assert!(env.svm.get_account(&ata(&citizen)).is_none());

    env.mint(pref(1), 1100).expect("mint");

    assert_eq!(env.balance(&citizen), 1100);
    let r = env.receipt(&pref(1));
    assert_eq!(r.payment_ref, pref(1));
    assert_eq!(r.recipient, citizen);
    assert_eq!(r.amount, 1100);
    assert_eq!(r.slot, 100);
    assert_eq!(env.config().total_minted, 1100);
}

#[test]
fn same_payment_ref_fails_second_time() {
    let mut env = Env::new();
    env.mint(pref(2), 1100).expect("first mint");
    let res = env.mint(pref(2), 1100);
    let err = res.expect_err("second mint with same payment_ref must fail");
    assert!(
        err.meta.logs.iter().any(|l| l.contains("already in use")),
        "expected account-already-in-use, logs:\n{}",
        err.meta.logs.join("\n")
    );
    assert_eq!(env.balance(&env.citizen.pubkey()), 1100);
    assert_eq!(env.config().total_minted, 1100);
}

/// Pins Anchor 1.2 precedence: `init`/`init_if_needed` accounts are created before the
/// non-init constraints on `config` run, so a reused `payment_ref` reports "already in use"
/// even when minting is paused (the whole transaction is rolled back either way).
#[test]
fn reused_payment_ref_reports_already_in_use_before_paused() {
    let mut env = Env::new();
    env.mint(pref(19), 1100).expect("first mint");
    let pauser = env.pauser.insecure_clone();
    env.pause(&pauser).expect("pause");

    let err = env.mint(pref(19), 1100).expect_err("reused payment_ref must fail");
    let logs = err.meta.logs.join("\n");
    assert!(logs.contains("already in use"), "expected account-already-in-use, logs:\n{logs}");
    let dbg = format!("{:?}", err.err);
    assert!(
        !dbg.contains(&format!("Custom({})", err_code(MumbucaError::Paused))),
        "expected the receipt init failure, not Paused: {dbg}"
    );
    assert_eq!(env.balance(&env.citizen.pubkey()), 1100);
}

#[test]
fn non_minter_gets_unauthorized() {
    let mut env = Env::new();
    let other = env.other.insecure_clone();
    let citizen = env.citizen.pubkey();
    assert_custom(env.mint_with(&other, &citizen, pref(3), 1100), err_code(MumbucaError::Unauthorized));
    assert!(env.svm.get_account(&receipt_pda(&pref(3))).is_none());
}

#[test]
fn admin_without_minter_role_cannot_mint() {
    let mut env = Env::new();
    let admin = env.admin.insecure_clone();
    let citizen = env.citizen.pubkey();
    assert_custom(env.mint_with(&admin, &citizen, pref(4), 1100), err_code(MumbucaError::Unauthorized));
    assert_eq!(env.balance(&citizen), 0);
}

#[test]
fn exceeds_max_per_tx_fails() {
    let mut env = Env::new();
    assert_custom(env.mint(pref(5), MAX_PER_TX + 1), err_code(MumbucaError::ExceedsMaxPerTx));
    env.mint(pref(6), MAX_PER_TX).expect("exactly max is allowed");
}

#[test]
fn zero_amount_fails_invalid_amount() {
    let mut env = Env::new();
    assert_custom(env.mint(pref(7), 0), err_code(MumbucaError::InvalidAmount));
}

#[test]
fn cap_exceeded_fails() {
    let mut env = Env::new();
    let admin = env.admin.insecure_clone();
    env.admin_ix(&admin, mumbuca_plus::instruction::SetMaxMintPerTx { v: CAP }.data())
        .expect("set_max_mint_per_tx");
    env.mint(pref(8), 1100).expect("first mint");
    assert_custom(env.mint(pref(9), CAP - 1100 + 1), err_code(MumbucaError::CapExceeded));
    env.mint(pref(10), CAP - 1100).expect("mint up to the cap");
    assert_eq!(env.config().total_minted, CAP);
    assert_custom(env.mint(pref(11), 1), err_code(MumbucaError::CapExceeded));
}

#[test]
fn total_minted_overflow_fails_math_overflow() {
    let mut env = Env::with_limits(u64::MAX, u64::MAX);
    env.mint(pref(12), u64::MAX).expect("mint u64::MAX");
    assert_custom(env.mint(pref(13), 1), err_code(MumbucaError::MathOverflow));
}

#[test]
fn set_max_mint_per_tx_rejects_zero_and_non_admin() {
    let mut env = Env::new();
    let admin = env.admin.insecure_clone();
    let other = env.other.insecure_clone();
    assert_custom(
        env.admin_ix(&admin, mumbuca_plus::instruction::SetMaxMintPerTx { v: 0 }.data()),
        err_code(MumbucaError::InvalidAmount),
    );
    assert_custom(
        env.admin_ix(&other, mumbuca_plus::instruction::SetMaxMintPerTx { v: 5 }.data()),
        err_code(MumbucaError::Unauthorized),
    );
    env.admin_ix(&admin, mumbuca_plus::instruction::SetMaxMintPerTx { v: 5 }.data()).unwrap();
    assert_eq!(env.config().max_mint_per_tx, 5);
}

#[test]
fn pause_blocks_mint_but_transfer_still_works() {
    let mut env = Env::new();
    env.mint(pref(14), 1100).expect("mint before pause");
    let pauser = env.pauser.insecure_clone();
    env.pause(&pauser).expect("pause");
    assert!(env.config().paused);

    assert_custom(env.mint(pref(15), 1100), err_code(MumbucaError::Paused));

    let citizen = env.citizen.insecure_clone();
    let other = env.other.pubkey();
    env.transfer(&citizen, &other, 300).expect("transfer while paused");
    assert_eq!(env.balance(&citizen.pubkey()), 800);
    assert_eq!(env.balance(&other), 300);
}

#[test]
fn unpause_restores_mint() {
    let mut env = Env::new();
    let pauser = env.pauser.insecure_clone();
    env.pause(&pauser).expect("pause");
    assert_custom(env.mint(pref(16), 1100), err_code(MumbucaError::Paused));
    env.unpause(&pauser).expect("unpause");
    env.mint(pref(16), 1100).expect("mint after unpause");
    assert_eq!(env.balance(&env.citizen.pubkey()), 1100);
}

#[test]
fn non_pauser_cannot_pause() {
    let mut env = Env::new();
    let admin = env.admin.insecure_clone();
    let minter = env.minter.insecure_clone();
    assert_custom(env.pause(&admin), err_code(MumbucaError::Unauthorized));
    assert_custom(env.pause(&minter), err_code(MumbucaError::Unauthorized));
    assert!(!env.config().paused);
}

#[test]
fn set_minter_switches_minter_and_old_minter_is_unauthorized() {
    let mut env = Env::new();
    let admin = env.admin.insecure_clone();
    let old_minter = env.minter.insecure_clone();
    let new_minter = Keypair::new();
    env.svm.airdrop(&new_minter.pubkey(), LAMPORTS).unwrap();

    // Only the admin can change the minter.
    assert_custom(
        env.admin_ix(&old_minter, mumbuca_plus::instruction::SetMinter { new: old_minter.pubkey() }.data()),
        err_code(MumbucaError::Unauthorized),
    );
    env.admin_ix(&admin, mumbuca_plus::instruction::SetMinter { new: new_minter.pubkey() }.data())
        .expect("set_minter");
    assert_eq!(env.config().minter, new_minter.pubkey());

    let citizen = env.citizen.pubkey();
    assert_custom(env.mint_with(&old_minter, &citizen, pref(17), 1100), err_code(MumbucaError::Unauthorized));
    env.mint_with(&new_minter, &citizen, pref(17), 1100).expect("new minter mints");
    assert_eq!(env.balance(&citizen), 1100);
}

#[test]
fn set_pauser_switches_pauser() {
    let mut env = Env::new();
    let admin = env.admin.insecure_clone();
    let old_pauser = env.pauser.insecure_clone();
    let other = env.other.insecure_clone();
    env.admin_ix(&admin, mumbuca_plus::instruction::SetPauser { new: other.pubkey() }.data())
        .expect("set_pauser");
    assert_eq!(env.config().pauser, other.pubkey());
    assert_custom(env.pause(&old_pauser), err_code(MumbucaError::Unauthorized));
    env.pause(&other).expect("new pauser pauses");
}

#[test]
fn emits_minted_for_payment_event() {
    let mut env = Env::new();
    let meta = env.mint(pref(18), 1100).expect("mint");
    let event = meta
        .logs
        .iter()
        .filter_map(|l| l.strip_prefix("Program data: "))
        .filter_map(|b| B64.decode(b).ok())
        .find(|bytes| bytes.starts_with(MintedForPayment::DISCRIMINATOR))
        .map(|bytes| MintedForPayment::try_from_slice(&bytes[MintedForPayment::DISCRIMINATOR.len()..]).unwrap())
        .expect("MintedForPayment event in logs");
    assert_eq!(event.recipient, env.citizen.pubkey());
    assert_eq!(event.amount, 1100);
    assert_eq!(event.payment_ref, pref(18));
    assert_eq!(event.slot, 100);
}
