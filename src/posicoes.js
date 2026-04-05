import './posicoes.css'
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
const ADMIN_WALLET = '8no5SbdExQeUP6sULmvxuaUtbfrwXe41xDQftCNYbbgv'
const FOOTBALL_DATA_TOKEN = '8ed2c55323794e458eb6d4c7f97174fd'
const FOOTBALL_DATA_BASE = '/api/football-data/v4'

const connection = new Connection(MAINNET_RPC, 'confirmed')
const walaMintPubkey = new PublicKey(WALA_TOKEN_MINT)
const programId = new PublicKey(WALA_PREDICTS_PROGRAM_ID)

const POSITION_ACCOUNT_SIZE = 99
const POSITION_USER_OFFSET = 40

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
    '[WALA TOKEN PROGRAM / POSICOES]',
    walaTokenProgramId.equals(TOKEN_2022_PROGRAM_ID)
      ? 'TOKEN_2022_PROGRAM_ID'
      : 'TOKEN_PROGRAM_ID',
    walaTokenProgramId.toBase58()
  )

  return walaTokenProgramId
}

let walletConnected = false
let connectedAddress = ''
let connectedPublicKey = null
let currentPositions = []

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
      <a href="javascript:void(0)" id="refreshAction">Atualizar posições</a>
      <a href="javascript:void(0)" id="disconnectAction" style="display:none;">Desconectar Wallet</a>
    </div>

    <div id="sidebar" class="side-menu">
<a href="/index.html">Predictions</a>
<a href="https://walat.netlify.app/market">Buy Wala</a>
<a href="/posicoes.html">Minhas Posições</a>
    </div>

    <div class="card">
      <h1 class="title"><span class="wala-color">WALA</span> Minhas Posições</h1>
      <p class="wallet-subtitle">
        Veja suas apostas, status do mercado e resgate quando vencer.
      </p>
    </div>

    <div class="card">
      <div class="section-head">
        <h3>Resumo</h3>
        <span class="section-count" id="summaryCount">0</span>
      </div>

      <div class="summary-grid">
        <div class="summary-box">
          <span class="summary-label">Wallet</span>
          <strong id="walletAddressText" class="summary-value">Não conectada</strong>
        </div>

        <div class="summary-box">
          <span class="summary-label">Saldo WALA</span>
          <strong id="walletBalanceText" class="summary-value">0</strong>
        </div>

        <div class="summary-box">
          <span class="summary-label">Posições</span>
          <strong id="totalPositionsText" class="summary-value">0</strong>
        </div>

        <div class="summary-box">
          <span class="summary-label">Prontas para resgatar</span>
          <strong id="claimablePositionsText" class="summary-value">0</strong>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="section-head">
        <h3>Minhas apostas</h3>
        <span class="section-count" id="positionsCount">0</span>
      </div>

      <div id="positionsGrid" class="positions-grid"></div>

      <div id="positionsEmpty" class="empty-state show">
        Conecte sua wallet para ver suas posições.
      </div>
    </div>
  </div>

  <div id="claimNoticeOverlay" class="overlay"></div>

  <div id="claimNoticeModal" class="custom-modal">
    <div class="card modal-card notice-modal-card">
      <div class="modal-header">
        <h3 id="claimNoticeTitle">Aviso</h3>
        <button class="modal-close" id="closeClaimNoticeBtn" type="button">✕</button>
      </div>

      <div class="notice-modal-body">
        <p id="claimNoticeText" class="notice-modal-text">
          Mensagem do sistema
        </p>
      </div>

      <div class="notice-modal-footer">
        <button id="claimNoticeConfirmBtn" class="notice-confirm-btn" type="button">
  Entendi
</button>
      </div>
    </div>
  </div>
`

const sidebar = document.getElementById('sidebar')
const walletMenu = document.getElementById('walletMenu')
const sidebarOverlay = document.getElementById('sidebarOverlay')
const walletOverlay = document.getElementById('walletOverlay')
const menuBtn = document.getElementById('menuBtn')
const connectBtn = document.getElementById('connectBtn')
const refreshAction = document.getElementById('refreshAction')
const disconnectAction = document.getElementById('disconnectAction')

const walletAddressText = document.getElementById('walletAddressText')
const walletBalanceText = document.getElementById('walletBalanceText')
const summaryCount = document.getElementById('summaryCount')
const totalPositionsText = document.getElementById('totalPositionsText')
const claimablePositionsText = document.getElementById('claimablePositionsText')
const positionsCount = document.getElementById('positionsCount')
const positionsGrid = document.getElementById('positionsGrid')
const positionsEmpty = document.getElementById('positionsEmpty')

const claimNoticeOverlay = document.getElementById('claimNoticeOverlay')
const claimNoticeModal = document.getElementById('claimNoticeModal')
const claimNoticeTitle = document.getElementById('claimNoticeTitle')
const claimNoticeText = document.getElementById('claimNoticeText')
const closeClaimNoticeBtn = document.getElementById('closeClaimNoticeBtn')
const claimNoticeConfirmBtn = document.getElementById('claimNoticeConfirmBtn')

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

function openClaimNoticeModal(title, message) {
  claimNoticeTitle.textContent = title || 'Aviso'
  claimNoticeText.textContent = message || 'Mensagem não informada.'
  claimNoticeModal.classList.add('active')
  claimNoticeOverlay.classList.add('active')
}

function closeClaimNoticeModal() {
  claimNoticeModal.classList.remove('active')
  claimNoticeOverlay.classList.remove('active')
}

function setConnectButtonText(text) {
  connectBtn.textContent = text
}

function setConnectedUI() {
  disconnectAction.style.display = 'block'
}

function setDisconnectedUI() {
  disconnectAction.style.display = 'none'
  setConnectButtonText('Conectar Wallet')
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

function deriveVaultPda(marketPda) {
  return PublicKey.findProgramAddressSync(
    [new TextEncoder().encode('vault'), marketPda.toBuffer()],
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

function compactAddress(address) {
  if (!address) return 'Não conectada'
  return `${address.slice(0, 4)}...${address.slice(-4)}`
}

function outcomeText(outcome, market) {
  if (outcome?.home) return market?.teamA || 'Time A'
  if (outcome?.draw) return 'Empate'
  if (outcome?.away) return market?.teamB || 'Time B'
  return '-'
}

function statusMeta(market, position) {
  const claimed = !!position?.claimed

  if (market?.status?.resolved) {
    const won =
      !claimed &&
      (
        (position?.outcome?.home && market?.winningOutcome?.home) ||
        (position?.outcome?.draw && market?.winningOutcome?.draw) ||
        (position?.outcome?.away && market?.winningOutcome?.away)
      )

    if (claimed) {
      return { label: 'RESGATADO', className: 'status-resolved' }
    }

    if (won) {
      return { label: 'GANHOU', className: 'status-won' }
    }

    return { label: 'PERDEU', className: 'status-lost' }
  }

  if (market?.status?.closed) {
    return { label: 'FECHADO', className: 'status-closed' }
  }

  return { label: 'ABERTO', className: 'status-open' }
}

function canClaimPosition(position, market) {
  if (!position || !market) return false
  if (position.claimed) return false
  if (!market.status?.resolved) return false

  if (position.outcome?.home && market.winningOutcome?.home) return true
  if (position.outcome?.draw && market.winningOutcome?.draw) return true
  if (position.outcome?.away && market.winningOutcome?.away) return true

  return false
}

function formatMarketStatusText(market) {
  if (market?.status?.resolved) return 'Mercado resolvido'
  if (market?.status?.closed) return 'Mercado fechado'
  if (market?.status?.open) return 'Mercado aberto'
  return '-'
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

function getFixtureIdFromMarket(market) {
  if (!market?.fixtureId) return null

  if (typeof market.fixtureId?.toString === 'function') {
    const parsed = Number(market.fixtureId.toString())
    return Number.isFinite(parsed) ? parsed : null
  }

  const parsed = Number(market.fixtureId)
  return Number.isFinite(parsed) ? parsed : null
}

function isMatchFinishedStatus(status) {
  return status === 'FINISHED'
}

function isMatchStillLockedForClaim(status) {
  return status === 'SCHEDULED'
    || status === 'TIMED'
    || status === 'IN_PLAY'
    || status === 'PAUSED'
  }

async function fetchMatchStatusByFixtureId(fixtureId) {
  if (!fixtureId) {
    throw new Error('fixtureId não encontrado no market.')
  }

  const data = await footballDataGet(`/matches/${fixtureId}`)
  return data?.status || null
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
      walletBalanceText.textContent = '0'
      return
    }

    const balance = await connection.getTokenAccountBalance(userWalaAta)
    const uiAmount = Number(balance?.value?.uiAmount || 0)

    walletBalanceText.textContent = Number(uiAmount).toLocaleString('pt-BR', {
      maximumFractionDigits: 6,
    })

    if (walletConnected) {
      setConnectButtonText(`${formatUiNumber(uiAmount)} WALA`)
    }
  } catch (error) {
    console.error('Erro ao carregar saldo WALA:', error)
    walletBalanceText.textContent = '0'
  }
}

async function claimPositionDirect(positionItem) {
  if (!walletConnected || !connectedPublicKey) {
    alert('Conecte a wallet antes de resgatar.')
    return
  }

  const button = document.getElementById(`claim-btn-${positionItem.positionAddress}`)
  const originalText = button?.textContent || 'Resgatar'

  try {
    if (positionItem?.position?.claimed) {
      openClaimNoticeModal('Posição já resgatada', 'Essa posição já foi resgatada.')
      return
    }

    if (button) {
      button.disabled = true
      button.textContent = 'Verificando jogo...'
    }

    const fixtureId = getFixtureIdFromMarket(positionItem.market)
    const matchStatus = await fetchMatchStatusByFixtureId(fixtureId)

    console.log('match status for claim:', fixtureId, matchStatus)

    if (isMatchStillLockedForClaim(matchStatus)) {
      openClaimNoticeModal(
        'Resgate indisponível',
        'Jogo ainda não finalizado. Só é possível resgatar após o término da partida.'
      )
      return
    }

    if (!isMatchFinishedStatus(matchStatus)) {
      openClaimNoticeModal(
        'Partida indisponível',
        `Partida ainda indisponível para resgate. Status atual: ${matchStatus || 'desconhecido'}`
      )
      return
    }

    if (!positionItem.market?.status?.resolved) {
      alert('A partida terminou, mas o mercado ainda não foi resolvido on-chain. Aguarde a resolução.')
      return
    }

    if (!canClaimPosition(positionItem.position, positionItem.market)) {
      if (
        positionItem.market?.winningOutcome &&
        !positionItem.position?.claimed
      ) {
        openClaimNoticeModal(
          'Posição não vencedora',
          'Sua posição não é vencedora neste mercado.'
        )
        return
      }

      openClaimNoticeModal(
        'Resgate indisponível',
        'Essa posição ainda não pode ser resgatada.'
      )
      return
    }

    const provider = getAnchorProvider()
    const program = getProgram(provider)

    const marketPda = new PublicKey(positionItem.marketAddress)
    const positionPda = new PublicKey(positionItem.positionAddress)
    const [vaultPda] = deriveVaultPda(marketPda)
    const [treasuryPda] = deriveTreasuryPda()
    const [treasuryVaultPda] = deriveTreasuryVaultPda(treasuryPda)

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

    if (button) {
      button.disabled = true
      button.textContent = 'Resgatando...'
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
      })
      .preInstructions(preInstructions)
      .rpc()

    alert(`Resgate concluído.\nHash: ${signature}`)
    await loadWalletTokenBalance()
    await loadPositions()
  } catch (error) {
    console.error('Erro ao resgatar posição:', error)
    alert(error?.message || 'Erro ao resgatar posição.')
    await loadPositions()
  } finally {
    if (button) {
      button.disabled = false
      button.textContent = originalText
    }
  }
}

function createPositionCard(item) {
  const card = document.createElement('div')
  card.className = 'position-card'

  const status = statusMeta(item.market, item.position)
  const canClaim = canClaimPosition(item.position, item.market)
  const canClickClaim = !item.position?.claimed
  const claimedAmountUi = Number(rawToUiText(item.position.claimedAmount || 0))
  const amountUi = Number(rawToUiText(item.position.amount || 0))
  const chosenSide = outcomeText(item.position.outcome, item.market)
  const winningSide = item.market?.winningOutcome
    ? outcomeText(item.market.winningOutcome, item.market)
    : '-'

  const scoreText = '-'
  card.innerHTML = `
    <div class="position-top">
      <div class="position-info">
        <span class="position-league">${item.market.league || 'Competição'}</span>
        <strong class="position-title">${item.market.teamA} vs ${item.market.teamB}</strong>
        <span class="position-time">${item.displayTime}</span>
      </div>

      <span class="status-chip ${status.className}">${status.label}</span>
    </div>

    <div class="position-grid">
      <div class="position-box">
        <span class="position-box-label">Sua previsão</span>
        <strong class="position-box-value">${chosenSide}</strong>
      </div>

      <div class="position-box">
        <span class="position-box-label">Valor apostado</span>
        <strong class="position-box-value">${formatUiNumber(amountUi)} WALA</strong>
      </div>

      <div class="position-box">
        <span class="position-box-label">Resultado</span>
<strong class="position-box-value">${winningSide}</strong>
      </div>

      <div class="position-box">
        <span class="position-box-label">Status</span>
<strong class="position-box-value">${item.displayTime}</strong>
      </div>
    </div>

    <div class="position-actions">
      <button
        id="claim-btn-${item.positionAddress}"
        class="claim-btn"
        type="button"
        ${canClickClaim ? '' : 'disabled'}
      >
        ${item.position.claimed ? 'Já resgatado' : 'Resgatar'}
      </button>

      <button class="outline-btn" type="button" disabled>
        Pago: ${formatUiNumber(claimedAmountUi)} WALA
      </button>
    </div>
  `

  const claimBtn = card.querySelector(`#claim-btn-${item.positionAddress}`)
  if (claimBtn && canClickClaim) {
    claimBtn.addEventListener('click', () => claimPositionDirect(item))
  }

  return card
}

async function loadPositions() {
  positionsGrid.innerHTML = ''
  positionsEmpty.classList.remove('show')
  currentPositions = []

  if (!walletConnected || !connectedPublicKey) {
    summaryCount.textContent = '0'
    positionsCount.textContent = '0'
    totalPositionsText.textContent = '0'
    claimablePositionsText.textContent = '0'
    positionsEmpty.textContent = 'Conecte sua wallet para ver suas posições.'
    positionsEmpty.classList.add('show')
    return
  }

  try {
    positionsEmpty.textContent = 'Carregando posições...'
    positionsEmpty.classList.add('show')

    const program = getProgram()

const rawPositionAccounts = await connection.getProgramAccounts(programId, {
  filters: [
    { dataSize: POSITION_ACCOUNT_SIZE },
    {
      memcmp: {
        offset: POSITION_USER_OFFSET,
        bytes: connectedPublicKey.toBase58(),
      },
    },
  ],
})

const myPositions = await Promise.all(
  rawPositionAccounts.map(async (item) => ({
    publicKey: item.pubkey,
    account: await program.account.positionAccount.fetch(item.pubkey),
  }))
)

    const marketCache = new Map()
    const enriched = []

    for (const positionItem of myPositions) {
      const marketAddress = positionItem.account.market.toBase58()

      let market = marketCache.get(marketAddress)
      if (!market) {
        market = await program.account.marketAccount.fetch(positionItem.account.market)
        marketCache.set(marketAddress, market)
      }

      enriched.push({
  positionAddress: positionItem.publicKey.toBase58(),
  marketAddress,
  position: positionItem.account,
  market,
  matchData: null,
  displayTime: formatMarketStatusText(market),
})
    }

    enriched.sort((a, b) => {
      if (canClaimPosition(a.position, a.market) && !canClaimPosition(b.position, b.market)) return -1
      if (!canClaimPosition(a.position, a.market) && canClaimPosition(b.position, b.market)) return 1

      const aResolved = !!a.market?.status?.resolved
      const bResolved = !!b.market?.status?.resolved
      if (aResolved && !bResolved) return -1
      if (!aResolved && bResolved) return 1

      return Number(b.market.createdAt || 0) - Number(a.market.createdAt || 0)
    })

    currentPositions = enriched

    const claimableCount = enriched.filter((item) => canClaimPosition(item.position, item.market)).length

    summaryCount.textContent = String(enriched.length)
    positionsCount.textContent = String(enriched.length)
    totalPositionsText.textContent = String(enriched.length)
    claimablePositionsText.textContent = String(claimableCount)

    if (enriched.length === 0) {
      positionsEmpty.textContent = 'Nenhuma posição encontrada para esta wallet.'
      positionsEmpty.classList.add('show')
      return
    }

    positionsEmpty.classList.remove('show')
    enriched.forEach((item) => positionsGrid.appendChild(createPositionCard(item)))
  } catch (error) {
    console.error('Erro ao carregar posições:', error)
    positionsGrid.innerHTML = ''
    positionsEmpty.textContent = `Erro ao carregar posições: ${error?.message || error}`
    positionsEmpty.classList.add('show')
  }
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

    walletAddressText.textContent = compactAddress(connectedAddress)
    setConnectedUI()
    closeWalletMenu()

    await loadWalletTokenBalance()
    await loadPositions()
  } catch (error) {
    console.error('Erro ao conectar Phantom:', error)
    walletConnected = false
    connectedAddress = ''
    connectedPublicKey = null
    setDisconnectedUI()
    walletAddressText.textContent = 'Não conectada'
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
  currentPositions = []

  walletAddressText.textContent = 'Não conectada'
  walletBalanceText.textContent = '0'
  setDisconnectedUI()
  closeWalletMenu()
  await loadPositions()
}

async function restoreWalletSession() {
  try {
    const provider = getPhantomProvider()
    if (!provider) return

    const resp = await provider.connect({ onlyIfTrusted: true })
    connectedAddress = resp.publicKey.toString()
    connectedPublicKey = new PublicKey(connectedAddress)
    walletConnected = true

    walletAddressText.textContent = compactAddress(connectedAddress)
    setConnectedUI()

    await loadWalletTokenBalance()
    await loadPositions()
  } catch {
    setDisconnectedUI()
  }
}

menuBtn.addEventListener('click', openSidebar)
sidebarOverlay.addEventListener('click', closeSidebar)
walletOverlay.addEventListener('click', closeWalletMenu)

connectBtn.addEventListener('click', () => {
  if (walletConnected) {
    openWalletMenu()
    return
  }

  connectWallet()
})

refreshAction.addEventListener('click', async () => {
  closeWalletMenu()
  await loadWalletTokenBalance()
  await loadPositions()
})

disconnectAction.addEventListener('click', disconnectWallet)

closeClaimNoticeBtn.addEventListener('click', closeClaimNoticeModal)
claimNoticeConfirmBtn.addEventListener('click', closeClaimNoticeModal)
claimNoticeOverlay.addEventListener('click', closeClaimNoticeModal)

async function initApp() {
  setDisconnectedUI()
  await loadPositions()
  await restoreWalletSession()
}

initApp()