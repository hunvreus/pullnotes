import { createFileRoute } from '@tanstack/react-router'
import { createServerFn, useServerFn } from '@tanstack/react-start'
import { ArrowBigDown, Check, ChevronsUpDown, Loader2, Lock, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '#/components/ui/avatar'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#/components/ui/card'
import {
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Input } from '#/components/ui/input'
import { Skeleton } from '#/components/ui/skeleton'
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
  private: boolean
  updatedAt: string
}

type RouteSearch = {
  owner?: string
  repo?: string
  branch?: string
}

type ThemeMode = 'system' | 'dark' | 'light'

type OwnersCache = {
  owners: OwnerItem[]
  viewerLogin: string
  installUrl: string | null
  selectedOwner: string
}

let ownersCache: OwnersCache | null = null
let hasResolvedHomeSessionOnce = false

const onboardingOwnersServerFn = createServerFn({ method: 'GET' }).handler(async () => {
  const accessToken = await requireGitHubAccessToken()

  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${accessToken}`,
    'X-GitHub-Api-Version': '2022-11-28',
  }

  const [viewerResponse, orgsResponse, installationsResponse] = await Promise.all([
    fetch('https://api.github.com/user', { headers }),
    fetch('https://api.github.com/user/orgs?per_page=100', { headers }),
    fetch('https://api.github.com/user/installations?per_page=100', { headers }),
  ])

  if (!viewerResponse.ok) {
    throw new Error(`Failed to load GitHub user (${viewerResponse.status}).`)
  }

  if (!orgsResponse.ok) {
    throw new Error(`Failed to load GitHub orgs (${orgsResponse.status}).`)
  }

  if (!installationsResponse.ok) {
    throw new Error(`Failed to load GitHub installations (${installationsResponse.status}).`)
  }

  const viewer = (await viewerResponse.json()) as { id: number; login: string }
  const orgs = (await orgsResponse.json()) as Array<{ id: number; login: string }>
  const installations = (await installationsResponse.json()) as {
    installations: Array<{
      id: number
      account: {
        id: number
        login: string
        type: 'User' | 'Organization'
      } | null
    }>
  }

  const installationByOwner = new Map<string, number>()
  const installationOwners = new Map<string, { id: number; login: string; type: 'User' | 'Organization' }>()
  for (const installation of installations.installations) {
    const account = installation.account
    if (!account?.login) continue
    const key = `${account.type}:${account.login.toLowerCase()}`
    installationByOwner.set(key, installation.id)
    installationOwners.set(key, {
      id: account.id,
      login: account.login,
      type: account.type,
    })
  }

  const rawOwners = new Map<string, { id: number; login: string; type: 'User' | 'Organization' }>()
  const seedOwners: Array<{ id: number; login: string; type: 'User' | 'Organization' }> = [
    { id: viewer.id, login: viewer.login, type: 'User' },
    ...orgs.map((org) => ({ id: org.id, login: org.login, type: 'Organization' as const })),
  ]
  for (const owner of seedOwners) {
    rawOwners.set(`${owner.type}:${owner.login.toLowerCase()}`, owner)
  }
  for (const [key, owner] of installationOwners.entries()) {
    rawOwners.set(key, owner)
  }

  const owners = await Promise.all(
    Array.from(rawOwners.values()).map(async (owner) => ({
      ...owner,
      installationId:
        installationByOwner.get(`${owner.type}:${owner.login.toLowerCase()}`) ??
        (await getOwnerInstallationId(owner.login, owner.type)),
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
      limit: 5,
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

  const [owners, setOwners] = useState<OwnerItem[]>(() => ownersCache?.owners ?? [])
  const [viewerLogin, setViewerLogin] = useState(() => ownersCache?.viewerLogin ?? '')
  const [installUrl, setInstallUrl] = useState<string | null>(() => ownersCache?.installUrl ?? null)
  const [selectedOwner, setSelectedOwner] = useState(() => ownersCache?.selectedOwner ?? '')
  const [repoQuery, setRepoQuery] = useState('')
  const [repos, setRepos] = useState<RepoItem[]>([])
  const [isLoadingOwners, setIsLoadingOwners] = useState(false)
  const [isLoadingRepos, setIsLoadingRepos] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [themeMode, setThemeMode] = useState<ThemeMode>('system')
  const isAuthenticated = Boolean(authSession?.user)
  const installedOwners = useMemo(
    () => owners.filter((item) => item.installationId !== null),
    [owners],
  )
  const selectedOwnerItem = installedOwners.find((item) => item.login === selectedOwner) ?? null
  const shouldShowAppLoader = authPending && !hasResolvedHomeSessionOnce && !ownersCache
  const showOwnersBootstrapSkeleton =
    (authPending && owners.length === 0) || (isAuthenticated && isLoadingOwners && owners.length === 0)

  const hasAnyInstallation = installedOwners.length > 0

  const addAccountInstallUrl = installUrl

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

  const applyOwners = (data: { owners: OwnerItem[]; viewerLogin: string; installUrl: string | null }) => {
    const fallback = data.owners.find((item) => item.installationId !== null) ?? data.owners[0]
    const nextSelectedOwner =
      selectedOwner && data.owners.some((item) => item.login === selectedOwner && item.installationId !== null)
        ? selectedOwner
        : fallback?.login || ''

    setOwners(data.owners)
    setViewerLogin(data.viewerLogin)
    setInstallUrl(data.installUrl)
    setSelectedOwner(nextSelectedOwner)
    ownersCache = {
      owners: data.owners,
      viewerLogin: data.viewerLogin,
      installUrl: data.installUrl,
      selectedOwner: nextSelectedOwner,
    }
  }

  const refreshOwners = async (options?: { silent?: boolean }) => {
    if (!options?.silent) setIsLoadingOwners(true)

    try {
      const data = await getOwners()
      applyOwners(data)
    } catch (error) {
      setErrorMessage(errorToMessage(error))
    } finally {
      if (!options?.silent) setIsLoadingOwners(false)
    }
  }

  useEffect(() => {
    if (!authPending) {
      hasResolvedHomeSessionOnce = true
    }
  }, [authPending])

  useEffect(() => {
    if (authPending) return

    if (!isAuthenticated) {
      setOwners([])
      setViewerLogin('')
      setInstallUrl(null)
      setSelectedOwner('')
      setRepos([])
      ownersCache = null
      return
    }

    const hasCache = Boolean(ownersCache)
    if (hasCache) {
      setOwners(ownersCache?.owners ?? [])
      setViewerLogin(ownersCache?.viewerLogin ?? '')
      setInstallUrl(ownersCache?.installUrl ?? null)
      setSelectedOwner(ownersCache?.selectedOwner ?? '')
      void refreshOwners({ silent: true })
      return
    }

    void refreshOwners()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authPending, isAuthenticated])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const nextTheme = window.localStorage.getItem('theme')
    if (nextTheme === 'dark' || nextTheme === 'light' || nextTheme === 'system') {
      setThemeMode(nextTheme)
    } else {
      setThemeMode('system')
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const root = window.document.documentElement
    window.localStorage.setItem('theme', themeMode)
    const resolvedTheme =
      themeMode === 'system'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : themeMode
    root.classList.toggle('dark', resolvedTheme === 'dark')
  }, [themeMode])

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

  const handleSignOut = async () => {
    await authClient.signOut()
    await navigate({ to: '/' })
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

  if (shouldShowAppLoader) {
    return (
      <main className="grid min-h-screen place-items-center p-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
          Loading app...
        </div>
      </main>
    )
  }

  if (!isAuthenticated) {
    return (
      <main className="flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
        <div className="flex w-full max-w-64 flex-col gap-4">
          <div className="flex items-center gap-2 self-center font-medium">
            <div className="bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-md">
              <ArrowBigDown className="size-4" />
            </div>
            PullNotes
          </div>
          <p className="text-center text-sm text-muted-foreground">
            A minimal Notion-style Markdown editor for GitHub repositories
          </p>
          <Button
            type="button"
            className="w-full"
            onClick={() => void handleSignIn()}
            disabled={authPending}
          >
            {authPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <title>GitHub</title>
                <path
                  fill="currentColor"
                  d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
                />
              </svg>
            )}
            Login with GitHub
          </Button>
        </div>
      </main>
    )
  }

  return (
    <main className="relative grid min-h-screen place-items-center px-6 py-16">
      <Card className="w-full max-w-xl gap-4 py-4">
        <CardHeader>
          <div className="space-y-1">
            <CardTitle>Choose a repository</CardTitle>
            <CardDescription>
              Select an account, search installed repositories, and open one to edit Markdown.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">

        {errorMessage ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {errorMessage}
          </div>
        ) : null}

        {owners.length === 0 ? (
          showOwnersBootstrapSkeleton ? (
            <>
              <div className="flex items-center gap-2">
                <Skeleton className="h-9 w-56" />
                <Skeleton className="h-9 flex-1" />
              </div>
              <ul className="h-[232px] space-y-2 overflow-hidden">
                {Array.from({ length: 5 }).map((_, index) => (
                  <li key={`bootstrap-skeleton-${index}`} className="flex h-10 items-center justify-between rounded-md border px-3">
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="size-4 rounded-sm" />
                      <Skeleton className="h-3 w-16" />
                    </div>
                    <Skeleton className="h-6 w-14" />
                  </li>
                ))}
              </ul>
            </>
          ) : (
          <div className="rounded-md border px-3 py-2 text-sm">
            <p className="text-muted-foreground">No accounts available yet.</p>
            <div className="flex items-center gap-3 pt-2">
              {installUrl ? (
                <a className="underline" href={installUrl}>
                  Install app
                </a>
              ) : null}
            </div>
          </div>
          )
        ) : !hasAnyInstallation ? (
          <div className="flex h-[17.75rem] flex-col items-center justify-center gap-3 text-center text-sm">
            {installUrl ? (
              <a href={installUrl}>
                <Button type="button" variant="default" size="sm">
                  Install the GitHub app
                </Button>
              </a>
            ) : null}
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="w-full sm:w-56">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="outline" className="w-full justify-between">
                      <span className="flex min-w-0 items-center gap-2">
                        {selectedOwnerItem ? (
                          <img
                            src={`https://github.com/${selectedOwnerItem.login}.png`}
                            alt={selectedOwnerItem.login}
                            className="size-5 rounded-sm"
                          />
                        ) : null}
                        <span className="truncate">{selectedOwnerItem?.login || 'Select account'}</span>
                      </span>
                      <ChevronsUpDown className="size-4 text-muted-foreground" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width)">
                    {installedOwners.map((owner) => (
                      <DropdownMenuItem key={`${owner.type}-${owner.login}`} onSelect={() => setSelectedOwner(owner.login)}>
                        <img src={`https://github.com/${owner.login}.png`} alt={owner.login} className="size-5 rounded-sm" />
                        <span className="min-w-0 flex-1 truncate">{owner.login}</span>
                        {selectedOwner === owner.login ? <Check className="size-4" /> : null}
                      </DropdownMenuItem>
                    ))}
                    {addAccountInstallUrl ? (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem asChild>
                          <a href={addAccountInstallUrl}>
                            Add account
                          </a>
                        </DropdownMenuItem>
                      </>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={repoQuery}
                  onChange={(event) => setRepoQuery(event.target.value)}
                  placeholder="Search repositories"
                  className="pl-9"
                  disabled={!selectedOwnerItem?.installationId}
                />
              </div>
            </div>

            {selectedOwnerItem && !selectedOwnerItem.installationId ? (
              <div className="rounded-md border px-3 py-2 text-sm">
                <p className="text-muted-foreground">Install the app for this account/org to continue.</p>
                {installUrl ? (
                  <a className="inline-block pt-2 underline" href={installUrl}>
                    Install for {selectedOwnerItem.login}
                  </a>
                ) : null}
              </div>
            ) : (
              <div>
                <ul className="h-[232px] space-y-2 overflow-hidden">
                  {isLoadingRepos ? (
                    Array.from({ length: 5 }).map((_, index) => (
                      <li
                        key={`repo-skeleton-${index}`}
                        className="flex h-10 items-center justify-between gap-3 rounded-md border px-3"
                      >
                        <div className="flex items-center gap-2">
                          <Skeleton className="h-4 w-32" />
                          <Skeleton className="size-4 rounded-sm" />
                          <Skeleton className="h-3 w-16" />
                        </div>
                        <Skeleton className="h-6 w-14" />
                      </li>
                    ))
                  ) : repos.length === 0 ? (
                    <li className="flex h-10 items-center rounded-md border px-3 text-sm text-muted-foreground">
                      No repositories found.
                    </li>
                  ) : (
                    <>
                      {repos.slice(0, 5).map((repo) => (
                        <li
                          key={repo.id}
                          className="flex h-10 items-center justify-between gap-2 rounded-md border px-3"
                        >
                          <div className="min-w-0 flex items-center gap-2 text-sm">
                            <a
                              href={`/${encodeURIComponent(selectedOwner)}/${encodeURIComponent(repo.name)}/${encodeURIComponent(repo.defaultBranch || 'main')}`}
                              onClick={(event) => {
                                event.preventDefault()
                                void openRepo(repo)
                              }}
                              className="truncate font-medium hover:underline"
                            >
                              {repo.name}
                            </a>
                            {repo.private ? <Lock className="size-4 text-muted-foreground" /> : null}
                            <span className="text-xs text-muted-foreground">{formatTimeAgo(repo.updatedAt)}</span>
                          </div>
                          <Button type="button" size="xs" variant="outline" onClick={() => void openRepo(repo)}>
                            Open
                          </Button>
                        </li>
                      ))}
                    </>
                  )}
                </ul>
              </div>
            )}
          </>
        )}
        </CardContent>
      </Card>

      <div className="absolute bottom-6 left-6 size-8">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="size-full rounded-full p-0">
              <Avatar className="size-8 rounded-full">
                <AvatarImage
                  src={authSession?.user?.image || (viewerLogin ? `https://github.com/${viewerLogin}.png` : undefined)}
                  alt={authSession?.user?.name || authSession?.user?.email || 'User'}
                />
                <AvatarFallback>
                  {(authSession?.user?.name || authSession?.user?.email || viewerLogin || 'U').slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" sideOffset={8}>
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                Theme
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={themeMode}
                onValueChange={(value) => setThemeMode(value as ThemeMode)}
              >
                <DropdownMenuRadioItem value="system">
                  System
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="dark">
                  Dark
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="light">
                  Light
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => void handleSignOut()}>
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </main>
  )
}

function formatTimeAgo(isoDate: string): string {
  const input = new Date(isoDate).getTime()
  if (Number.isNaN(input)) return 'Recently updated'
  const diffMs = input - Date.now()
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  const week = 7 * day
  const month = 30 * day
  const year = 365 * day
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'always' })

  if (Math.abs(diffMs) < hour) return rtf.format(Math.round(diffMs / minute), 'minute')
  if (Math.abs(diffMs) < day) return rtf.format(Math.round(diffMs / hour), 'hour')
  if (Math.abs(diffMs) < week) return rtf.format(Math.round(diffMs / day), 'day')
  if (Math.abs(diffMs) < month) return rtf.format(Math.round(diffMs / week), 'week')
  if (Math.abs(diffMs) < year) return rtf.format(Math.round(diffMs / month), 'month')
  return rtf.format(Math.round(diffMs / year), 'year')
}

function errorToMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)

  if (text.includes('401') || text.toLowerCase().includes('unauthorized')) {
    return 'Unauthorized. Sign in again and retry.'
  }

  return text
}
