use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_2022::Token2022,
    token_interface::{mint_to, Mint, MintTo, TokenAccount},
};

use crate::{
    errors::MumbucaError,
    events::MintedForPayment,
    state::{Config, PaymentReceipt, CONFIG_SEED, MINT_SEED, RECEIPT_SEED},
};

// Real execution order (Anchor 1.2 `try_accounts` codegen): every `init`/`init_if_needed`
// field runs first, so the receipt `init` and the recipient ATA `init_if_needed` happen BEFORE
// the non-init constraints on `config` (signer == minter, !paused, amount > 0,
// amount <= max_mint_per_tx, total_minted + amount <= cap) and on `mint`. Any failure aborts
// the whole transaction, so nothing persists, but error precedence follows this order: a
// reused `payment_ref` reports "account already in use" even if the signer is unauthorized,
// minting is paused or the amount is invalid.
#[derive(Accounts)]
#[instruction(payment_ref: [u8; 32], amount: u64)]
pub struct MintForPayment<'info> {
    #[account(mut)]
    pub minter: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        constraint = minter.key() == config.minter @ MumbucaError::Unauthorized,
        constraint = !config.paused @ MumbucaError::Paused,
        constraint = amount > 0 @ MumbucaError::InvalidAmount,
        constraint = amount <= config.max_mint_per_tx @ MumbucaError::ExceedsMaxPerTx,
        constraint = config.within_cap(amount)? @ MumbucaError::CapExceeded,
    )]
    pub config: Account<'info, Config>,

    #[account(
        init,
        payer = minter,
        space = 8 + PaymentReceipt::INIT_SPACE,
        seeds = [RECEIPT_SEED, payment_ref.as_ref()],
        bump,
    )]
    pub receipt: Account<'info, PaymentReceipt>,

    /// CHECK: any wallet may receive Mum+; it is only used as the ATA owner.
    pub recipient: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = minter,
        associated_token::mint = mint,
        associated_token::authority = recipient,
        associated_token::token_program = token_program,
    )]
    pub recipient_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [MINT_SEED],
        bump = config.mint_bump,
        address = config.mint,
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    pub token_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_mint_for_payment(
    ctx: Context<MintForPayment>,
    payment_ref: [u8; 32],
    amount: u64,
) -> Result<()> {
    let slot = Clock::get()?.slot;
    let recipient = ctx.accounts.recipient.key();

    ctx.accounts.receipt.set_inner(PaymentReceipt {
        payment_ref,
        recipient,
        amount,
        slot,
        bump: ctx.bumps.receipt,
    });

    let signer_seeds: &[&[&[u8]]] = &[&[CONFIG_SEED, &[ctx.accounts.config.bump]]];
    mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.recipient_token_account.to_account_info(),
                authority: ctx.accounts.config.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
    )?;

    let config = &mut ctx.accounts.config;
    config.total_minted = config
        .total_minted
        .checked_add(amount)
        .ok_or(MumbucaError::MathOverflow)?;

    emit!(MintedForPayment {
        recipient,
        amount,
        payment_ref,
        slot,
    });
    Ok(())
}
