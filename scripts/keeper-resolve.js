import fs from 'fs'
import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import { AnchorProvider, Program } from '@anchor-lang/core'
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from '@solana/spl-token'

const walaPredictsIdl = JSON.parse(
  fs.readFileSync(new URL('../../src/idl/wala_predicts.json', import.meta.url), 'utf8')
)

function env(name, fallback = '') {
  return process.env[name] || fallback
}

// ===== CONFIG =====
const RPC_URL = env('RPC_URL', 'https://api.devnet.solana.com')
const FOOTBALL_DATA_TOKEN = env('FOOTBALL_DATA_TOKEN', '')
const FOOTBALL_DATA_BASE = 'https://api.football-data.org/v4'

const WALA_TOKEN_MINT = env('WALA_TOKEN_MINT', 'F9yVUCWxMHATrZD2dVWonSunJjWF1L8jbBfTfmHczgU2')
const WALA_PREDICTS_PROGRAM_ID = env('WALA_PREDICTS_PROGRAM_ID', 'hiSmRhGDoLJj5iBzjKtsBENJ2xY3NhFGgYBmPC3cHur')
const PROTOCOL_FEE_WALLET = env('PROTOCOL_FEE_WALLET', '8no5SbdExQeUP6sULmvxuaUtbfrwXe41xDQftCNYbbgv')
const ADMIN_KEYPAIR_JSON = env('ADMIN_KEYPAIR_JSON', '')
// ==================

const connection = new Connection(RPC_URL, 'confirmed')
const walaMintPubkey = new PublicKey(WALA_TOKEN_MINT)
const programId = new PublicKey(WALA_PREDICTS_PROGRAM_ID)
const protocolFeeWalletPubkey = new PublicKey(PROTOCOL_FEE_WALLET)

let walaTokenProgramId = TOKEN_PROGRAM_ID

function validateConfig() {
  if (!FOOTBALL_DATA_TOKEN) {
    throw new Error('FOOTBALL_DATA_TOKEN não configurado na Function.')
  }

  if (!ADMIN_KEYPAIR_JSON) {
    throw new Error('ADMIN_KEYPAIR_JSON não configurado na Function.')
  }
}

function loadKeypairFromJson(secretJson) {
  const secret = Uint8Array.from(JSON.parse(secretJson))
  return Keypair.fromSecretKey(secret)
}

async function detectWalaTokenProgram() {
  const mintInfo = await connection.getAccountInfo(walaMintPubkey)

  if (!mintInfo) {
    throw new Error('Mint WALA não encontrada na rede.')
  }

  walaTokenProgramId = mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)
    ? TOKEN_2022_PROGRAM_ID
    : TOKEN_PROGRAM_ID

  console.log(
    '[WALA TOKEN PROGRAM / KEEPER]',
    walaTokenProgramId.equals(TOKEN_2022_PROGRAM_ID)
      ? 'TOKEN_2022_PROGRAM_ID'
      : 'TOKEN_PROGRAM_ID',
    walaTokenProgramId.toBase58()
  )

  return walaTokenProgramId
}

function getNodeWallet(keypair) {
  return {
    publicKey: keypair.publicKey,
    async signTransaction(tx) {
      tx.partialSign(keypair)
      return tx
    },
    async signAllTransactions(txs) {
      txs.forEach((tx) => tx.partialSign(keypair))
      return txs
    },
  }
}

function getProvider(adminKeypair) {
  return new AnchorProvider(
    connection,
    getNodeWallet(adminKeypair),
    {
      commitment: 'confirmed',
      preflightCommitment: 'confirmed',
    }
  )
}

function getProgram(provider) {
  return new Program(walaPredictsIdl, provider)
}

async function footballDataGet(pathname) {
  const response = await fetch(`${FOOTBALL_DATA_BASE}${pathname}`, {
    method: 'GET',
    headers: {
      'X-Auth-Token': FOOTBALL_DATA_TOKEN,
      Accept: 'application/json',
    },
  })

  const text = await response.text()

  console.log('[keeper] football-data status:', response.status)
  console.log('[keeper] football-data preview:', text.slice(0, 300))

  if (!response.ok) {
    throw new Error(`football-data ${response.status} - ${text}`)
  }

  return JSON.parse(text)
}

function deriveVaultPda(marketPda) {
  return PublicKey.findProgramAddressSync(
    [new TextEncoder().encode('vault'), marketPda.toBuffer()],
    programId
  )
}

function outcomeArg(outcome) {
  if (outcome === 'HOME') return { home: {} }
  if (outcome === 'DRAW') return { draw: {} }
  return { away: {} }
}

function getOutcomeFromScore(matchData) {
  const home = matchData?.score?.fullTime?.home
  const away = matchData?.score?.fullTime?.away

  if (home == null || away == null) return null
  if (home > away) return 'HOME'
  if (home < away) return 'AWAY'
  return 'DRAW'
}

function isMarketOpen(status) {
  return !!status?.open
}

async function ensureFeeRecipientAta(adminPubkey) {
  const tokenProgram = await detectWalaTokenProgram()

  const feeRecipientAta = await getAssociatedTokenAddress(
    walaMintPubkey,
    protocolFeeWalletPubkey,
    false,
    tokenProgram
  )

  const feeAtaInfo = await connection.getAccountInfo(feeRecipientAta)
  const preInstructions = []

  if (!feeAtaInfo) {
    preInstructions.push(
      createAssociatedTokenAccountInstruction(
        adminPubkey,
        feeRecipientAta,
        protocolFeeWalletPubkey,
        walaMintPubkey,
        tokenProgram,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    )
  }

  return { feeRecipientAta, preInstructions, tokenProgram }
}

async function resolveFinishedMarketsOnce(adminKeypair) {
  const provider = getProvider(adminKeypair)
  const program = getProgram(provider)

  const markets = await program.account.marketAccount.all()
  const openMarkets = markets.filter((item) => isMarketOpen(item.account.status))

  console.log(`[keeper] mercados abertos encontrados: ${openMarkets.length}`)

  for (const item of openMarkets) {
    const marketPda = item.publicKey
    const market = item.account
    const fixtureId = Number(market.fixtureId)

    try {
      const matchData = await footballDataGet(`/matches/${fixtureId}`)
      const apiStatus = matchData?.status

      console.log(`[keeper] fixture ${fixtureId} status API: ${apiStatus}`)

      if (apiStatus === 'IN_PLAY' || apiStatus === 'PAUSED') {
        if (market.status?.open) {
          const closeSignature = await program.methods
            .closeMarket()
            .accounts({
              authority: adminKeypair.publicKey,
              market: marketPda,
            })
            .rpc()

          console.log(
            `[keeper] mercado ${fixtureId} fechado automaticamente | tx: ${closeSignature}`
          )
        }

        continue
      }

      if (apiStatus !== 'FINISHED') {
        continue
      }

      const outcome = getOutcomeFromScore(matchData)

      if (!outcome) {
        console.log(`[keeper] fixture ${fixtureId} sem placar final válido`)
        continue
      }

      const [vaultPda] = deriveVaultPda(marketPda)
      const { feeRecipientAta, preInstructions, tokenProgram } =
        await ensureFeeRecipientAta(adminKeypair.publicKey)

      const signature = await program.methods
        .resolveMarket(outcomeArg(outcome))
        .accounts({
          authority: adminKeypair.publicKey,
          market: marketPda,
          vaultTokenAccount: vaultPda,
          feeRecipientTokenAccount: feeRecipientAta,
          walaMint: walaMintPubkey,
          tokenProgram: tokenProgram,
        })
        .preInstructions(preInstructions)
        .rpc()

      console.log(
        `[keeper] mercado ${fixtureId} resolvido como ${outcome} | tx: ${signature}`
      )
    } catch (error) {
      console.error(`[keeper] erro ao processar fixture ${fixtureId}:`, error)
      console.error('[keeper] error message:', error?.message)
      console.error('[keeper] error stack:', error?.stack)
      console.error('[keeper] error logs:', error?.logs || error?.transactionLogs || error?.errorLogs)
      console.error('[keeper] full error json:', JSON.stringify(error, Object.getOwnPropertyNames(error)))
    }
  }
}

export default async (req) => {
  try {
    console.log('[keeper] iniciou function')
    validateConfig()

    const payload = await req.json().catch(() => ({}))
    console.log('[keeper] next_run:', payload?.next_run || 'manual')
    console.log('[keeper] RPC_URL:', RPC_URL)
    console.log('[keeper] WALA_TOKEN_MINT:', WALA_TOKEN_MINT)
    console.log('[keeper] WALA_PREDICTS_PROGRAM_ID:', WALA_PREDICTS_PROGRAM_ID)
    console.log('[keeper] PROTOCOL_FEE_WALLET:', PROTOCOL_FEE_WALLET)
    console.log('[keeper] ADMIN_KEYPAIR_JSON exists:', !!ADMIN_KEYPAIR_JSON)

    const adminKeypair = loadKeypairFromJson(ADMIN_KEYPAIR_JSON)

    console.log('[keeper] admin wallet:', adminKeypair.publicKey.toBase58())

    await resolveFinishedMarketsOnce(adminKeypair)

    console.log('[keeper] finalizou sem erro')
    return new Response(null, { status: 200 })
  } catch (error) {
    console.error('[keeper] erro fatal:', error)
    return new Response(
      JSON.stringify({
        ok: false,
        error: error?.message || String(error),
      }),
      {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }
    )
  }
}

export const config = {
  schedule: '*/2 * * * *',
  includedFiles: ['src/idl/wala_predicts.json'],
}