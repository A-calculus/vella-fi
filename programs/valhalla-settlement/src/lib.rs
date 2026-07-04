// Valhalla Settlement Program
// Handles on-chain settlement of trade batches with escrow logic

use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS"); // Placeholder - will be updated after deployment

#[program]
pub mod valhalla_settlement {
    use super::*;
    
    /// Anchors a trade batch result on-chain with escrow distribution
    ///
    /// Args:
    /// - batch_id: Unique identifier for the trade batch
    /// - matched_hash: Hash of all matched pairs in the batch
    /// - winner: Public key of the trader with positive PnL
    /// - loser: Public key of the trader with negative PnL
    /// - amount_soc: Total amount to be distributed in SOC tokens (lamports)
    pub fn anchor_trade_batch(
        ctx: Context<AnchorBatch>,
        batch_id: String,
        matched_hash: [u8; 32],
        winner: Pubkey,
        loser: Pubkey,
        amount_soc: u64,
    ) -> Result<()> {
        // Validate the batch PDA
        let batch = &mut ctx.accounts.batch;
        batch.batch_id = batch_id;
        batch.matched_hash = matched_hash;
        batch.winner = winner;
        batch.loser = loser;
        batch.settled_at = Clock::get()?.unix_timestamp;
        batch.amount = amount_soc;
        
        // Calculate distribution: 95% to winner, 5% to treasury
        let winner_amount = (amount_soc * 95) / 100;
        let treasury_amount = amount_soc - winner_amount;
        
        // Transfer SOL from escrow to winner (95%)
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.escrow_wallet.to_account_info(),
                    to: ctx.accounts.winner_wallet.to_account_info(),
                },
            ),
            winner_amount,
        )?;
        
        // Transfer SOL from escrow to treasury (5%)
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.escrow_wallet.to_account_info(),
                    to: ctx.accounts.treasury_wallet.to_account_info(),
                },
            ),
            treasury_amount,
        )?;
        
        Ok(())
    }
}

/// Accounts required for the anchor_trade_batch instruction
#[derive(Accounts)]
pub struct AnchorBatch<'info> {
    /// The batch PDA that stores the settlement proof
    #[account(
        init,
        payer = authority,
        space = 8 + Batch::LEN,
        seeds = [b"valhalla_batch", batch_id.as_bytes()],
        bump
    )]
    pub batch: Account<'info, Batch>,
    
    /// The escrow wallet containing the funds to be distributed
    #[account(mut)]
    pub escrow_wallet: Signer<'info>,
    
    /// The winner's wallet (receives 95% of funds)
    #[account(mut)]
    pub winner_wallet: SystemAccount<'info>,
    
    /// The treasury wallet (receives 5% of funds)
    #[account(mut)]
    pub treasury_wallet: SystemAccount<'info>,
    
    /// The authority that signs the transaction
    #[account(mut)]
    pub authority: Signer<'info>,
    
    /// System program
    pub system_program: Program<'info, System>,
}

/// On-chain data structure for storing batch settlement proofs
#[account]
pub struct Batch {
    pub batch_id: String,        // Unique identifier for the batch
    pub matched_hash: [u8; 32],  // Hash of all matched pairs
    pub winner: Pubkey,          // Trader with positive PnL
    pub loser: Pubkey,           // Trader with negative PnL
    pub amount: u64,             // Total amount distributed
    pub settled_at: i64,         // Timestamp of settlement
}

impl Batch {
    /// Size of the Batch account
    pub const LEN: usize = 4 + 64 + 32 + 32 + 32 + 8 + 8;
}