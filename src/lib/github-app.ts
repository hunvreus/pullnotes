import { App } from '@octokit/app'

type CachedInstallationToken = {
  expiresAt: number
  token: string
}

const installationTokenCache = new Map<string, CachedInstallationToken>()

type OwnerKind = 'User' | 'Organization'

function getGitHubApp() {
  const appId = process.env.GITHUB_APP_ID
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, '\n')

  if (!appId || !privateKey) {
    throw new Error('Missing GitHub App config. Set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY.')
  }

  return new App({
    appId,
    privateKey,
  })
}

export function getGitHubAppInstallUrl(): string | null {
  const appName = process.env.GITHUB_APP_NAME
  return appName ? `https://github.com/apps/${appName}/installations/select_target` : null
}

export async function getOwnerInstallationId(
  owner: string,
  ownerKind: OwnerKind,
): Promise<number | null> {
  const app = getGitHubApp()

  try {
    if (ownerKind === 'Organization') {
      const installation = await app.octokit.request('GET /orgs/{org}/installation', {
        org: owner,
      })
      return installation.data.id
    }

    const installation = await app.octokit.request('GET /users/{username}/installation', {
      username: owner,
    })
    return installation.data.id
  } catch (error) {
    const status = (error as { status?: number })?.status
    if (status === 404) {
      return null
    }
    throw error
  }
}

export async function listInstallationRepos(installationId: number): Promise<
  Array<{
    id: number
    name: string
    fullName: string
    defaultBranch: string
  }>
> {
  const app = getGitHubApp()
  const response = await app.octokit.request(
    'GET /app/installations/{installation_id}/repositories',
    {
      installation_id: installationId,
      per_page: 100,
    },
  )

  return response.data.repositories.map((repo) => ({
    id: repo.id,
    name: repo.name,
    fullName: repo.full_name,
    defaultBranch: repo.default_branch,
  }))
}

export async function searchInstallationRepos(input: {
  installationId: number
  owner: string
  query: string
  limit?: number
}): Promise<
  Array<{
    id: number
    name: string
    fullName: string
    defaultBranch: string
    private: boolean
    updatedAt: string
  }>
> {
  const app = getGitHubApp()
  const installationOctokit = await app.getInstallationOctokit(input.installationId)
  const limit = Math.max(1, Math.min(input.limit ?? 10, 10))
  const query = input.query.trim()

  if (!query) {
    const fallback = await installationOctokit.request('GET /installation/repositories', {
      per_page: limit,
    })

    return fallback.data.repositories.map((repo) => ({
      id: repo.id,
      name: repo.name,
      fullName: repo.full_name,
      defaultBranch: repo.default_branch,
      private: repo.private,
      updatedAt: repo.updated_at,
    }))
  }

  const response = await installationOctokit.request('GET /search/repositories', {
    q: `${query} user:${input.owner}`,
    per_page: 100,
    sort: 'updated',
    order: 'desc',
  })

  return response.data.items.slice(0, limit).map((repo) => ({
    id: repo.id,
    name: repo.name,
    fullName: repo.full_name,
    defaultBranch: repo.default_branch,
    private: repo.private,
    updatedAt: repo.updated_at,
  }))
}

export async function getInstallationToken(owner: string, repo: string): Promise<string> {
  const cacheKey = `${owner}/${repo}`.toLowerCase()
  const cached = installationTokenCache.get(cacheKey)

  if (cached && Date.now() < cached.expiresAt - 60_000) {
    return cached.token
  }

  const app = getGitHubApp()
  const installation = await app.octokit.request('GET /repos/{owner}/{repo}/installation', {
    owner,
    repo,
  })
  const installationId = installation.data.id

  const tokenResponse = await app.octokit.request(
    'POST /app/installations/{installation_id}/access_tokens',
    {
      installation_id: installationId,
    },
  )

  const token = tokenResponse.data.token
  const expiresAt = new Date(tokenResponse.data.expires_at).getTime()

  installationTokenCache.set(cacheKey, {
    token,
    expiresAt,
  })

  return token
}
