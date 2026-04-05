import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const PORT = process.env.PORT || 3000
const distPath = path.join(__dirname, 'dist')

app.use('/api/football-data/v4', async (req, res) => {
  try {
    const apiKey = process.env.FOOTBALL_DATA_TOKEN?.trim()

    if (!apiKey) {
      return res.status(500).json({
        error: 'FOOTBALL_DATA_TOKEN não configurado no servidor',
      })
    }

    const upstreamUrl = new URL(`https://api.football-data.org/v4${req.path}`)

    for (const [key, value] of Object.entries(req.query)) {
      if (Array.isArray(value)) {
        value.forEach((item) => upstreamUrl.searchParams.append(key, String(item)))
      } else if (value != null) {
        upstreamUrl.searchParams.append(key, String(value))
      }
    }

    const response = await fetch(upstreamUrl, {
      method: 'GET',
      headers: {
        'X-Auth-Token': apiKey,
        Accept: 'application/json',
      },
    })

    const text = await response.text()

    res.status(response.status)
    res.setHeader(
      'content-type',
      response.headers.get('content-type') || 'application/json'
    )
    res.setHeader('cache-control', 'public, max-age=60')
    res.send(text)
  } catch (error) {
    console.error('Erro no proxy football-data:', error)
    res.status(500).json({
      error: 'Erro interno no proxy football-data',
      details: String(error?.message || error),
    })
  }
})

app.use(express.static(distPath))

app.get('/', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'))
})

app.listen(PORT, () => {
  console.log(`Server rodando na porta ${PORT}`)
  console.log('FOOTBALL_DATA_TOKEN carregado:', !!process.env.FOOTBALL_DATA_TOKEN)
})