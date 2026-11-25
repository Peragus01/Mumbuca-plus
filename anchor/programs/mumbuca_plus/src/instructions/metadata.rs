use anchor_lang::{
    prelude::*,
    system_program::{transfer, Transfer},
};
use anchor_spl::{
    token_2022::Token2022,
    token_interface::{
        spl_token_metadata_interface::state::Field, token_metadata_update_field, Mint,
        TokenMetadataUpdateField,
    },
};

use crate::{
    errors::MumbucaError,
    state::{Config, CONFIG_SEED, MAX_URI_LEN, MINT_SEED},
};

#[derive(Accounts)]
pub struct SetMetadataUri<'info> {
    /// Pays any extra rent when the metadata grows.
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ MumbucaError::Unauthorized,
        has_one = mint,
    )]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [MINT_SEED],
        bump = config.mint_bump,
        mint::token_program = token_program,
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

/// Admin only: points the Mum+ TokenMetadata `uri` at a JSON (name, symbol, image) so wallets and
/// explorers can show the logo. The config PDA is the metadata update authority, so only the
/// program can change it.
pub fn handle_set_metadata_uri(ctx: Context<SetMetadataUri>, uri: String) -> Result<()> {
    require!(uri.len() <= MAX_URI_LEN, MumbucaError::UriTooLong);

    // Token-2022 reallocs the mint when the field grows. Fund the worst case (old uri empty):
    // the extra lamports stay in the mint as rent, never below the rent-exempt minimum.
    let mint_info = ctx.accounts.mint.to_account_info();
    let max_len = mint_info
        .data_len()
        .checked_add(uri.len())
        .ok_or(MumbucaError::MathOverflow)?;
    let top_up = Rent::get()?
        .minimum_balance(max_len)
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

    let signer_seeds: &[&[&[u8]]] = &[&[CONFIG_SEED, &[ctx.accounts.config.bump]]];
    token_metadata_update_field(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TokenMetadataUpdateField {
                program_id: ctx.accounts.token_program.to_account_info(),
                metadata: mint_info,
                update_authority: ctx.accounts.config.to_account_info(),
            },
            signer_seeds,
        ),
        Field::Uri,
        uri,
    )?;

    Ok(())
}
