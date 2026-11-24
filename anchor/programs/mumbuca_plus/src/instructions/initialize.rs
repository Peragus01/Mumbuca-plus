use anchor_lang::{
    prelude::*,
    system_program::{transfer, Transfer},
};
use anchor_spl::{
    token_2022::Token2022,
    token_interface::{
        spl_pod::optional_keys::OptionalNonZeroPubkey,
        spl_token_metadata_interface::state::TokenMetadata, token_metadata_initialize, Mint,
        TokenMetadataInitialize,
    },
};

use crate::{
    errors::MumbucaError,
    state::{Config, CONFIG_SEED, MINT_SEED, TOKEN_DECIMALS, TOKEN_NAME, TOKEN_SYMBOL},
};

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump,
    )]
    pub config: Account<'info, Config>,

    #[account(
        init,
        payer = admin,
        seeds = [MINT_SEED],
        bump,
        mint::decimals = TOKEN_DECIMALS,
        mint::authority = config,
        mint::token_program = token_program,
        extensions::metadata_pointer::authority = config,
        extensions::metadata_pointer::metadata_address = mint,
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize(
    ctx: Context<Initialize>,
    cap: u64,
    max_mint_per_tx: u64,
    minter: Pubkey,
    pauser: Pubkey,
    uri: String,
) -> Result<()> {
    require!(cap > 0 && max_mint_per_tx > 0, MumbucaError::InvalidAmount);

    let config_key = ctx.accounts.config.key();
    let mint_key = ctx.accounts.mint.key();
    let config_bump = ctx.bumps.config;

    ctx.accounts.config.set_inner(Config {
        admin: ctx.accounts.admin.key(),
        minter,
        pauser,
        mint: mint_key,
        cap,
        max_mint_per_tx,
        total_minted: 0,
        paused: false,
        bump: config_bump,
        mint_bump: ctx.bumps.mint,
    });

    // Token-2022 reallocs the mint to hold the TokenMetadata entry; fund the extra rent first.
    let metadata = TokenMetadata {
        update_authority: OptionalNonZeroPubkey::try_from(Some(config_key))?,
        mint: mint_key,
        name: TOKEN_NAME.to_string(),
        symbol: TOKEN_SYMBOL.to_string(),
        uri: uri.clone(),
        additional_metadata: vec![],
    };
    let mint_info = ctx.accounts.mint.to_account_info();
    let new_len = mint_info
        .data_len()
        .checked_add(metadata.tlv_size_of()?)
        .ok_or(MumbucaError::MathOverflow)?;
    let top_up = Rent::get()?
        .minimum_balance(new_len)
        .saturating_sub(mint_info.lamports());
    if top_up > 0 {
        transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                Transfer {
                    from: ctx.accounts.admin.to_account_info(),
                    to: mint_info.clone(),
                },
            ),
            top_up,
        )?;
    }

    let signer_seeds: &[&[&[u8]]] = &[&[CONFIG_SEED, &[config_bump]]];
    token_metadata_initialize(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TokenMetadataInitialize {
                program_id: ctx.accounts.token_program.to_account_info(),
                metadata: mint_info.clone(),
                update_authority: ctx.accounts.config.to_account_info(),
                mint_authority: ctx.accounts.config.to_account_info(),
                mint: mint_info,
            },
            signer_seeds,
        ),
        TOKEN_NAME.to_string(),
        TOKEN_SYMBOL.to_string(),
        uri,
    )?;

    Ok(())
}
