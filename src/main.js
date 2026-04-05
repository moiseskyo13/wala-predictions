import './style.css'
import { Connection, PublicKey, SystemProgram } from '@solana/web3.js'
import { AnchorProvider, Program } from '@anchor-lang/core'
import BN from 'bn.js'
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from '@solana/spl-token'
import walaPredictsIdl from './idl/wala_predicts.json'

const MAINNET_RPC = 'https://api.devnet.solana.com'
const WALA_TOKEN_MINT = 'F9yVUCWxMHATrZD2dVWonSunJjWF1L8jbBfTfmHczgU2'
const WALA_DECIMALS = 9
const WALA_PREDICTS_PROGRAM_ID = 'hiSmRhGDoLJj5iBzjKtsBENJ2xY3NhFGgYBmPC3cHur'
const PROTOCOL_FEE_WALLET = '8no5SbdExQeUP6sULmvxuaUtbfrwXe41xDQftCNYbbgv'
const ADMIN_WALLET = '8no5SbdExQeUP6sULmvxuaUtbfrwXe41xDQftCNYbbgv'
const DEFAULT_FEE_BPS = 300

const connection = new Connection(MAINNET_RPC, 'confirmed')
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
    '[WALA TOKEN PROGRAM]',
    walaTokenProgramId.equals(TOKEN_2022_PROGRAM_ID) ? 'TOKEN_2022_PROGRAM_ID' : 'TOKEN_PROGRAM_ID',
    walaTokenProgramId.toBase58()
  )

  return walaTokenProgramId
}

const FOOTBALL_DATA_BASE = '/api/football-data/v4'
const COMPETITION_CODES = ['BSA', 'CL']
const MATCH_CACHE_KEY = 'wala_predicts_matches_v1'

let walletConnected = false
let selectedMatch = null
let connectedAddress = ''
let connectedPublicKey = null
let selectedOutcome = null

function getPhantomProvider() {
  if ('phantom' in window) {
    const provider = window.phantom?.solana
    if (provider?.isPhantom) return provider
  }

  if (window.solana?.isPhantom) {
    return window.solana
  }

  return null
}

document.querySelector('#app').innerHTML = `
  <div id="sidebarOverlay" class="overlay"></div>
  <div id="walletOverlay" class="overlay"></div>
  <div id="marketModalOverlay" class="overlay"></div>

  <div class="container">
    <div class="topbar">
      <div class="menu-btn" id="menuBtn" aria-label="Abrir menu">
        <span></span>
        <span></span>
        <span></span>
      </div>

      <button id="connectBtn" class="connect" type="button">
        Conectar Wallet
      </button>
    </div>

    <div id="walletMenu" class="wallet-menu">
      <a href="javascript:void(0)" id="addBalanceAction" style="display:none;">Adicionar saldo</a>
      <a href="javascript:void(0)" id="fundTreasuryAction" style="display:none;">Abastecer Treasury Global</a>
      <a href="javascript:void(0)" id="disconnectAction" style="display:none;">Desconectar Wallet</a>
    </div>

    <div id="sidebar" class="side-menu">
      <a href="https://walat.netlify.app/">Wala-Token</a>
      <a href="/carteira.html">Carteira</a>
      <a href="/posicoes.html">Minhas Posições</a>
    </div>

    <div class="card">
      <h1 class="title"><span class="wala-color">WALA</span> Predictions</h1>
      <p class="wallet-subtitle">
        Mercados esportivos futebol.
      </p>

      <div class="wallet-stats" style="display:none;">
        <div class="wallet-stat-box">
          <span class="wallet-stat-label">Wallet</span>
          <strong id="walletAddressText" class="wallet-stat-value">Não conectada</strong>
        </div>

        <div class="wallet-stat-box">
          <span class="wallet-stat-label">Saldo WALA</span>
          <strong id="walletBalanceText" class="wallet-stat-value">0</strong>
        </div>
      </div>

      <div class="mint-box" style="display:none;">
        <span class="mint-label">Token do market</span>
        <strong id="marketMintText">${WALA_TOKEN_MINT}</strong>
      </div>

      <input
        id="searchInput"
        class="input"
        type="text"
        placeholder="Buscar por campeonato, time ou mercado"
      />
    </div>

    <div class="card">
      <div class="section-head">
        <h3>Destaques</h3>
        <span class="section-count" id="featuredCount">0</span>
      </div>

      <div id="featuredGrid" class="match-grid"></div>

      <div id="featuredEmpty" class="empty-state">
        Nenhum destaque encontrado.
      </div>
    </div>

    <div class="card">
      <div class="section-head">
        <h3>Mercados Abertos</h3>
        <span class="section-count" id="marketCount">0</span>
      </div>

      <div id="marketGrid" class="match-grid"></div>

      <div id="marketEmpty" class="empty-state">
        Nenhum mercado disponível no momento.
      </div>
    </div>
  </div>

  <div id="marketModal" class="custom-modal">
    <div class="card modal-card">
      <div class="modal-header">
        <h3>Detalhes do mercado</h3>
        <button class="modal-close" id="closeModalBtn" type="button">✕</button>
      </div>

      <div class="match-box">
        <div class="match-league" id="modalLeague">Brasileirão</div>
        <div class="match-teams">
          <div class="team-block">
            <div class="team-badge">A</div>
            <strong id="modalTeamA">Flamengo</strong>
          </div>

          <div class="match-versus">VS</div>

          <div class="team-block">
            <div class="team-badge">B</div>
            <strong id="modalTeamB">Palmeiras</strong>
          </div>
        </div>

        <div class="match-time" id="modalTime">Hoje • 21:30</div>
      </div>

      <div class="stats-grid">
        <div class="stat-box">
          <span class="stat-label">Prob. Time A</span>
          <strong class="stat-value" id="modalProbA">40%</strong>
        </div>

        <div class="stat-box">
          <span class="stat-label">Empate</span>
          <strong class="stat-value" id="modalProbDraw">30%</strong>
        </div>

        <div class="stat-box">
          <span class="stat-label">Prob. Time B</span>
          <strong class="stat-value" id="modalProbB">30%</strong>
        </div>
      </div>

      <label class="modal-label">Previsão</label>
      <div class="market-question" id="modalQuestion">
        Qual resultado é mais provável?
      </div>

      <div class="bet-panel">
        <div class="bet-top">
          <div id="selectedOutcomeChip" class="selected-outcome-chip">Selecione um lado</div>
          <div id="estimatedPayoutText" class="estimated-payout-text">Retorno estimado: --</div>
        </div>

        <input
          id="betAmountInput"
          class="input bet-amount-input"
          type="number"
          min="0"
          step="0.01"
          placeholder="Digite o valor da aposta"
        />

        <div id="betHintText" class="bet-hint-text">
          O retorno é uma estimativa com base no pool atual.
        </div>
      </div>

      <div class="modal-footer">
        <button id="forecastABtn" class="trade" type="button">Time A</button>
        <button id="forecastDrawBtn" class="trade" type="button">Empate</button>
        <button id="forecastBBtn" class="launch" type="button">Time B</button>
      </div>

      <button id="confirmBetBtn" class="launch confirm-bet-btn" type="button" disabled>
        Confirmar aposta
      </button>

      <button id="seedMarketBtn" class="connect confirm-bet-btn" type="button" style="display:none;">
        Injetar pool inicial
      </button>
    </div>
  </div>
`

let matches = []

const featuredGrid = document.getElementById('featuredGrid')
const marketGrid = document.getElementById('marketGrid')
const featuredCount = document.getElementById('featuredCount')
const marketCount = document.getElementById('marketCount')
const featuredEmpty = document.getElementById('featuredEmpty')
const marketEmpty = document.getElementById('marketEmpty')
const searchInput = document.getElementById('searchInput')
const walletAddressText = document.getElementById('walletAddressText')
const walletBalanceText = document.getElementById('walletBalanceText')

const sidebar = document.getElementById('sidebar')
const walletMenu = document.getElementById('walletMenu')
const sidebarOverlay = document.getElementById('sidebarOverlay')
const walletOverlay = document.getElementById('walletOverlay')
const marketModalOverlay = document.getElementById('marketModalOverlay')
const menuBtn = document.getElementById('menuBtn')
const connectBtn = document.getElementById('connectBtn')
const addBalanceAction = document.getElementById('addBalanceAction')
const fundTreasuryAction = document.getElementById('fundTreasuryAction')
const disconnectAction = document.getElementById('disconnectAction')

const marketModal = document.getElementById('marketModal')
const closeModalBtn = document.getElementById('closeModalBtn')
const forecastABtn = document.getElementById('forecastABtn')
const forecastDrawBtn = document.getElementById('forecastDrawBtn')
const forecastBBtn = document.getElementById('forecastBBtn')

const modalLeague = document.getElementById('modalLeague')
const modalTeamA = document.getElementById('modalTeamA')
const modalTeamB = document.getElementById('modalTeamB')
const modalTime = document.getElementById('modalTime')
const modalProbA = document.getElementById('modalProbA')
const modalProbDraw = document.getElementById('modalProbDraw')
const modalProbB = document.getElementById('modalProbB')
const modalQuestion = document.getElementById('modalQuestion')
const selectedOutcomeChip = document.getElementById('selectedOutcomeChip')
const estimatedPayoutText = document.getElementById('estimatedPayoutText')
const betAmountInput = document.getElementById('betAmountInput')
const betHintText = document.getElementById('betHintText')
const confirmBetBtn = document.getElementById('confirmBetBtn')
const seedMarketBtn = document.getElementById('seedMarketBtn')

function isBettableStatus(status) {
  return status === 'SCHEDULED' || status === 'TIMED'
}

function getStatusPriority(status) {
  if (status === 'TIMED') return 0
  if (status === 'SCHEDULED') return 1
  if (status === 'IN_PLAY') return 2
  if (status === 'PAUSED') return 3
  if (status === 'FINISHED') return 4
  return 5
}

function normalizeCompetitionName(code, fallbackName) {
  const map = {
    BSA: 'Brasileirão',
    CLI: 'Libertadores',
    CL: 'Champions League',
    WC: 'Copa do Mundo',
  }

  return map[code] || fallbackName || 'Competição'
}

function getLocalDateString(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getFutureDateString(daysAhead = 21) {
  const date = new Date()
  date.setDate(date.getDate() + daysAhead)
  return getLocalDateString(date)
}

async function footballDataGet(path) {
  const url = `${FOOTBALL_DATA_BASE}${path}`

  const response = await fetch(url, {
  method: 'GET',
  headers: {
    Accept: 'application/json',
  },
})

  const rawText = await response.text()
  const contentType = response.headers.get('content-type') || ''

  console.log('football-data url:', url)
  console.log('football-data status:', response.status)
  console.log('football-data content-type:', contentType)
  console.log('football-data preview:', rawText.slice(0, 300))

  if (!response.ok) {
    throw new Error(`football-data ${response.status} - ${rawText}`)
  }

  if (!contentType.includes('application/json')) {
    throw new Error(`Resposta não JSON recebida: ${contentType} - ${rawText.slice(0, 300)}`)
  }

  return JSON.parse(rawText)
}

function loadMatchesCache() {
  return null
}

function saveMatchesCache() {
  // sem cache local
}

function getAnchorWallet() {
  const provider = getPhantomProvider()

  if (!provider?.publicKey || !provider?.signTransaction) {
    throw new Error('Wallet Phantom não conectada.')
  }

  return {
    publicKey: provider.publicKey,
    signTransaction: provider.signTransaction.bind(provider),
    signAllTransactions: provider.signAllTransactions
      ? provider.signAllTransactions.bind(provider)
      : undefined,
  }
}

function getAnchorProvider() {
  return new AnchorProvider(
    connection,
    getAnchorWallet(),
    {
      commitment: 'confirmed',
      preflightCommitment: 'confirmed',
    }
  )
}

function getProgram(provider = null) {
  if (provider) {
    return new Program(walaPredictsIdl, provider)
  }

  return new Program(walaPredictsIdl, { connection })
}

function toLeBytesU64(value) {
  return new BN(String(value)).toArrayLike(Uint8Array, 'le', 8)
}

function deriveMarketPda(fixtureId) {
  return PublicKey.findProgramAddressSync(
    [new TextEncoder().encode('market'), toLeBytesU64(fixtureId)],
    programId
  )
}

function deriveVaultPda(marketPda) {
  return PublicKey.findProgramAddressSync(
    [new TextEncoder().encode('vault'), marketPda.toBuffer()],
    programId
  )
}

function derivePositionPda(marketPda, userPubkey, couponId) {
  return PublicKey.findProgramAddressSync(
    [
      new TextEncoder().encode('position'),
      marketPda.toBuffer(),
      userPubkey.toBuffer(),
      new BN(String(couponId)).toArrayLike(Uint8Array, 'le', 8),
    ],
    programId
  )
}

function deriveTreasuryPda() {
  return PublicKey.findProgramAddressSync(
    [new TextEncoder().encode('treasury'), walaMintPubkey.toBuffer()],
    programId
  )
}

function deriveTreasuryVaultPda(treasuryPda) {
  return PublicKey.findProgramAddressSync(
    [new TextEncoder().encode('treasury_vault'), treasuryPda.toBuffer()],
    programId
  )
}

function uiToRawAmount(value, decimals = WALA_DECIMALS) {
  const normalized = String(value).replace(',', '.').trim()
  if (!normalized) throw new Error('Valor vazio.')

  const [wholeRaw, fracRaw = ''] = normalized.split('.')
  const whole = wholeRaw || '0'
  const frac = (fracRaw + '0'.repeat(decimals)).slice(0, decimals)

  const combined = `${whole}${frac}`.replace(/^0+(?=\d)/, '')
  return new BN(combined || '0')
}

function rawToUiText(value, decimals = WALA_DECIMALS) {
  const str = new BN(value).toString()
  const padded = str.padStart(decimals + 1, '0')
  const whole = padded.slice(0, -decimals)
  const frac = padded.slice(-decimals).replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : whole
}

function formatUiNumber(value) {
  const num = Number(value || 0)
  if (!Number.isFinite(num)) return '0'
  return num.toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
}

function percentTextToBps(value) {
  const percent = Number(
    String(value || '').replace('%', '').replace(',', '.').trim()
  )

  if (!Number.isFinite(percent) || percent <= 0 || percent >= 100) {
    throw new Error('Probabilidade inválida do mercado.')
  }

  return Math.round(percent * 100)
}

function getProjectedPayout(match, market, outcome, amountUi) {
  const amount = Number(String(amountUi || 0).replace(',', '.'))
  if (!Number.isFinite(amount) || amount <= 0) return null

  const feeRate = DEFAULT_FEE_BPS / 10000

  const rawProb =
    outcome === 'HOME'
      ? match?.probA
      : outcome === 'DRAW'
        ? match?.probDraw
        : match?.probB

  const probPercent = Number(
    String(rawProb || '').replace('%', '').replace(',', '.').trim()
  )

  if (!Number.isFinite(probPercent) || probPercent <= 0 || probPercent >= 100) {
    return null
  }

  const probability = probPercent / 100
  const grossProfit = amount * (1 - probability)
  const feeOnProfit = grossProfit * feeRate
  const netProfit = grossProfit - feeOnProfit
  const payout = amount + netProfit

  return {
    payout,
    profit: netProfit,
  }
}

async function updateBetPreview() {
  if (!selectedMatch || !selectedOutcome) {
    estimatedPayoutText.textContent = 'Retorno estimado: --'
    confirmBetBtn.disabled = true
    return
  }

  const amountValue = betAmountInput.value.trim()
  const amount = Number(String(amountValue || 0).replace(',', '.'))

  if (!amountValue || !Number.isFinite(amount) || amount <= 0) {
    estimatedPayoutText.textContent = 'Retorno estimado: --'
    confirmBetBtn.disabled = true
    return
  }

  const { market } = await fetchMarketAccount(selectedMatch)
  const projected = getProjectedPayout(selectedMatch, market, selectedOutcome, amount)

  if (!projected) {
    estimatedPayoutText.textContent = 'Retorno estimado: --'
    confirmBetBtn.disabled = true
    return
  }

  estimatedPayoutText.textContent =
    `Retorno estimado: ${formatUiNumber(projected.payout)} WALA`

  betHintText.textContent =
    `Lucro base estimado: ${formatUiNumber(projected.profit)} WALA • pode mudar conforme novas apostas`

  confirmBetBtn.disabled = false
}

function isAdminWallet() {
  return walletConnected && connectedAddress === ADMIN_WALLET
}

function setSelectedOutcome(outcome) {
  selectedOutcome = outcome

  selectedOutcomeChip.textContent =
    outcome === 'HOME'
      ? selectedMatch.teamA
      : outcome === 'DRAW'
        ? 'Empate'
        : selectedMatch.teamB

  forecastABtn.classList.toggle('active-pick', outcome === 'HOME')
  forecastDrawBtn.classList.toggle('active-pick', outcome === 'DRAW')
  forecastBBtn.classList.toggle('active-pick', outcome === 'AWAY')

  updateBetPreview()
}

function compactUiAmount(value, decimals = WALA_DECIMALS) {
  const num = Number(rawToUiText(value, decimals) || 0)

  if (!Number.isFinite(num)) return '0'
  if (num >= 1000000) return `${(num / 1000000).toFixed(num % 1000000 === 0 ? 0 : 1)}M`
  if (num >= 1000) return `${(num / 1000).toFixed(num % 1000 === 0 ? 0 : 1)}k`
  if (num % 1 === 0) return String(num)

  return num.toFixed(2)
}

async function fetchMarketAccount(match) {
  const program = getProgram()
  const [marketPda] = deriveMarketPda(match.fixtureId)

  try {
    const market = await program.account.marketAccount.fetchNullable(marketPda)
    return { marketPda, market }
  } catch (error) {
    console.warn('Erro ao buscar market on-chain:', error)
    return { marketPda, market: null }
  }
}

async function ensureMarketOnChain(match) {
  const provider = getAnchorProvider()
  const program = getProgram(provider)

  const [marketPda] = deriveMarketPda(match.fixtureId)
  const [vaultPda] = deriveVaultPda(marketPda)

  const existing = await program.account.marketAccount.fetchNullable(marketPda)
  if (existing) {
    return { marketPda, vaultPda, market: existing }
  }

  const signature = await program.methods
  .createMarket(
    new BN(String(match.fixtureId)),
    match.league,
    match.teamA,
    match.teamB,
    DEFAULT_FEE_BPS,
    percentTextToBps(match.probA),
    percentTextToBps(match.probDraw),
    percentTextToBps(match.probB)
  )
    .accounts({
      authority: provider.wallet.publicKey,
      market: marketPda,
      vaultTokenAccount: vaultPda,
      walaMint: walaMintPubkey,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc()

  console.log('Market criado on-chain:', signature)

  const market = await program.account.marketAccount.fetch(marketPda)
  return { marketPda, vaultPda, market }
}

async function ensureTreasuryOnChain() {
  const provider = getAnchorProvider()
  const program = getProgram(provider)

  const [treasuryPda] = deriveTreasuryPda()
  const [treasuryVaultPda] = deriveTreasuryVaultPda(treasuryPda)

  const existing = await program.account.treasuryAccount.fetchNullable(treasuryPda)
  if (existing) {
    return { treasuryPda, treasuryVaultPda, treasury: existing }
  }

  const tokenProgram = await detectWalaTokenProgram()

const signature = await program.methods
  .initTreasury()
  .accounts({
    admin: provider.wallet.publicKey,
    treasury: treasuryPda,
    treasuryVaultTokenAccount: treasuryVaultPda,
    walaMint: walaMintPubkey,
    tokenProgram: tokenProgram,
    systemProgram: SystemProgram.programId,
  })
  .rpc()

  console.log('Treasury criada on-chain:', signature)

  const treasury = await program.account.treasuryAccount.fetch(treasuryPda)
  return { treasuryPda, treasuryVaultPda, treasury }
}

async function depositTreasuryOnChain() {
  if (!walletConnected) {
    alert('Conecte a wallet admin antes de abastecer a treasury.')
    return
  }

  if (!isAdminWallet()) {
    alert('Apenas a wallet admin pode abastecer a treasury global.')
    return
  }

  const amountValue = prompt('Valor em WALA V2 para abastecer a Treasury Global', '10000')
  if (amountValue === null) return

  let rawAmount
  try {
    rawAmount = uiToRawAmount(amountValue)
  } catch (error) {
    alert(error?.message || 'Valor inválido.')
    return
  }

  if (rawAmount.lten(0)) {
    alert('Valor inválido.')
    return
  }

  closeWalletMenu()

  try {
    const provider = getAnchorProvider()
    const program = getProgram(provider)
    const { treasuryPda, treasuryVaultPda } = await ensureTreasuryOnChain()

    const adminWalaAta = await getAssociatedTokenAddress(
      walaMintPubkey,
      provider.wallet.publicKey,
      false,
      TOKEN_PROGRAM_ID
    )

    const signature = await program.methods
      .depositTreasury(rawAmount)
      .accounts({
        admin: provider.wallet.publicKey,
        treasury: treasuryPda,
        adminWalaAta,
        treasuryVaultTokenAccount: treasuryVaultPda,
        walaMint: walaMintPubkey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc()

    console.log('Deposit treasury on-chain:', signature)

    await loadWalletTokenBalance()
    alert(`Treasury global abastecida com sucesso.\nHash: ${signature}`)
  } catch (error) {
    console.error('Erro ao abastecer treasury global:', error)
    alert(error?.message || 'Erro ao abastecer treasury global.')
  }
}

function outcomeArg(outcome) {
  if (outcome === 'HOME') return { home: {} }
  if (outcome === 'DRAW') return { draw: {} }
  return { away: {} }
}

function outcomeLabel(outcome, match) {
  if (outcome === 'HOME') return match.teamA
  if (outcome === 'DRAW') return 'Empate'
  return match.teamB
}

async function buyPositionOnChain(outcome) {
  if (!selectedMatch) return

  if (!walletConnected) {
    betHintText.textContent = 'Conecte a wallet antes de comprar posição.'
    return
  }

  if (!isBettableStatus(selectedMatch.status)) {
    betHintText.textContent = 'Esse mercado não está aberto.'
    return
  }

  const amountInput = betAmountInput.value.trim()
  if (!amountInput) {
    betHintText.textContent = 'Digite o valor da aposta.'
    return
  }

  const rawAmount = uiToRawAmount(amountInput)
  if (rawAmount.lten(0)) {
    betHintText.textContent = 'Valor inválido.'
    return
  }

  confirmBetBtn.disabled = true
  confirmBetBtn.textContent = 'Enviando...'

  const provider = getAnchorProvider()
  const program = getProgram(provider)

  const tokenProgram = await detectWalaTokenProgram()

const { marketPda, vaultPda } = await ensureMarketOnChain(selectedMatch)

const couponId = Date.now()

const [positionPda] = derivePositionPda(
  marketPda,
  provider.wallet.publicKey,
  couponId
)

const userWalaAta = await getAssociatedTokenAddress(
  walaMintPubkey,
  provider.wallet.publicKey,
  false,
  tokenProgram
)

const signature = await program.methods
  .buyPosition(new BN(String(couponId)), outcomeArg(outcome), rawAmount)
  .accounts({
    user: provider.wallet.publicKey,
    market: marketPda,
    userWalaAta,
    position: positionPda,
    vaultTokenAccount: vaultPda,
    walaMint: walaMintPubkey,
    tokenProgram: tokenProgram,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .rpc()
  console.log('Compra on-chain:', signature)

  await loadWalletTokenBalance()
  await openMarketModal(selectedMatch)

  betHintText.textContent = `Aposta enviada com sucesso. Hash: ${signature.slice(0, 10)}...`
  betAmountInput.value = ''
  confirmBetBtn.textContent = 'Confirmar aposta'
  confirmBetBtn.disabled = true
}

async function resolveMarketOnChain() {
  if (!selectedMatch) return

  if (selectedMatch.status !== 'FINISHED') {
    alert('Esse mercado só pode ser resolvido após o fim do evento.')
    return
  }

  const provider = getAnchorProvider()
  const program = getProgram(provider)

  const typed = prompt('Digite HOME, DRAW ou AWAY')
  if (!typed) return
  const outcome = typed.trim().toUpperCase()
  if (!['HOME', 'DRAW', 'AWAY'].includes(outcome)) {
    alert('Use HOME, DRAW ou AWAY.')
    return
  }

  const { marketPda } = await fetchMarketAccount(selectedMatch)
  const market = await program.account.marketAccount.fetchNullable(marketPda)

  if (!market) {
    alert('Esse mercado ainda não existe on-chain.')
    return
  }

  const tokenProgram = await detectWalaTokenProgram()

const [vaultPda] = deriveVaultPda(marketPda)
const feeRecipientAta = await getAssociatedTokenAddress(
  walaMintPubkey,
  protocolFeeWalletPubkey,
  false,
  tokenProgram
)

const preInstructions = []
const feeAtaInfo = await connection.getAccountInfo(feeRecipientAta)

if (!feeAtaInfo) {
  preInstructions.push(
    createAssociatedTokenAccountInstruction(
      provider.wallet.publicKey,
      feeRecipientAta,
      protocolFeeWalletPubkey,
      walaMintPubkey,
      tokenProgram,
      ASSOCIATED_TOKEN_PROGRAM_ID
    )
  )
}

const signature = await program.methods
  .resolveMarket(outcomeArg(outcome))
  .accounts({
    authority: provider.wallet.publicKey,
    market: marketPda,
    vaultTokenAccount: vaultPda,
    feeRecipientTokenAccount: feeRecipientAta,
    walaMint: walaMintPubkey,
    tokenProgram: tokenProgram,
  })
    .preInstructions(preInstructions)
    .rpc()

  console.log('Resolve on-chain:', signature)

  await openMarketModal(selectedMatch)
  alert(`Mercado resolvido on-chain.\nHash: ${signature}`)
}

async function claimPositionOnChain() {
  if (!selectedMatch) return

  if (!walletConnected) {
    alert('Conecte a wallet antes de resgatar.')
    return
  }

  const provider = getAnchorProvider()
  const program = getProgram(provider)

  const { marketPda } = await fetchMarketAccount(selectedMatch)
  const market = await program.account.marketAccount.fetchNullable(marketPda)

  if (!market) {
    alert('Mercado não encontrado on-chain.')
    return
  }

  const [treasuryPda] = deriveTreasuryPda()
  const [treasuryVaultPda] = deriveTreasuryVaultPda(treasuryPda)
  const treasury = await program.account.treasuryAccount.fetchNullable(treasuryPda)

  if (!treasury) {
    alert('Treasury global ainda não foi criada pela admin.')
    return
  }

  const [positionPda] = derivePositionPda(marketPda, provider.wallet.publicKey)
  const [vaultPda] = deriveVaultPda(marketPda)

  const tokenProgram = await detectWalaTokenProgram()

const userWalaAta = await getAssociatedTokenAddress(
  walaMintPubkey,
  provider.wallet.publicKey,
  false,
  tokenProgram
)

const preInstructions = []
const userAtaInfo = await connection.getAccountInfo(userWalaAta)

if (!userAtaInfo) {
  preInstructions.push(
    createAssociatedTokenAccountInstruction(
      provider.wallet.publicKey,
      userWalaAta,
      provider.wallet.publicKey,
      walaMintPubkey,
      tokenProgram,
      ASSOCIATED_TOKEN_PROGRAM_ID
    )
  )
}

const signature = await program.methods
  .claimPosition()
  .accounts({
    user: provider.wallet.publicKey,
    market: marketPda,
    position: positionPda,
    vaultTokenAccount: vaultPda,
    treasury: treasuryPda,
    treasuryVaultTokenAccount: treasuryVaultPda,
    userWalaAta,
    walaMint: walaMintPubkey,
    tokenProgram: tokenProgram,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
    .preInstructions(preInstructions)
    .rpc()

  console.log('Claim on-chain:', signature)

  await loadWalletTokenBalance()
  await openMarketModal(selectedMatch)

  alert(`Resgate concluído on-chain.\nHash: ${signature}`)
}

async function openMarketModal(match) {
  selectedMatch = match
  modalLeague.textContent = match.league
  modalTeamA.textContent = match.teamA
  modalTeamB.textContent = match.teamB
  modalTime.textContent = match.time
  modalProbA.textContent = match.probA
  modalProbDraw.textContent = match.probDraw
  modalProbB.textContent = match.probB

  const { market } = await fetchMarketAccount(match)

  if (!market) {
    modalQuestion.innerHTML = `
      <div class="market-mini-status">
        <span class="market-chip pending">NOVO</span>
        <span class="market-total">Sem pool</span>
      </div>
      <div class="market-mini-pools">
        <span>A 0</span>
        <span>E 0</span>
        <span>B 0</span>
      </div>
    `
  } else {
    const home = compactUiAmount(market.poolHome)
    const draw = compactUiAmount(market.poolDraw)
    const away = compactUiAmount(market.poolAway)
    const total = compactUiAmount(market.totalPool)
    const statusText = market.status?.open ? 'ABERTO' : 'RESOLVIDO'
    const statusClass = market.status?.open ? 'open' : 'resolved'

    modalQuestion.innerHTML = `
      <div class="market-mini-status">
        <span class="market-chip ${statusClass}">${statusText}</span>
        <span class="market-total">Pool ${total} WALA</span>
      </div>
      <div class="market-mini-pools">
        <span>A ${home}</span>
        <span>E ${draw}</span>
        <span>B ${away}</span>
      </div>
    `
  }

  seedMarketBtn.style.display = 'none'
  seedMarketBtn.disabled = true
  seedMarketBtn.textContent = 'Injetar pool inicial'

  const canForecast = isBettableStatus(match.status)

  forecastABtn.disabled = !canForecast
  forecastDrawBtn.disabled = !canForecast
  forecastBBtn.disabled = !canForecast

  forecastABtn.textContent = match.teamA
  forecastDrawBtn.textContent = 'Empate'
  forecastBBtn.textContent = match.teamB

  selectedOutcome = null
  selectedOutcomeChip.textContent = 'Selecione um lado'
  estimatedPayoutText.textContent = 'Retorno estimado: --'
  betHintText.textContent = 'O retorno é uma estimativa com base no pool atual.'
  betAmountInput.value = ''
  confirmBetBtn.textContent = 'Confirmar aposta'
  confirmBetBtn.disabled = true

  forecastABtn.classList.remove('active-pick')
  forecastDrawBtn.classList.remove('active-pick')
  forecastBBtn.classList.remove('active-pick')

  marketModal.classList.add('active')
  marketModalOverlay.classList.add('active')
}

function formatMatchTime(match) {
  const status = match?.status

  if (status === 'IN_PLAY') return 'Ao vivo'
  if (status === 'PAUSED') return 'Intervalo'
  if (status === 'FINISHED') return 'Encerrado'

  const date = new Date(match?.utcDate)

  return date.toLocaleString('pt-BR', {
    timeZone: 'America/Fortaleza',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).replace(',', ' •')
}

function getPastDateString(daysBack = 120) {
  const date = new Date()
  date.setDate(date.getDate() - daysBack)
  return getLocalDateString(date)
}

function formStringToPoints(form = '') {
  return String(form)
    .split(',')
    .map((item) => item.trim().toUpperCase())
    .slice(-5)
    .reduce((sum, result) => {
      if (result === 'W') return sum + 3
      if (result === 'D') return sum + 1
      return sum
    }, 0)
}

function buildRecentFormMap(finishedMatches) {
  const map = new Map()

  function ensureTeam(team) {
    if (!team?.id) return null

    if (!map.has(team.id)) {
      map.set(team.id, {
        teamId: team.id,
        games: 0,
        points: 0,
        goalDifference: 0,
        lastResults: [],
      })
    }

    return map.get(team.id)
  }

  const ordered = [...finishedMatches].sort(
    (a, b) => new Date(a.utcDate) - new Date(b.utcDate)
  )

  ordered.forEach((match) => {
    const homeGoals = match?.score?.fullTime?.home
    const awayGoals = match?.score?.fullTime?.away

    if (homeGoals == null || awayGoals == null) return

    const home = ensureTeam(match?.homeTeam)
    const away = ensureTeam(match?.awayTeam)

    if (!home || !away) return

    home.games += 1
    away.games += 1

    home.goalDifference += homeGoals - awayGoals
    away.goalDifference += awayGoals - homeGoals

    if (homeGoals > awayGoals) {
      home.points += 3
      home.lastResults.push('W')
      away.lastResults.push('L')
    } else if (awayGoals > homeGoals) {
      away.points += 3
      away.lastResults.push('W')
      home.lastResults.push('L')
    } else {
      home.points += 1
      away.points += 1
      home.lastResults.push('D')
      away.lastResults.push('D')
    }
  })

  map.forEach((team) => {
    const lastFive = team.lastResults.slice(-5)
    team.formPoints = lastFive.reduce((sum, result) => {
      if (result === 'W') return sum + 3
      if (result === 'D') return sum + 1
      return sum
    }, 0)

    team.pointsPerGame = team.games ? team.points / team.games : 0
    team.goalDiffPerGame = team.games ? team.goalDifference / team.games : 0
  })

  return map
}

async function fetchCompetitionStandings(code) {
  try {
    const data = await footballDataGet(`/competitions/${code}/standings`)
    const standings = Array.isArray(data?.standings) ? data.standings : []
    const selected =
      standings.find((item) => item?.type === 'TOTAL') || standings[0] || null
    const table = Array.isArray(selected?.table) ? selected.table : []

    const map = new Map()

    table.forEach((row) => {
      const teamId = row?.team?.id
      if (!teamId) return

      map.set(teamId, {
        position: row?.position ?? 99,
        points: row?.points ?? 0,
        goalDifference: row?.goalDifference ?? 0,
        form: row?.form || '',
      })
    })

    return map
  } catch (error) {
    console.warn(`Tabela ${code} indisponível:`, error)
    return new Map()
  }
}

async function fetchCompetitionRecentForm(code) {
  try {
    const dateFrom = getPastDateString(120)
    const dateTo = getLocalDateString()

    const data = await footballDataGet(
      `/competitions/${code}/matches?status=FINISHED&dateFrom=${dateFrom}&dateTo=${dateTo}`
    )

    const list = Array.isArray(data?.matches) ? data.matches : []
    return buildRecentFormMap(list)
  } catch (error) {
    console.warn(`Forma recente ${code} indisponível:`, error)
    return new Map()
  }
}

async function buildCompetitionContext(code) {
  const [standingsMap, recentFormMap] = await Promise.all([
    fetchCompetitionStandings(code),
    fetchCompetitionRecentForm(code),
  ])

  return { standingsMap, recentFormMap }
}

function getTeamStrengthScore(teamId, context, isHome = false) {
  const standing = context?.standingsMap?.get(teamId)
  const recent = context?.recentFormMap?.get(teamId)

  let score = isHome ? 2 : 0

  if (standing) {
    score += Math.max(0, 22 - standing.position) * 1.4
    score += standing.points * 0.12
    score += standing.goalDifference * 0.08
    score += formStringToPoints(standing.form) * 0.9
  }

  if (recent) {
    score += recent.pointsPerGame * 8
    score += recent.goalDiffPerGame * 3
    score += recent.formPoints * 0.6
  }

  if (!standing && !recent) {
    score += 10
  }

  return score
}

function getProbabilitiesFromDiff(diff) {
  const absDiff = Math.abs(diff)

  if (absDiff >= 18) return { favorite: 70, draw: 10, underdog: 20 }
  if (absDiff >= 12) return { favorite: 65, draw: 15, underdog: 20 }
  if (absDiff >= 8) return { favorite: 58, draw: 17, underdog: 25 }
  if (absDiff >= 4) return { favorite: 50, draw: 20, underdog: 30 }

  return { home: 40, draw: 30, away: 30 }
}

function calculateProbabilitiesForMatch(match, context) {
  const homeId = match?.homeTeam?.id
  const awayId = match?.awayTeam?.id

  const homeScore = getTeamStrengthScore(homeId, context, true)
  const awayScore = getTeamStrengthScore(awayId, context, false)

  const diff = homeScore - awayScore
  const absDiff = Math.abs(diff)

  console.log('FORECAST DEBUG', {
    game: `${match?.homeTeam?.name} vs ${match?.awayTeam?.name}`,
    homeScore,
    awayScore,
    diff,
    hasStandingHome: !!context?.standingsMap?.get(homeId),
    hasStandingAway: !!context?.standingsMap?.get(awayId),
    hasRecentHome: !!context?.recentFormMap?.get(homeId),
    hasRecentAway: !!context?.recentFormMap?.get(awayId),
  })

  if (absDiff < 4) {
    return {
      probA: '40%',
      probDraw: '30%',
      probB: '30%',
    }
  }

  const probs = getProbabilitiesFromDiff(diff)

  if (diff >= 0) {
    return {
      probA: `${probs.favorite}%`,
      probDraw: `${probs.draw}%`,
      probB: `${probs.underdog}%`,
    }
  }

  return {
    probA: `${probs.underdog}%`,
    probDraw: `${probs.draw}%`,
    probB: `${probs.favorite}%`,
  }
}

function mapFootballDataMatch(
  match,
  index,
  forecast = { probA: '40%', probDraw: '30%', probB: '30%' }
) {
  const competitionCode = match?.competition?.code

  return {
    id: match.id,
    fixtureId: match.id,
    competitionCode,
    league: normalizeCompetitionName(competitionCode, match?.competition?.name),
    teamA: match?.homeTeam?.shortName || match?.homeTeam?.name || 'Time A',
    teamB: match?.awayTeam?.shortName || match?.awayTeam?.name || 'Time B',
    time: formatMatchTime(match),
    probA: forecast.probA,
    probDraw: forecast.probDraw,
    probB: forecast.probB,
    featured: index < 2,
    status: match?.status || 'SCHEDULED',
    scoreA: match?.score?.fullTime?.home ?? null,
    scoreB: match?.score?.fullTime?.away ?? null,
  }
}

async function fetchCompetitionMatches(code, dateFrom, dateTo) {
  try {
    const data = await footballDataGet(
      `/competitions/${code}/matches?dateFrom=${dateFrom}&dateTo=${dateTo}`
    )

    const list = Array.isArray(data?.matches) ? data.matches : []

    return list.filter((match) => {
      return match?.status === 'SCHEDULED' || match?.status === 'TIMED'
    })
  } catch (error) {
    console.warn(`Competição ${code} indisponível:`, error)
    return []
  }
}

async function fetchRealMatches() {
  const cachedMatches = loadMatchesCache()

  if (cachedMatches) {
    matches = cachedMatches
    return
  }

  featuredEmpty.textContent = 'Carregando jogos reais...'
  marketEmpty.textContent = 'Carregando jogos reais...'
  featuredEmpty.classList.add('show')
  marketEmpty.classList.add('show')

  const dateFrom = getLocalDateString()
  const dateTo = getFutureDateString(21)

  const lists = await Promise.all(
    COMPETITION_CODES.map((code) => fetchCompetitionMatches(code, dateFrom, dateTo))
  )

  const contextPairs = await Promise.all(
    COMPETITION_CODES.map(async (code) => {
      const context = await buildCompetitionContext(code)
      return [code, context]
    })
  )

  const contexts = Object.fromEntries(contextPairs)

  console.log(
    'Jogos por competição:',
    COMPETITION_CODES.map((code, index) => ({
      code,
      total: lists[index]?.length || 0,
    }))
  )

  const merged = lists
    .flat()
    .filter((match) => match?.homeTeam?.name && match?.awayTeam?.name)
    .sort((a, b) => {
      const statusDiff = getStatusPriority(a.status) - getStatusPriority(b.status)
      if (statusDiff !== 0) return statusDiff
      return new Date(a.utcDate) - new Date(b.utcDate)
    })
    .map((match, index) => {
      const competitionCode = match?.competition?.code
      const forecast = calculateProbabilitiesForMatch(match, contexts[competitionCode])
      return mapFootballDataMatch(match, index, forecast)
    })

  matches = merged

  if (matches.length > 0) {
    saveMatchesCache(matches)
  } else {
    localStorage.removeItem(MATCH_CACHE_KEY)
    console.warn('Nenhum jogo retornado da API.')
  }
}

function setConnectButtonText(text) {
  connectBtn.textContent = text
}

function setConnectedUI() {
  disconnectAction.style.display = 'block'
  addBalanceAction.style.display = 'block'
  fundTreasuryAction.style.display = isAdminWallet() ? 'block' : 'none'
}

function setDisconnectedUI() {
  disconnectAction.style.display = 'none'
  addBalanceAction.style.display = 'none'
  fundTreasuryAction.style.display = 'none'
  setConnectButtonText('Conectar Wallet')
}

function updateWalletBalanceUI(uiAmount = 0) {
  const formatted = Number(uiAmount || 0).toLocaleString('pt-BR', {
    maximumFractionDigits: 6,
  })

  walletBalanceText.textContent = formatted

  if (walletConnected) {
    setConnectButtonText(`${formatted} WALA`)
  }
}

function openAddBalance() {
  closeWalletMenu()
  alert('Aqui você vai abrir a conversão para WALA V2.')
}

function openSidebar() {
  sidebar.style.right = '0'
  sidebarOverlay.classList.add('active')
}

function closeSidebar() {
  sidebar.style.right = '-280px'
  sidebarOverlay.classList.remove('active')
}

function openWalletMenu() {
  walletMenu.style.right = '0'
  walletOverlay.classList.add('active')
}

function closeWalletMenu() {
  walletMenu.style.right = '-280px'
  walletOverlay.classList.remove('active')
}

function closeMarketModal() {
  marketModal.classList.remove('active')
  marketModalOverlay.classList.remove('active')
  selectedMatch = null
}

async function connectWallet() {
  try {
    const provider = getPhantomProvider()

    if (!provider) {
      alert('Phantom não encontrada. Instale a extensão ou abra no navegador da Phantom.')
      return
    }

    setConnectButtonText('Conectando...')

    const resp = await provider.connect()
    connectedAddress = resp.publicKey.toString()
    connectedPublicKey = new PublicKey(connectedAddress)
    walletConnected = true

    const shortAddress = `${connectedAddress.slice(0, 4)}...${connectedAddress.slice(-4)}`
    walletAddressText.textContent = shortAddress

    setConnectedUI()
    closeWalletMenu()
    await loadWalletTokenBalance()
  } catch (error) {
    console.error('Erro ao conectar Phantom:', error)
    walletConnected = false
    connectedAddress = ''
    connectedPublicKey = null
    setDisconnectedUI()
    alert('Não foi possível conectar a Phantom.')
  }
}

async function disconnectWallet() {
  try {
    const provider = getPhantomProvider()
    if (provider?.disconnect) {
      await provider.disconnect()
    }
  } catch (error) {
    console.warn('Aviso ao desconectar Phantom:', error)
  }

  walletConnected = false
  connectedAddress = ''
  connectedPublicKey = null

  setDisconnectedUI()
  walletAddressText.textContent = 'Não conectada'
  walletBalanceText.textContent = '0'

  closeWalletMenu()
}

async function loadWalletTokenBalance() {
  try {
    if (!connectedPublicKey) return

    const tokenProgram = await detectWalaTokenProgram()

    const userWalaAta = await getAssociatedTokenAddress(
      walaMintPubkey,
      connectedPublicKey,
      false,
      tokenProgram
    )

    const ataInfo = await connection.getAccountInfo(userWalaAta)

    if (!ataInfo) {
      updateWalletBalanceUI(0)
      return
    }

    const balance = await connection.getTokenAccountBalance(userWalaAta)
    const uiAmount = Number(balance?.value?.uiAmount || 0)

    updateWalletBalanceUI(uiAmount)
    console.log('Saldo token WALA:', uiAmount)
  } catch (error) {
    console.error('Erro ao carregar saldo do token WALA:', error)
    updateWalletBalanceUI(0)
  }
}

function createCard(match) {
  const card = document.createElement('div')
  card.className = 'match-card'

  const liveBadge =
    match.status === 'IN_PLAY' || match.status === 'PAUSED'
      ? '<span class="match-league">AO VIVO</span>'
      : ''

  const scoreHtml =
    match.scoreA !== null && match.scoreB !== null
      ? `<span class="match-time">${match.scoreA} x ${match.scoreB}</span>`
      : ''

  card.innerHTML = `
    <div class="match-top">
      <div class="match-info">
        <span class="match-league">${match.league}</span>
        ${liveBadge}
        <strong class="match-title">${match.teamA} vs ${match.teamB}</strong>
        <span class="match-time">${match.time}</span>
        ${scoreHtml}
      </div>

      <button class="trade open-market-btn" type="button">Abrir</button>
    </div>

    <div class="stats-grid">
      <div class="stat-box">
        <span class="stat-label">${match.teamA}</span>
        <strong class="stat-value">${match.probA}</strong>
      </div>

      <div class="stat-box">
        <span class="stat-label">Empate</span>
        <strong class="stat-value">${match.probDraw}</strong>
      </div>

      <div class="stat-box">
        <span class="stat-label">${match.teamB}</span>
        <strong class="stat-value">${match.probB}</strong>
      </div>
    </div>
  `

  card.querySelector('.open-market-btn').addEventListener('click', async () => {
    await openMarketModal(match)
  })

  return card
}

function renderMatches() {
  const term = searchInput.value.trim().toLowerCase()

  const filtered = matches.filter((match) => {
    const text = `${match.league} ${match.teamA} ${match.teamB}`.toLowerCase()
    return text.includes(term)
  })

  const featured = filtered.filter((match) => match.featured)
  const regular = filtered

  featuredGrid.innerHTML = ''
  marketGrid.innerHTML = ''

  featured.forEach((match) => featuredGrid.appendChild(createCard(match)))
  regular.forEach((match) => marketGrid.appendChild(createCard(match)))

  featuredCount.textContent = featured.length
  marketCount.textContent = regular.length

  featuredEmpty.classList.toggle('show', featured.length === 0)
  marketEmpty.classList.toggle('show', regular.length === 0)
}

menuBtn.addEventListener('click', openSidebar)
sidebarOverlay.addEventListener('click', closeSidebar)

connectBtn.addEventListener('click', () => {
  if (walletConnected) {
    openWalletMenu()
    return
  }

  connectWallet()
})

addBalanceAction.addEventListener('click', openAddBalance)
fundTreasuryAction.addEventListener('click', depositTreasuryOnChain)
disconnectAction.addEventListener('click', disconnectWallet)
walletOverlay.addEventListener('click', closeWalletMenu)

closeModalBtn.addEventListener('click', closeMarketModal)
marketModalOverlay.addEventListener('click', closeMarketModal)

forecastABtn.addEventListener('click', () => {
  setSelectedOutcome('HOME')
})

forecastDrawBtn.addEventListener('click', () => {
  setSelectedOutcome('DRAW')
})

forecastBBtn.addEventListener('click', () => {
  setSelectedOutcome('AWAY')
})

betAmountInput.addEventListener('input', updateBetPreview)

confirmBetBtn.addEventListener('click', () => {
  if (!selectedOutcome) {
    betHintText.textContent = 'Selecione Time A, Empate ou Time B.'
    return
  }

  buyPositionOnChain(selectedOutcome)
})

searchInput.addEventListener('input', renderMatches)

async function restoreWalletSession() {
  try {
    const provider = getPhantomProvider()
    if (!provider) return

    const resp = await provider.connect({ onlyIfTrusted: true })
    connectedAddress = resp.publicKey.toString()
    connectedPublicKey = new PublicKey(connectedAddress)
    walletConnected = true

    const shortAddress = `${connectedAddress.slice(0, 4)}...${connectedAddress.slice(-4)}`
    walletAddressText.textContent = shortAddress
    setConnectedUI()

    await loadWalletTokenBalance()
  } catch (error) {
    console.log('Sessão Phantom não restaurada.')
    setDisconnectedUI()
  }
}

async function initApp() {
  setDisconnectedUI()
  renderMatches()
  restoreWalletSession()

  try {
    const debugCompetition = await footballDataGet('/competitions/CL')
    console.log('Teste competição CL:', debugCompetition)

    await fetchRealMatches()
    renderMatches()
  } catch (error) {
    console.error('Erro ao carregar jogos reais:', error)
    featuredEmpty.textContent = `Erro ao carregar jogos reais: ${error.message || error}`
    marketEmpty.textContent = `Erro ao carregar jogos reais: ${error.message || error}`
    featuredEmpty.classList.add('show')
    marketEmpty.classList.add('show')
  }
}

initApp()