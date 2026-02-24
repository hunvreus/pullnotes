import { getInstallationToken } from '#/lib/github-app'
import { parseMarkdownEntry } from '#/lib/markdown'

type GitHubTreeItem = {
  path: string
  mode: string
  type: 'blob' | 'tree' | 'commit'
  sha: string
  size?: number
  url: string
}

type GitHubTreeResponse = {
  tree: GitHubTreeItem[]
  truncated: boolean
}

type GitHubContentResponse = {
  sha: string
  content: string
  encoding: 'base64'
}

type GitHubCommitResponse = Array<{
  sha: string
  commit: {
    message: string
    author: {
      name: string
      date: string
    } | null
  }
  author: {
    login: string
    avatar_url: string
  } | null
}>

export type RepoTarget = {
  owner: string
  repo: string
  branch: string
  rootPath: string
}

export type RepoTargetInput = {
  owner: string
  repo: string
  branch?: string
  rootPath?: string
}

export type RepoMarkdownEntry = {
  path: string
  sha: string
}

export type RepoMarkdownMetaEntry = {
  path: string
  sha: string
  title: string
  icon: string
  cover: string
}

function normalizeTarget(input: RepoTargetInput): RepoTarget {
  const owner = input.owner?.trim()
  const repo = input.repo?.trim()
  const branch = input.branch?.trim() || 'main'
  const rootPath = (input.rootPath ?? '').replace(/^\/+|\/+$/g, '')

  if (!owner || !repo) {
    throw new Error('Missing repository target. Set owner and repo.')
  }

  return {
    owner,
    repo,
    branch,
    rootPath,
  }
}

function joinWithRoot(rootPath: string, path: string): string {
  const cleanPath = path.replace(/^\/+/, '')
  if (!rootPath) return cleanPath
  if (!cleanPath) return rootPath
  return `${rootPath}/${cleanPath}`
}

function trimRoot(rootPath: string, path: string): string {
  if (!rootPath) return path
  return path.startsWith(`${rootPath}/`) ? path.slice(rootPath.length + 1) : path
}

async function githubRequest<T>(
  target: RepoTarget,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = `https://api.github.com${path}`
  const token = await getInstallationToken(target.owner, target.repo)
  return githubRequestWithToken<T>(url, token, init)
}

async function githubRequestWithToken<T>(
  url: string,
  token: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init?.headers ?? {}),
    },
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`GitHub API failed (${response.status}): ${text}`)
  }

  return (await response.json()) as T
}

async function githubGraphqlRequest<T>(
  target: RepoTarget,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const token = await getInstallationToken(target.owner, target.repo)
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({
      query,
      variables,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`GitHub GraphQL failed (${response.status}): ${text}`)
  }

  const payload = (await response.json()) as {
    data?: T
    errors?: Array<{ message: string }>
  }

  if (payload.errors?.length) {
    throw new Error(`GitHub GraphQL error: ${payload.errors.map((item) => item.message).join('; ')}`)
  }

  if (!payload.data) {
    throw new Error('GitHub GraphQL returned no data.')
  }

  return payload.data
}

type GraphqlBlobObject = {
  __typename: 'Blob'
  oid: string
  text: string | null
}

type GraphqlTreeObject = {
  __typename: 'Tree'
  oid: string
}

type GraphqlEntry = {
  name: string
  type: 'blob' | 'tree'
  object: GraphqlBlobObject | GraphqlTreeObject | null
}

type GraphqlTreeResult = {
  repository: {
    object: {
      __typename: 'Tree'
      entries: GraphqlEntry[]
    } | null
  } | null
}

const TREE_BY_EXPR_QUERY = `
query TreeByExpr($owner: String!, $repo: String!, $expr: String!) {
  repository(owner: $owner, name: $repo) {
    object(expression: $expr) {
      __typename
      ... on Tree {
        entries {
          name
          type
          object {
            __typename
            ... on Blob {
              oid
              text
            }
            ... on Tree {
              oid
            }
          }
        }
      }
    }
  }
}
`

const TREE_BY_OID_QUERY = `
query TreeByOid($owner: String!, $repo: String!, $oid: GitObjectID!) {
  repository(owner: $owner, name: $repo) {
    object(oid: $oid) {
      __typename
      ... on Tree {
        entries {
          name
          type
          object {
            __typename
            ... on Blob {
              oid
              text
            }
            ... on Tree {
              oid
            }
          }
        }
      }
    }
  }
}
`

async function fetchTreeEntriesByExpression(
  target: RepoTarget,
  expression: string,
): Promise<GraphqlEntry[]> {
  const data = await githubGraphqlRequest<GraphqlTreeResult>(
    target,
    TREE_BY_EXPR_QUERY,
    {
      owner: target.owner,
      repo: target.repo,
      expr: expression,
    },
  )

  if (!data.repository?.object || data.repository.object.__typename !== 'Tree') {
    return []
  }

  return data.repository.object.entries || []
}

async function fetchTreeEntriesByOid(
  target: RepoTarget,
  oid: string,
): Promise<GraphqlEntry[]> {
  const data = await githubGraphqlRequest<GraphqlTreeResult>(
    target,
    TREE_BY_OID_QUERY,
    {
      owner: target.owner,
      repo: target.repo,
      oid,
    },
  )

  if (!data.repository?.object || data.repository.object.__typename !== 'Tree') {
    return []
  }

  return data.repository.object.entries || []
}

export async function listMarkdownEntriesViaGraphql(
  input: RepoTargetInput,
): Promise<RepoMarkdownMetaEntry[]> {
  const target = normalizeTarget(input)
  const rootExpression = target.rootPath
    ? `${target.branch}:${target.rootPath}`
    : `${target.branch}:`

  const result: RepoMarkdownMetaEntry[] = []

  const walk = async (entries: GraphqlEntry[], prefix: string) => {
    for (const entry of entries) {
      const nextPath = `${prefix}${entry.name}`

      if (entry.type === 'blob') {
        if (!nextPath.endsWith('.md')) continue
        if (!entry.object || entry.object.__typename !== 'Blob') continue

        const content = entry.object.text || ''
        const parsed = parseMarkdownEntry(content)
        result.push({
          path: nextPath,
          sha: entry.object.oid,
          title: parsed.title,
          icon: parsed.icon,
          cover: parsed.cover,
        })
        continue
      }

      if (!entry.object || entry.object.__typename !== 'Tree') continue
      const subtree = await fetchTreeEntriesByOid(target, entry.object.oid)
      await walk(subtree, `${nextPath}/`)
    }
  }

  try {
    const rootEntries = await fetchTreeEntriesByExpression(target, rootExpression)
    await walk(rootEntries, '')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (
      (message.includes('GitHub GraphQL failed (404)') ||
        message.includes('GitHub GraphQL error')) &&
      message.toLowerCase().includes('not found')
    ) {
      return []
    }
    if (
      message.includes('GitHub GraphQL error') &&
      message.toLowerCase().includes('empty')
    ) {
      return []
    }
    throw error
  }

  return result.sort((a, b) => a.path.localeCompare(b.path))
}

export async function listMarkdownFiles(input: RepoTargetInput): Promise<RepoMarkdownEntry[]> {
  const target = normalizeTarget(input)
  let tree: GitHubTreeResponse
  try {
    tree = await githubRequest<GitHubTreeResponse>(
      target,
      `/repos/${target.owner}/${target.repo}/git/trees/${encodeURIComponent(target.branch)}?recursive=1`,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (
      message.includes('GitHub API failed (409)') &&
      message.toLowerCase().includes('git repository is empty')
    ) {
      return []
    }
    throw error
  }

  if (tree.truncated) {
    throw new Error('Repository tree is truncated by GitHub API. Reduce root path scope.')
  }

  return tree.tree
    .filter((item) => item.type === 'blob' && item.path.endsWith('.md'))
    .filter((item) =>
      target.rootPath ? item.path.startsWith(`${target.rootPath}/`) : true,
    )
    .map((item) => ({
      path: trimRoot(target.rootPath, item.path),
      sha: item.sha,
    }))
    .sort((a, b) => a.path.localeCompare(b.path))
}

export async function getMarkdownFile(
  input: RepoTargetInput,
  path: string,
): Promise<{
  content: string
  sha: string
}> {
  const target = normalizeTarget(input)
  const fullPath = joinWithRoot(target.rootPath, path)

  const response = await githubRequest<GitHubContentResponse>(
    target,
    `/repos/${target.owner}/${target.repo}/contents/${encodeURIComponent(fullPath)}?ref=${encodeURIComponent(target.branch)}`,
  )

  const content = Buffer.from(response.content, 'base64').toString('utf8')

  return {
    content,
    sha: response.sha,
  }
}

export async function upsertMarkdownFile(
  targetInput: RepoTargetInput,
  input: {
    path: string
    content: string
    message: string
    sha?: string
  },
  options?: {
    userToken?: string
  },
): Promise<{ sha: string }> {
  const target = normalizeTarget(targetInput)
  const fullPath = joinWithRoot(target.rootPath, input.path)
  const url = `https://api.github.com/repos/${target.owner}/${target.repo}/contents/${encodeURIComponent(fullPath)}`

  const payload = {
    message: input.message,
    content: Buffer.from(input.content, 'utf8').toString('base64'),
    branch: target.branch,
    sha: input.sha,
  }

  const response = options?.userToken
    ? await (async () => {
        // Enforce app installation scope even when writing as a user.
        await getInstallationToken(target.owner, target.repo)
        return githubRequestWithToken<{ content: { sha: string } }>(url, options.userToken, {
          method: 'PUT',
          body: JSON.stringify(payload),
        })
      })()
    : await githubRequest<{ content: { sha: string } }>(
        target,
        `/repos/${target.owner}/${target.repo}/contents/${encodeURIComponent(fullPath)}`,
        {
          method: 'PUT',
          body: JSON.stringify(payload),
        },
      )

  return { sha: response.content.sha }
}

export async function deleteMarkdownFile(
  targetInput: RepoTargetInput,
  input: {
    path: string
    message: string
    sha: string
  },
  options?: {
    userToken?: string
  },
): Promise<void> {
  const target = normalizeTarget(targetInput)
  const fullPath = joinWithRoot(target.rootPath, input.path)
  const url = `https://api.github.com/repos/${target.owner}/${target.repo}/contents/${encodeURIComponent(fullPath)}`
  const body = JSON.stringify({
    message: input.message,
    sha: input.sha,
    branch: target.branch,
  })

  if (options?.userToken) {
    // Enforce app installation scope even when deleting as a user.
    await getInstallationToken(target.owner, target.repo)
    await githubRequestWithToken<unknown>(url, options.userToken, {
      method: 'DELETE',
      body,
    })
    return
  }

  await githubRequest<unknown>(target, `/repos/${target.owner}/${target.repo}/contents/${encodeURIComponent(fullPath)}`, {
    method: 'DELETE',
    body,
  })
}

export async function getLatestCommit(input: RepoTargetInput): Promise<{
  sha: string
  message: string
  authorName: string
  authorAvatarUrl: string | null
  date: string | null
} | null> {
  const target = normalizeTarget(input)

  try {
    const commits = await githubRequest<GitHubCommitResponse>(
      target,
      `/repos/${target.owner}/${target.repo}/commits?sha=${encodeURIComponent(target.branch)}&per_page=1`,
    )

    const latest = commits[0]
    if (!latest) return null

    return {
      sha: latest.sha,
      message: latest.commit.message,
      authorName: latest.author?.login || latest.commit.author?.name || 'Unknown',
      authorAvatarUrl: latest.author?.avatar_url || null,
      date: latest.commit.author?.date || null,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (
      message.includes('GitHub API failed (409)') &&
      message.toLowerCase().includes('git repository is empty')
    ) {
      return null
    }
    throw error
  }
}

export async function listRecentCommits(input: RepoTargetInput): Promise<
  Array<{
    sha: string
    message: string
    authorName: string
    authorAvatarUrl: string | null
    date: string | null
  }>
> {
  const target = normalizeTarget(input)

  try {
    const commits = await githubRequest<GitHubCommitResponse>(
      target,
      `/repos/${target.owner}/${target.repo}/commits?sha=${encodeURIComponent(target.branch)}&per_page=5`,
    )

    return commits.map((commit) => ({
      sha: commit.sha,
      message: commit.commit.message,
      authorName: commit.author?.login || commit.commit.author?.name || 'Unknown',
      authorAvatarUrl: commit.author?.avatar_url || null,
      date: commit.commit.author?.date || null,
    }))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (
      message.includes('GitHub API failed (409)') &&
      message.toLowerCase().includes('git repository is empty')
    ) {
      return []
    }
    throw error
  }
}
