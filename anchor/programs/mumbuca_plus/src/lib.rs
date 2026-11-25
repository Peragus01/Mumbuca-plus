use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;

pub use instructions::*;

declare_id!("HfFamsTJgSXssGkCgBqtNsDLD694peLYBbAzs4kuYzZm");

#[program]
pub mod mumbuca_plus {
    use super::*;

    /// Creates the `Config` PDA and the Token-2022 mint (decimals 2, MetadataPointer +
    /// TokenMetadata). The signer becomes `admin` and pays for every account.
    pub fn initialize(
        ctx: Context<Initialize>,
        cap: u64,
        max_mint_per_tx: u64,
        minter: Pubkey,
        pauser: Pubkey,
        uri: String,
    ) -> Result<()> {
        handle_initialize(ctx, cap, max_mint_per_tx, minter, pauser, uri)
    }

    /// Mints `amount` units to `recipient` for a settled payment. The `PaymentReceipt` PDA
    /// (`["receipt", payment_ref]`) is created with `init`, so a repeated `payment_ref` fails.
    pub fn mint_for_payment(
        ctx: Context<MintForPayment>,
        payment_ref: [u8; 32],
        amount: u64,
    ) -> Result<()> {
        handle_mint_for_payment(ctx, payment_ref, amount)
    }

    pub fn set_minter(ctx: Context<AdminUpdate>, new: Pubkey) -> Result<()> {
        handle_set_minter(ctx, new)
    }

    pub fn set_pauser(ctx: Context<AdminUpdate>, new: Pubkey) -> Result<()> {
        handle_set_pauser(ctx, new)
    }

    pub fn set_max_mint_per_tx(ctx: Context<AdminUpdate>, v: u64) -> Result<()> {
        handle_set_max_mint_per_tx(ctx, v)
    }

    /// Admin only: updates the Mum+ TokenMetadata `uri` (wallets read the logo from it).
    pub fn set_metadata_uri(ctx: Context<SetMetadataUri>, uri: String) -> Result<()> {
        handle_set_metadata_uri(ctx, uri)
    }

    /// Blocks `mint_for_payment` only; token transfers are untouched.
    pub fn pause(ctx: Context<PauserUpdate>) -> Result<()> {
        handle_pause(ctx)
    }

    pub fn unpause(ctx: Context<PauserUpdate>) -> Result<()> {
        handle_unpause(ctx)
    }
}
