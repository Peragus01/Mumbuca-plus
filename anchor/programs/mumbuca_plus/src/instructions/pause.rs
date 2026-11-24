use anchor_lang::prelude::*;

use crate::{
    errors::MumbucaError,
    state::{Config, CONFIG_SEED},
};

#[derive(Accounts)]
pub struct PauserUpdate<'info> {
    pub pauser: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = pauser @ MumbucaError::Unauthorized,
    )]
    pub config: Account<'info, Config>,
}

pub fn handle_pause(ctx: Context<PauserUpdate>) -> Result<()> {
    ctx.accounts.config.paused = true;
    Ok(())
}

pub fn handle_unpause(ctx: Context<PauserUpdate>) -> Result<()> {
    ctx.accounts.config.paused = false;
    Ok(())
}
