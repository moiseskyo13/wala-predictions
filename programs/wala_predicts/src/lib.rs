use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked},
};
use std::str::FromStr;

declare_id!("hiSmRhGDoLJj5iBzjKtsBENJ2xY3NhFGgYBmPC3cHur");

const TREASURY_ADMIN_WALLET: &str = "8no5SbdExQeUP6sULmvxuaUtbfrwXe41xDQftCNYbbgv";
const RESOLVER_WALLET: &str = "8vUdvD6D1ndArPbEupajVhDSKRP4dQtTXJ3tnznVHGbs";
const MAX_FEE_BPS: u16 = 0;

#[program]
pub mod wala_predicts {
    use super::*;

   pub fn create_market(
    ctx: Context<CreateMarket>,
    fixture_id: u64,
    league: String,
    team_a: String,
    team_b: String,
    fee_bps: u16,
    home_prob_bps: u16,
    draw_prob_bps: u16,
    away_prob_bps: u16,
) -> Result<()> {
    require!(fee_bps <= MAX_FEE_BPS, PredictError::FeeTooHigh);

    let total_prob = (home_prob_bps as u32)
        .checked_add(draw_prob_bps as u32)
        .ok_or(PredictError::MathOverflow)?
        .checked_add(away_prob_bps as u32)
        .ok_or(PredictError::MathOverflow)?;

    require!(
        home_prob_bps > 0
            && draw_prob_bps > 0
            && away_prob_bps > 0
            && total_prob == 10_000,
        PredictError::InvalidProbabilityConfig
    );

    let market = &mut ctx.accounts.market;
let now = Clock::get()?.unix_timestamp;
let resolver_wallet = Pubkey::from_str(RESOLVER_WALLET).unwrap();

msg!("CREATE_MARKET signer authority: {}", ctx.accounts.authority.key());
msg!("CREATE_MARKET resolver_wallet constante: {}", resolver_wallet);

market.authority = resolver_wallet;

msg!("CREATE_MARKET authority salva no market: {}", market.authority);
market.wala_mint = ctx.accounts.wala_mint.key();
market.fixture_id = fixture_id;
market.league = league;
market.team_a = team_a;
market.team_b = team_b;
market.status = MarketStatus::Open;
market.winning_outcome = None;
market.pool_home = 0;
market.pool_draw = 0;
market.pool_away = 0;
market.total_pool = 0;

market.prob_home_bps = home_prob_bps;
market.prob_draw_bps = draw_prob_bps;
market.prob_away_bps = away_prob_bps;

market.fee_bps = 0;
market.fee_amount = 0;
market.created_at = now;
market.resolved_at = 0;
market.bump = ctx.bumps.market;
market.vault_bump = ctx.bumps.vault_token_account;
    Ok(())
}

    pub fn init_treasury(ctx: Context<InitTreasury>) -> Result<()> 
    {
        let admin_wallet = Pubkey::from_str(TREASURY_ADMIN_WALLET).unwrap();

        require_keys_eq!(
            ctx.accounts.admin.key(),
            admin_wallet,
            PredictError::Unauthorized
        );

        let treasury = &mut ctx.accounts.treasury;

        if treasury.authority == Pubkey::default() {
            treasury.authority = ctx.accounts.admin.key();
            treasury.wala_mint = ctx.accounts.wala_mint.key();
            treasury.total_deposited = 0;
            treasury.total_distributed = 0;
            treasury.active = true;
            treasury.bump = ctx.bumps.treasury;
            treasury.vault_bump = ctx.bumps.treasury_vault_token_account;
        } else {
            require_keys_eq!(
                treasury.authority,
                ctx.accounts.admin.key(),
                PredictError::InvalidTreasuryAuthority
            );
            require_keys_eq!(
                treasury.wala_mint,
                ctx.accounts.wala_mint.key(),
                PredictError::InvalidTreasuryMint
            );
        }

        Ok(())
    }

    pub fn deposit_treasury(
        ctx: Context<DepositTreasury>,
        amount: u64,
    ) -> Result<()> {
        require!(amount > 0, PredictError::InvalidAmount);

        let admin_wallet = Pubkey::from_str(TREASURY_ADMIN_WALLET).unwrap();

        require_keys_eq!(
            ctx.accounts.admin.key(),
            admin_wallet,
            PredictError::Unauthorized
        );

        let treasury = &mut ctx.accounts.treasury;

        require!(treasury.active, PredictError::TreasuryInactive);
        require_keys_eq!(
            treasury.authority,
            ctx.accounts.admin.key(),
            PredictError::InvalidTreasuryAuthority
        );
        require_keys_eq!(
            treasury.wala_mint,
            ctx.accounts.wala_mint.key(),
            PredictError::InvalidTreasuryMint
        );

        let decimals = ctx.accounts.wala_mint.decimals;

        let cpi_accounts = TransferChecked {
            mint: ctx.accounts.wala_mint.to_account_info(),
            from: ctx.accounts.admin_wala_ata.to_account_info(),
            to: ctx.accounts.treasury_vault_token_account.to_account_info(),
            authority: ctx.accounts.admin.to_account_info(),
        };

        let cpi_ctx =
            CpiContext::new(ctx.accounts.token_program.key(), cpi_accounts);

        token_interface::transfer_checked(cpi_ctx, amount, decimals)?;

        treasury.total_deposited = treasury
            .total_deposited
            .checked_add(amount)
            .ok_or(PredictError::MathOverflow)?;

        Ok(())
    }

    pub fn buy_position(
    ctx: Context<BuyPosition>,
    coupon_id: u64,
    outcome: Outcome,
    amount: u64,
) -> Result<()> {
    require!(amount > 0, PredictError::InvalidAmount);
    require!(
        ctx.accounts.market.status == MarketStatus::Open,
        PredictError::MarketClosed
    );

    let decimals = ctx.accounts.wala_mint.decimals;

    let cpi_accounts = TransferChecked {
        mint: ctx.accounts.wala_mint.to_account_info(),
        from: ctx.accounts.user_wala_ata.to_account_info(),
        to: ctx.accounts.vault_token_account.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };

    let cpi_ctx =
        CpiContext::new(ctx.accounts.token_program.key(), cpi_accounts);

    token_interface::transfer_checked(cpi_ctx, amount, decimals)?;

    let market = &mut ctx.accounts.market;

    match &outcome {
        Outcome::Home => {
            market.pool_home = market
                .pool_home
                .checked_add(amount)
                .ok_or(PredictError::MathOverflow)?
        }
        Outcome::Draw => {
            market.pool_draw = market
                .pool_draw
                .checked_add(amount)
                .ok_or(PredictError::MathOverflow)?
        }
        Outcome::Away => {
            market.pool_away = market
                .pool_away
                .checked_add(amount)
                .ok_or(PredictError::MathOverflow)?
        }
    }

    market.total_pool = market
        .total_pool
        .checked_add(amount)
        .ok_or(PredictError::MathOverflow)?;

    let position = &mut ctx.accounts.position;
    position.market = market.key();
    position.user = ctx.accounts.user.key();
    position.coupon_id = coupon_id;
    position.outcome = outcome;
    position.amount = amount;
    position.claimed = false;
    position.claimed_amount = 0;
    position.bump = ctx.bumps.position;

    Ok(())
}

    pub fn close_market(ctx: Context<CloseMarket>) -> Result<()> {
    let market = &mut ctx.accounts.market;

    let resolver_wallet = Pubkey::from_str(RESOLVER_WALLET).unwrap();

require_keys_eq!(
    ctx.accounts.authority.key(),
    resolver_wallet,
    PredictError::Unauthorized
);

    require!(
        market.status == MarketStatus::Open,
        PredictError::MarketNotOpen
    );

    market.status = MarketStatus::Closed;

    Ok(())
}

pub fn resolve_market(
    ctx: Context<ResolveMarket>,
    winning_outcome: Outcome,
) -> Result<()> {
        let market = &mut ctx.accounts.market;

        let resolver_wallet = Pubkey::from_str(RESOLVER_WALLET).unwrap();

require_keys_eq!(
    ctx.accounts.authority.key(),
    resolver_wallet,
    PredictError::Unauthorized
);
        require!(
    market.status == MarketStatus::Open || market.status == MarketStatus::Closed,
    PredictError::MarketAlreadyResolved
);

        let winning_pool = get_pool_for_outcome(market, &winning_outcome);
        require!(winning_pool > 0, PredictError::NoWinningLiquidity);

        let fee_amount: u64 = 0;
        market.status = MarketStatus::Resolved;
        market.winning_outcome = Some(winning_outcome);
        market.fee_amount = fee_amount;
        market.resolved_at = Clock::get()?.unix_timestamp;

        Ok(())
    }

    pub fn claim_position(ctx: Context<ClaimPosition>) -> Result<()> {
        let market = &ctx.accounts.market;
        let position = &mut ctx.accounts.position;
        let treasury = &mut ctx.accounts.treasury;

        require!(
            market.status == MarketStatus::Resolved,
            PredictError::MarketNotResolved
        );
        require!(!position.claimed, PredictError::PositionAlreadyClaimed);
        require!(treasury.active, PredictError::TreasuryInactive);

        require_keys_eq!(
            position.market,
            market.key(),
            PredictError::InvalidPositionMarket
        );
        require_keys_eq!(
            position.user,
            ctx.accounts.user.key(),
            PredictError::InvalidPositionOwner
        );
        require_keys_eq!(
            treasury.wala_mint,
            market.wala_mint,
            PredictError::InvalidTreasuryMint
        );

        let winning_outcome = market
            .winning_outcome
            .clone()
            .ok_or(PredictError::MarketNotResolved)?;

        require!(position.outcome == winning_outcome, PredictError::NotWinner);

        let winning_pool = get_pool_for_outcome(market, &winning_outcome);
require!(winning_pool > 0, PredictError::NoWinningLiquidity);

let outcome_prob_bps = get_prob_bps_for_outcome(market, &winning_outcome);
require!(
    outcome_prob_bps > 0 && outcome_prob_bps < 10_000,
    PredictError::InvalidProbabilityConfig
);

let profit_ratio_bps = 10_000u128
    .checked_sub(outcome_prob_bps as u128)
    .ok_or(PredictError::MathOverflow)?;

let gross_profit_u128 = (position.amount as u128)
    .checked_mul(profit_ratio_bps)
    .ok_or(PredictError::MathOverflow)?
    .checked_div(10_000)
    .ok_or(PredictError::MathOverflow)?;

let fee_on_profit_u128 = gross_profit_u128
    .checked_mul(market.fee_bps as u128)
    .ok_or(PredictError::MathOverflow)?
    .checked_div(10_000)
    .ok_or(PredictError::MathOverflow)?;

let net_profit_u128 = gross_profit_u128
    .checked_sub(fee_on_profit_u128)
    .ok_or(PredictError::MathOverflow)?;

let payout_u128 = (position.amount as u128)
    .checked_add(net_profit_u128)
    .ok_or(PredictError::MathOverflow)?;

let payout = payout_u128 as u64;
require!(payout > 0, PredictError::InvalidPayout);

        let available_market = ctx.accounts.vault_token_account.amount;
        let from_market = available_market.min(payout);
        let from_treasury = payout
            .checked_sub(from_market)
            .ok_or(PredictError::MathOverflow)?;

        if from_treasury > 0 {
            require!(
                ctx.accounts.treasury_vault_token_account.amount >= from_treasury,
                PredictError::TreasuryInsufficient
            );
        }

        let decimals = ctx.accounts.wala_mint.decimals;

        if from_market > 0 {
            let market_key = market.key();

            let market_signer_seeds: &[&[&[u8]]] = &[&[
                b"vault",
                market_key.as_ref(),
                &[market.vault_bump],
            ]];

            let market_cpi_accounts = TransferChecked {
                mint: ctx.accounts.wala_mint.to_account_info(),
                from: ctx.accounts.vault_token_account.to_account_info(),
                to: ctx.accounts.user_wala_ata.to_account_info(),
                authority: ctx.accounts.vault_token_account.to_account_info(),
            };

            let market_cpi_ctx =
                CpiContext::new(ctx.accounts.token_program.key(), market_cpi_accounts)
                    .with_signer(market_signer_seeds);

            token_interface::transfer_checked(market_cpi_ctx, from_market, decimals)?;
        }

        if from_treasury > 0 {
            let treasury_key = treasury.key();

            let treasury_signer_seeds: &[&[&[u8]]] = &[&[
                b"treasury_vault",
                treasury_key.as_ref(),
                &[treasury.vault_bump],
            ]];

            let treasury_cpi_accounts = TransferChecked {
                mint: ctx.accounts.wala_mint.to_account_info(),
                from: ctx.accounts.treasury_vault_token_account.to_account_info(),
                to: ctx.accounts.user_wala_ata.to_account_info(),
                authority: ctx.accounts.treasury_vault_token_account.to_account_info(),
            };

            let treasury_cpi_ctx =
                CpiContext::new(ctx.accounts.token_program.key(), treasury_cpi_accounts)
                    .with_signer(treasury_signer_seeds);

            token_interface::transfer_checked(treasury_cpi_ctx, from_treasury, decimals)?;

            treasury.total_distributed = treasury
                .total_distributed
                .checked_add(from_treasury)
                .ok_or(PredictError::MathOverflow)?;
        }

        position.claimed = true;
        position.claimed_amount = payout;

        Ok(())
    }
}

fn get_pool_for_outcome(market: &MarketAccount, outcome: &Outcome) -> u64 {
    match outcome {
        Outcome::Home => market.pool_home,
        Outcome::Draw => market.pool_draw,
        Outcome::Away => market.pool_away,
    }
}

fn get_prob_bps_for_outcome(market: &MarketAccount, outcome: &Outcome) -> u16 {
    match outcome {
        Outcome::Home => market.prob_home_bps,
        Outcome::Draw => market.prob_draw_bps,
        Outcome::Away => market.prob_away_bps,
    }
}

#[derive(Accounts)]
#[instruction(fixture_id: u64)]
pub struct CreateMarket<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + MarketAccount::INIT_SPACE,
        seeds = [b"market".as_ref(), &fixture_id.to_le_bytes()],
        bump
    )]
    pub market: Account<'info, MarketAccount>,

    #[account(
        init,
        payer = authority,
        token::mint = wala_mint,
        token::authority = vault_token_account,
        token::token_program = token_program,
        seeds = [b"vault", market.key().as_ref()],
        bump
    )]
    pub vault_token_account: InterfaceAccount<'info, TokenAccount>,

    pub wala_mint: InterfaceAccount<'info, Mint>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitTreasury<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init_if_needed,
        payer = admin,
        space = 8 + TreasuryAccount::INIT_SPACE,
        seeds = [b"treasury", wala_mint.key().as_ref()],
        bump
    )]
    pub treasury: Account<'info, TreasuryAccount>,

    #[account(
        init_if_needed,
        payer = admin,
        token::mint = wala_mint,
        token::authority = treasury_vault_token_account,
        token::token_program = token_program,
        seeds = [b"treasury_vault", treasury.key().as_ref()],
        bump
    )]
    pub treasury_vault_token_account: InterfaceAccount<'info, TokenAccount>,

    pub wala_mint: InterfaceAccount<'info, Mint>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DepositTreasury<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"treasury", wala_mint.key().as_ref()],
        bump = treasury.bump
    )]
    pub treasury: Account<'info, TreasuryAccount>,

    #[account(
        mut,
        associated_token::mint = wala_mint,
        associated_token::authority = admin,
        associated_token::token_program = token_program
    )]
    pub admin_wala_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"treasury_vault", treasury.key().as_ref()],
        bump = treasury.vault_bump,
        token::mint = wala_mint,
        token::authority = treasury_vault_token_account,
        token::token_program = token_program
    )]
    pub treasury_vault_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(address = treasury.wala_mint)]
    pub wala_mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
#[instruction(coupon_id: u64)]
pub struct BuyPosition<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(mut)]
    pub market: Account<'info, MarketAccount>,

    #[account(
        mut,
        associated_token::mint = wala_mint,
        associated_token::authority = user,
        associated_token::token_program = token_program
    )]
    pub user_wala_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init,
        payer = user,
        space = 8 + PositionAccount::INIT_SPACE,
        seeds = [
            b"position",
            market.key().as_ref(),
            user.key().as_ref(),
            &coupon_id.to_le_bytes()
        ],
        bump
    )]
    pub position: Account<'info, PositionAccount>,

    #[account(
        mut,
        seeds = [b"vault", market.key().as_ref()],
        bump = market.vault_bump,
        token::mint = wala_mint,
        token::authority = vault_token_account,
        token::token_program = token_program
    )]
    pub vault_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(address = market.wala_mint)]
    pub wala_mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CloseMarket<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(mut)]
    pub market: Account<'info, MarketAccount>,
}

#[derive(Accounts)]
pub struct ResolveMarket<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(mut)]
    pub market: Account<'info, MarketAccount>,

    #[account(
        mut,
        seeds = [b"vault", market.key().as_ref()],
        bump = market.vault_bump,
        token::mint = wala_mint,
        token::authority = vault_token_account,
        token::token_program = token_program
    )]
    pub vault_token_account: InterfaceAccount<'info, TokenAccount>,

    

    #[account(address = market.wala_mint)]
    pub wala_mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct ClaimPosition<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    pub market: Box<Account<'info, MarketAccount>>,

    #[account(mut)]
    pub position: Box<Account<'info, PositionAccount>>,

    #[account(
        mut,
        seeds = [b"vault", market.key().as_ref()],
        bump = market.vault_bump,
        token::mint = wala_mint,
        token::authority = vault_token_account,
        token::token_program = token_program
    )]
    pub vault_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [b"treasury", wala_mint.key().as_ref()],
        bump = treasury.bump
    )]
    pub treasury: Box<Account<'info, TreasuryAccount>>,

    #[account(
        mut,
        seeds = [b"treasury_vault", treasury.key().as_ref()],
        bump = treasury.vault_bump,
        token::mint = wala_mint,
        token::authority = treasury_vault_token_account,
        token::token_program = token_program
    )]
    pub treasury_vault_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = wala_mint,
        associated_token::authority = user,
        associated_token::token_program = token_program
    )]
    pub user_wala_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(address = market.wala_mint)]
    pub wala_mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[account]
#[derive(InitSpace)]
pub struct TreasuryAccount {
    pub authority: Pubkey,
    pub wala_mint: Pubkey,
    pub total_deposited: u64,
    pub total_distributed: u64,
    pub active: bool,
    pub bump: u8,
    pub vault_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct MarketAccount {
    pub authority: Pubkey,
    pub wala_mint: Pubkey,
    pub fixture_id: u64,

    #[max_len(32)]
    pub league: String,

    #[max_len(32)]
    pub team_a: String,

    #[max_len(32)]
    pub team_b: String,

    pub status: MarketStatus,
    pub winning_outcome: Option<Outcome>,

    pub pool_home: u64,
    pub pool_draw: u64,
    pub pool_away: u64,
    pub total_pool: u64,

    pub prob_home_bps: u16,
    pub prob_draw_bps: u16,
    pub prob_away_bps: u16,

    pub fee_bps: u16,
    pub fee_amount: u64,

    pub created_at: i64,
    pub resolved_at: i64,

    pub bump: u8,
    pub vault_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct PositionAccount {
    pub market: Pubkey,
    pub user: Pubkey,
    pub coupon_id: u64,
    pub outcome: Outcome,
    pub amount: u64,
    pub claimed: bool,
    pub claimed_amount: u64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, InitSpace)]
pub enum Outcome {
    Home,
    Draw,
    Away,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, InitSpace)]
pub enum MarketStatus {
    Open,
    Closed,
    Resolved,
}

#[error_code]
pub enum PredictError {
    #[msg("Mercado fechado.")]
    MarketClosed,
    #[msg("Mercado já resolvido.")]
MarketAlreadyResolved,
#[msg("Mercado não está aberto.")]
MarketNotOpen,
    #[msg("Mercado ainda não foi resolvido.")]
    MarketNotResolved,
    #[msg("Valor inválido.")]
    InvalidAmount,
    #[msg("Payout inválido.")]
    InvalidPayout,
    #[msg("Sem liquidez vencedora.")]
    NoWinningLiquidity,
    #[msg("Você não é vencedor nesse mercado.")]
    NotWinner,
    #[msg("A posição já foi resgatada.")]
    PositionAlreadyClaimed,
    #[msg("Outcome diferente da posição já existente.")]
    OutcomeMismatch,
    #[msg("Position market inválido.")]
    InvalidPositionMarket,
    #[msg("Position owner inválido.")]
    InvalidPositionOwner,
    #[msg("Carteira sem autorização.")]
    Unauthorized,
    #[msg("Fee muito alta.")]
    FeeTooHigh,
    #[msg("Conta de fee inválida.")]
    InvalidFeeRecipient,
    #[msg("Mint da conta de fee inválido.")]
    InvalidFeeRecipientMint,
    #[msg("Overflow matemático.")]
    MathOverflow,
    #[msg("Treasury global inativa.")]
    TreasuryInactive,
    #[msg("Saldo insuficiente na treasury global.")]
    TreasuryInsufficient,
    #[msg("Authority da treasury inválida.")]
    InvalidTreasuryAuthority,
    #[msg("Mint da treasury inválida.")]
InvalidTreasuryMint,
#[msg("Configuração de probabilidade inválida.")]
InvalidProbabilityConfig,
}