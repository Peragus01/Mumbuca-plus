use anchor_lang::prelude::*;

use crate::errors::MumbucaError;

pub const CONFIG_SEED: &[u8] = b"config";
pub const MINT_SEED: &[u8] = b"mint";
pub const RECEIPT_SEED: &[u8] = b"receipt";

pub const TOKEN_NAME: &str = "Mumbuca+";
pub const TOKEN_SYMBOL: &str = "Mum+";
pub const TOKEN_DECIMALS: u8 = 2;

/// Global configuration, PDA `["config"]`. Also the mint authority of the Mum+ mint.
#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub minter: Pubkey,
    pub pauser: Pubkey,
    pub mint: Pubkey,
    pub cap: u64,
    pub max_mint_per_tx: u64,
    pub total_minted: u64,
    pub paused: bool,
    pub bump: u8,
    pub mint_bump: u8,
}

impl Config {
    /// `total_minted + amount <= cap`, with checked arithmetic.
    pub fn within_cap(&self, amount: u64) -> Result<bool> {
        let next = self
            .total_minted
            .checked_add(amount)
            .ok_or(MumbucaError::MathOverflow)?;
        Ok(next <= self.cap)
    }
}

/// On-chain dedup of a settled payment, PDA `["receipt", payment_ref]`.
#[account]
#[derive(InitSpace)]
pub struct PaymentReceipt {
    pub payment_ref: [u8; 32],
    pub recipient: Pubkey,
    pub amount: u64,
    pub slot: u64,
    pub bump: u8,
}
