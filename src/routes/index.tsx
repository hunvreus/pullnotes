import { createFileRoute } from '@tanstack/react-router'
import { createServerFn, useServerFn } from '@tanstack/react-start'
import { Check, ChevronDown, Loader2, LogIn, RefreshCw, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { authClient } from '#/lib/auth-client'
import {
  getGitHubAppInstallUrl,
  getOwnerInstallationId,
  searchInstallationRepos,
} from '#/lib/github-app'
import { requireGitHubAccessToken, requireSession } from '#/lib/session'

type OwnerItem = {
  id: number
  login: string
  type: 'User' | 'Organization'
  installationId: number | null
}

type RepoItem = {
  id: number
  name: string
  fullName: string
  defaultBranch: string
}

type RouteSearch = {
  owner?: string
  repo?: string
  branch?: string
}

const onboardingOwnersServerFn = createServerFn({ method: 'GET' }).handler(async () => {
  const accessToken = await requireGitHubAccessToken()

  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${accessToken}`,
    'X-GitHub-Api-Version': '2022-11-28',
  }

  const [viewerResponse, orgsResponse] = await Promise.all([
    fetch('https://api.github.com/user', { headers }),
    fetch('https://api.github.com/user/orgs?per_page=100', { headers }),
  ])

  if (!viewerResponse.ok) {
    throw new Error(`Failed to load GitHub user (${viewerResponse.status}).`)
  }

  if (!orgsResponse.ok) {
    throw new Error(`Failed to load GitHub orgs (${orgsResponse.status}).`)
  }

  const viewer = (await viewerResponse.json()) as { id: number; login: string }
  const orgs = (await orgsResponse.json()) as Array<{ id: number; login: string }>

  const rawOwners: Array<{ id: number; login: string; type: 'User' | 'Organization' }> = [
    { id: viewer.id, login: viewer.login, type: 'User' },
    ...orgs.map((org) => ({ id: org.id, login: org.login, type: 'Organization' as const })),
  ]

  const owners = await Promise.all(
    rawOwners.map(async (owner) => ({
      ...owner,
      installationId: await getOwnerInstallationId(owner.login, owner.type),
    })),
  )

  return {
    viewerLogin: viewer.login,
    owners,
    installUrl: getGitHubAppInstallUrl(),
  }
})

const searchReposServerFn = createServerFn({ method: 'GET' })
  .inputValidator((input: { owner: string; ownerType: 'User' | 'Organization'; query: string }) => input)
  .handler(async ({ data }) => {
    await requireSession()

    const installationId = await getOwnerInstallationId(data.owner, data.ownerType)

    if (!installationId) {
      return {
        installationId: null,
        repos: [] as RepoItem[],
      }
    }

    const repos = await searchInstallationRepos({
      installationId,
      owner: data.owner,
      query: data.query,
      limit: 10,
    })

    return {
      installationId,
      repos,
    }
  })

export const Route = createFileRoute('/')({
  validateSearch: (search): RouteSearch => {
    const raw = search as Record<string, unknown>

    return {
      owner: typeof raw.owner === 'string' ? raw.owner : undefined,
      repo: typeof raw.repo === 'string' ? raw.repo : undefined,
      branch: typeof raw.branch === 'string' ? raw.branch : undefined,
    }
  },
  component: SelectorPage,
})

function SelectorPage() {
  const routeSearch = Route.useSearch()
  const navigate = Route.useNavigate()
  const getOwners = useServerFn(onboardingOwnersServerFn)
  const searchRepos = useServerFn(searchReposServerFn)
  const { data: authSession, isPending: authPending } = authClient.useSession()

  const [owners, setOwners] = useState<OwnerItem[]>([])
  const [viewerLogin, setViewerLogin] = useState('')
  const [installUrl, setInstallUrl] = useState<string | null>(null)
  const [selectedOwner, setSelectedOwner] = useState('')
  const [repoQuery, setRepoQuery] = useState('')
  const [repos, setRepos] = useState<RepoItem[]>([])
  const [isLoadingOwners, setIsLoadingOwners] = useState(false)
  const [isLoadingRepos, setIsLoadingRepos] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [ownerMenuOpen, setOwnerMenuOpen] = useState(false)

  const isAuthenticated = Boolean(authSession?.user)
  const selectedOwnerItem = owners.find((item) => item.login === selectedOwner) ?? null

  const viewerOwner = useMemo(
    () => owners.find((item) => item.type === 'User' && item.login === viewerLogin) ?? null,
    [owners, viewerLogin],
  )

  const selectedOwnerInstallUrl = useMemo(() => {
    if (!installUrl) return null
    if (!selectedOwnerItem) return installUrl
    const separator = installUrl.includes('?') ? '&' : '?'
    const targetType = selectedOwnerItem.type === 'Organization' ? 'Organization' : 'User'
    return `${installUrl}${separator}target_id=${selectedOwnerItem.id}&target_type=${targetType}`
  }, [installUrl, selectedOwnerItem])

  useEffect(() => {
    const owner = routeSearch.owner?.trim()
    const repo = routeSearch.repo?.trim()
    const branch = routeSearch.branch?.trim()

    if (!owner || !repo || !branch) return

    void navigate({
      to: '/$owner/$repo/$branch',
      params: { owner, repo, branch },
      replace: true,
    })
  }, [navigate, routeSearch.branch, routeSearch.owner, routeSearch.repo])

  const refreshOwners = async () => {
    setIsLoadingOwners(true)

    try {
      const data = await getOwners()
      setOwners(data.owners)
      setViewerLogin(data.viewerLogin)
      setInstallUrl(data.installUrl)

      const fallback = data.owners.find((item) => item.installationId !== null) ?? data.owners[0]
      setSelectedOwner((current) => {
        if (current && data.owners.some((item) => item.login === current)) return current
        return fallback?.login || ''
      })
    } catch (error) {
      setErrorMessage(errorToMessage(error))
    } finally {
      setIsLoadingOwners(false)
    }
  }

  useEffect(() => {
    if (!isAuthenticated) {
      setOwners([])
      setViewerLogin('')
      setInstallUrl(null)
      setSelectedOwner('')
      setRepos([])
      return
    }

    void refreshOwners()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated])

  useEffect(() => {
    if (!isAuthenticated || !selectedOwnerItem || !selectedOwnerItem.installationId) {
      setRepos([])
      return
    }

    const timeout = setTimeout(() => {
      void (async () => {
        setIsLoadingRepos(true)
        setErrorMessage(null)

        try {
          const data = await searchRepos({
            data: {
              owner: selectedOwnerItem.login,
              ownerType: selectedOwnerItem.type,
              query: repoQuery,
            },
          })
          setRepos(data.repos)
        } catch (error) {
          setErrorMessage(errorToMessage(error))
        } finally {
          setIsLoadingRepos(false)
        }
      })()
    }, 250)

    return () => clearTimeout(timeout)
  }, [isAuthenticated, selectedOwnerItem, repoQuery, searchRepos])

  const handleSignIn = async () => {
    await authClient.signIn.social({
      provider: 'github',
      callbackURL: '/',
    })
  }

  const openRepo = async (repo: RepoItem) => {
    await navigate({
      to: '/$owner/$repo/$branch',
      params: {
        owner: selectedOwner,
        repo: repo.name,
        branch: repo.defaultBranch || 'main',
      },
    })
  }

  if (!isAuthenticated) {
    return (
      <main className="grid min-h-screen place-items-center p-6">
        <div className="w-full max-w-lg space-y-4 rounded-md border p-5">
          <h1 className="text-lg font-semibold">GitNote</h1>
          <p className="text-sm text-muted-foreground">
            Sign in, pick an account, then open a repository.
          </p>
          <Button type="button" onClick={() => void handleSignIn()} disabled={authPending}>
            {authPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : <LogIn className="mr-2 size-4" />}
            Continue with GitHub
          </Button>
        </div>
      </main>
    )
  }

  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="w-full max-w-3xl space-y-4 rounded-md border p-5">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-lg font-semibold">Open repository</h1>
          <Button type="button" variant="outline" onClick={() => void refreshOwners()} disabled={isLoadingOwners}>
            {isLoadingOwners ? <Loader2 className="mr-2 size-4 animate-spin" /> : <RefreshCw className="mr-2 size-4" />}
            Refresh
          </Button>
        </div>

        {errorMessage ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {errorMessage}
          </div>
        ) : null}

        {viewerOwner && !viewerOwner.installationId && installUrl ? (
          <div className="rounded-md border px-3 py-2 text-sm">
            <p className="text-muted-foreground">App is not installed on your account yet.</p>
            <a className="inline-block pt-2 underline" href={installUrl} target="_blank" rel="noreferrer">
              Install app
            </a>
          </div>
        ) : null}

        {owners.length === 0 ? (
          <div className="rounded-md border px-3 py-2 text-sm">
            <p className="text-muted-foreground">No accounts available yet.</p>
            <div className="flex items-center gap-3 pt-2">
              {installUrl ? (
                <a className="underline" href={installUrl} target="_blank" rel="noreferrer">
                  Install app
                </a>
              ) : null}
              <Button type="button" variant="outline" size="sm" onClick={() => void refreshOwners()} disabled={isLoadingOwners}>
                Refresh
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative w-full sm:w-72">
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 w-full justify-between"
                  onClick={() => setOwnerMenuOpen((open) => !open)}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {selectedOwnerItem ? (
                      <img
                        src={`https://github.com/${selectedOwnerItem.login}.png`}
                        alt={selectedOwnerItem.login}
                        className="size-5 rounded-full"
                      />
                    ) : null}
                    <span className="truncate">{selectedOwnerItem?.login || 'Select account'}</span>
                  </span>
                  <ChevronDown className="size-4" />
                </Button>

                {ownerMenuOpen ? (
                  <div className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-md border bg-background p-1 shadow-md">
                    {owners.map((owner) => (
                      <button
                        type="button"
                        key={`${owner.type}-${owner.login}`}
                        onClick={() => {
                          setSelectedOwner(owner.login)
                          setOwnerMenuOpen(false)
                        }}
                        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted"
                      >
                        <img src={`https://github.com/${owner.login}.png`} alt={owner.login} className="size-5 rounded-full" />
                        <span className="min-w-0 flex-1 truncate">{owner.login}</span>
                        {selectedOwner === owner.login ? <Check className="size-4" /> : null}
                      </button>
                    ))}
                    <div className="my-1 border-t" />
                    {installUrl ? (
                      <a
                        className="block rounded-sm px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted"
                        href={installUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Add account
                      </a>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={repoQuery}
                  onChange={(event) => setRepoQuery(event.target.value)}
                  placeholder="Search repositories"
                  className="h-10 pl-9"
                  disabled={!selectedOwnerItem?.installationId}
                />
              </div>
            </div>

            {selectedOwnerItem && !selectedOwnerItem.installationId ? (
              <div className="rounded-md border px-3 py-2 text-sm">
                <p className="text-muted-foreground">Install the app for this account/org to continue.</p>
                {selectedOwnerInstallUrl ? (
                  <a className="inline-block pt-2 underline" href={selectedOwnerInstallUrl} target="_blank" rel="noreferrer">
                    Install for {selectedOwnerItem.login}
                  </a>
                ) : null}
              </div>
            ) : (
              <div className="rounded-md border">
                <ul className="divide-y">
                  {isLoadingRepos ? (
                    <li className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" /> Loading...
                    </li>
                  ) : repos.length === 0 ? (
                    <li className="px-3 py-2 text-sm text-muted-foreground">No repositories found.</li>
                  ) : (
                    repos.map((repo) => (
                      <li key={repo.id} className="flex items-center justify-between gap-2 px-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{repo.fullName}</p>
                          <p className="text-xs text-muted-foreground">{repo.defaultBranch || 'main'}</p>
                        </div>
                        <Button type="button" size="sm" onClick={() => void openRepo(repo)}>
                          Open
                        </Button>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  )
}

function errorToMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)

  if (text.includes('401') || text.toLowerCase().includes('unauthorized')) {
    return 'Unauthorized. Sign in again and retry.'
  }

  return text
}
