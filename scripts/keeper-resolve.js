import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js'
import { AnchorProvider, Program } from '@anchor-lang/core'
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from '@solana/spl-token'
const walaPredictsIdl = JSON.parse(
  fs.readFileSync(new URL('../src/idl/wala_predicts.json', import.meta.url), 'utf8')
)

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ===== CONFIG =====
const RPC_URL = 'https://api.devnet.solana.com'
const FOOTBALL_DATA_TOKEN = '8ed2c55323794e458eb6d4c7f97174fd'
const FOOTBALL_DATA_BASE = 'https://api.football-data.org/v4'
const CHECK_EVERY_MS = 60_000

const WALA_TOKEN_MINT = 'F9yVUCWxMHATrZD2dVWonSunJjWF1L8jbBfTfmHczgU2'
const WALA_PREDICTS_PROGRAM_ID = 'hiSmRhGDoLJj5iBzjKtsBENJ2xY3NhFGgYBmPC3cHur'
const PROTOCOL_FEE_WALLET = '8no5SbdExQeUP6sULmvxuaUtbfrwXe41xDQftCNYbbgv'

// ajuste para o caminho real da sua keypair admin
const ADMIN_KEYPAIR_PATH = 'C:/Users/User/.config/solana/id.json'
// ==================

const connection = new Connection(RPC_URL, 'confirmed')
const walaMintPubkey = new PublicKey(WALA_TOKEN_MINT)
const programId = new PublicKey(WALA_PREDICTS_PROGRAM_ID)
const protocolFeeWalletPubkey = new PublicKey(PROTOCOL_FEE_WALLET)

let walaTokenProgramId = TOKEN_PROGRAM_ID

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
    walaTokenProgramId.equals(TOKEN_2022_PROGRAM_ID) ? 'TOKEN_2022_PROGRAM_ID' : 'TOKEN_PROGRAM_ID',
    walaTokenProgramId.toBase58()
  )

  return walaTokenProgramId
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function loadKeypair(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8')
  const secret = Uint8Array.from(JSON.parse(raw))
  return Keypair.fromSecretKey(secret)
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

async function resolveFinishedMarketsOnce() {
  const adminKeypair = loadKeypair(ADMIN_KEYPAIR_PATH)
  const provider = getProvider(adminKeypair)
  const program = getProgram(provider)

  const markets = await program.account.marketAccount.all()

  const openMarkets = markets.filter((item) => isMarketOpen(item.account.status))

  console.log(`\n[keeper] mercados abertos encontrados: ${openMarkets.length}`)

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
    }
  }
}

async function main() {
  console.log('[keeper] iniciado')

  while (true) {
    try {
      await resolveFinishedMarketsOnce()
    } catch (error) {
      console.error('[keeper] erro no loop principal:', error)
    }

    await sleep(CHECK_EVERY_MS)
  }
}

main()