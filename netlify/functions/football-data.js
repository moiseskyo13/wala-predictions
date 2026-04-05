export default async (req) => {
  const apiKey = Netlify.env.get('FOOTBALL_DATA_TOKEN')

  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'FOOTBALL_DATA_TOKEN não configurado no Netlify' }),
      {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }
    )
  }

  const requestUrl = new URL(req.url)
  const prefix = '/api/football-data/v4'
  const rawPath = requestUrl.pathname.replace(prefix, '') || ''
  const upstreamUrl = new URL(`https://api.football-data.org/v4${rawPath}`)

  requestUrl.searchParams.forEach((value, key) => {
    upstreamUrl.searchParams.append(key, value)
  })

  const response = await fetch(upstreamUrl, {
    method: 'GET',
    headers: {
      'X-Auth-Token': apiKey,
    },
  })

  const text = await response.text()

  return new Response(text, {
    status: response.status,
    headers: {
      'content-type': response.headers.get('content-type') || 'application/json',
      'cache-control': 'public, max-age=60',
    },
  })
}

export const config = {
  path: ['/api/football-data/v4', '/api/football-data/v4/*'],
}