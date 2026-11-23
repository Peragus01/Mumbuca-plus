use anchor_lang::prelude::*;

#[event]
pub struct MintedForPayment {
    pub recipient: Pubkey,
    pub amount: u64,
    pub payment_ref: [u8; 32],
    pub slot: u64,
}
