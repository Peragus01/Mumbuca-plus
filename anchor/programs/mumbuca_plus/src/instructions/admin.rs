use anchor_lang::prelude::*;

use crate::{
    errors::MumbucaError,
    state::{Config, CONFIG_SEED},
};

#[derive(Accounts)]
pub struct AdminUpdate<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ MumbucaError::Unauthorized,
    )]
    pub config: Account<'info, Config>,
}

pub fn handle_set_minter(ctx: Context<AdminUpdate>, new: Pubkey) -> Result<()> {
    ctx.accounts.config.minter = new;
    Ok(())
}

pub fn handle_set_pauser(ctx: Context<AdminUpdate>, new: Pubkey) -> Result<()> {
    ctx.accounts.config.pauser = new;
    Ok(())
}

pub fn handle_set_max_mint_per_tx(ctx: Context<AdminUpdate>, v: u64) -> Result<()> {
    require!(v > 0, MumbucaError::InvalidAmount);
    ctx.accounts.config.max_mint_per_tx = v;
    Ok(())
}
