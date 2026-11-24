use anchor_lang::prelude::*;

#[error_code]
pub enum MumbucaError {
    #[msg("Signer is not authorized for this instruction")]
    Unauthorized,
    #[msg("Minting is paused")]
    Paused,
    #[msg("Amount must be greater than zero")]
    InvalidAmount,
    #[msg("Amount exceeds max_mint_per_tx")]
    ExceedsMaxPerTx,
    #[msg("Mint would exceed the cap")]
    CapExceeded,
    #[msg("Arithmetic overflow")]
    MathOverflow,
}
