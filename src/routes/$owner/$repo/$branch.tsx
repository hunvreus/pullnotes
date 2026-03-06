import { createFileRoute, useBlocker, useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { createServerFn, useServerFn } from '@tanstack/react-start'
import type { Editor as TiptapEditor } from '@tiptap/core'
import {
  Command,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Ellipsis,
  ExternalLink,
  FileText,
  ImagePlus,
  Loader2,
  LogIn,
  Plus,
  Search,
  SmilePlus,
  Undo2,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import { Fragment, type Dispatch, type SetStateAction, useEffect, useMemo, useRef, useState } from 'react'
import { AboutPullNotesDialog } from '#/components/about-pullnotes-dialog'
import { Avatar, AvatarFallback, AvatarImage } from '#/components/ui/avatar'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '#/components/ui/breadcrumb'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '#/components/ui/empty'
import { Editor, type EditorTocItem } from '#/components/ui/editor'
import { Input } from '#/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '#/components/ui/popover'
import { ScrollArea } from '#/components/ui/scroll-area'
import { Separator } from '#/components/ui/separator'
import { Skeleton } from '#/components/ui/skeleton'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarProvider,
  SidebarTrigger,
} from '#/components/ui/sidebar'
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip'
import { authClient } from '#/lib/auth-client'
import {
  deleteMarkdownFile,
  getMarkdownFile,
  getRepoVisibility,
  listRepoDirectoryDownloadUrls,
  listRecentCommits,
  listMarkdownEntriesViaGraphql,
  type RepoMarkdownMetaEntry,
  type RepoTargetInput,
  upsertMarkdownFile,
  upsertRepoFile,
} from '#/lib/github'
import { parseMarkdownEntry, serializeMarkdownEntry } from '#/lib/markdown'
import { requireGitHubAccessToken, requireSession } from '#/lib/session'

type RouteSearch = {
  root?: string
  file?: string
}

type MarkdownFile = RepoMarkdownMetaEntry

type FolderNode = {
  path: string
  name: string
  files: MarkdownFile[]
  folders: FolderNode[]
}

type ThemeMode = 'system' | 'dark' | 'light'
type EmojiOption = { unicode: string; label: string }
type CoverPhoto = {
  id: string
  previewUrl: string
  fullUrl: string
  alt: string
  authorName: string
  authorUrl: string
}

type RecentRepoItem = {
  owner: string
  repo: string
  branch: string
  visitedAt: string
}

type CachedMarkdownFile = {
  version: 1
  sha: string
  title: string
  icon: string
  cover: string
  body: string
  updatedAt: number
}

const ICON_OPTIONS: EmojiOption[] = [
  { unicode: '😀', label: 'grinning face' },
  { unicode: '😁', label: 'beaming face' },
  { unicode: '🙂', label: 'slightly smiling face' },
  { unicode: '😊', label: 'smiling face' },
  { unicode: '😉', label: 'winking face' },
  { unicode: '😍', label: 'heart eyes' },
  { unicode: '🤩', label: 'star struck' },
  { unicode: '🥳', label: 'partying face' },
  { unicode: '😎', label: 'sunglasses' },
  { unicode: '🤓', label: 'nerd face' },
  { unicode: '✨', label: 'sparkles' },
  { unicode: '🔥', label: 'fire' },
  { unicode: '🚀', label: 'rocket' },
  { unicode: '📝', label: 'memo' },
  { unicode: '📌', label: 'pin' },
  { unicode: '✅', label: 'check mark' },
  { unicode: '📚', label: 'books' },
  { unicode: '📘', label: 'blue book' },
  { unicode: '📙', label: 'orange book' },
  { unicode: '📗', label: 'green book' },
  { unicode: '📕', label: 'red book' },
  { unicode: '🧭', label: 'compass' },
  { unicode: '🎯', label: 'target' },
  { unicode: '🧩', label: 'puzzle' },
  { unicode: '🛠️', label: 'tools' },
  { unicode: '⚙️', label: 'gear' },
  { unicode: '💡', label: 'idea' },
  { unicode: '🧠', label: 'brain' },
  { unicode: '🌍', label: 'globe' },
  { unicode: '🏁', label: 'flag' },
]
const COVER_RESULT_SKELETON_IDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
const RECENT_REPOS_STORAGE_KEY = 'pullnotes.recent-repos'
const MAX_RECENT_REPO_MENU_ITEMS = 5
const IMAGE_ASSET_ROOT = '_files'

const listFilesServerFn = createServerFn({ method: 'POST' })
  .inputValidator((input: { target: RepoTargetInput }) => input)
  .handler(async ({ data }) => {
    await requireSession()
    return listMarkdownEntriesViaGraphql(data.target)
  })

const getFileServerFn = createServerFn({ method: 'POST' })
  .inputValidator((input: { target: RepoTargetInput; path: string }) => input)
  .handler(async ({ data }) => {
    await requireSession()

    const file = await getMarkdownFile(data.target, data.path)
    const parsed = parseMarkdownEntry(file.content)

    return {
      path: data.path,
      sha: file.sha,
      title: parsed.title,
      icon: parsed.icon,
      cover: parsed.cover,
      body: parsed.body,
    }
  })

const saveFileServerFn = createServerFn({ method: 'POST' })
  .inputValidator(
    (input: {
      target: RepoTargetInput
      path: string
      title: string
      icon: string
      cover: string
      body: string
      sha?: string
    }) => input,
  )
  .handler(async ({ data }) => {
    await requireSession()
    const userToken = await requireGitHubAccessToken()

    const content = serializeMarkdownEntry({
      title: data.title,
      icon: data.icon,
      cover: data.cover,
      body: data.body,
    })

    return upsertMarkdownFile(data.target, {
      path: data.path,
      content,
      message: `chore(pullnotes): update ${data.path}`,
      sha: data.sha,
    }, {
      userToken,
    })
  })

const deleteFileServerFn = createServerFn({ method: 'POST' })
  .inputValidator(
    (input: {
      target: RepoTargetInput
      path: string
      sha: string
    }) => input,
  )
  .handler(async ({ data }) => {
    await requireSession()
    const userToken = await requireGitHubAccessToken()
    await deleteMarkdownFile(data.target, {
      path: data.path,
      sha: data.sha,
      message: `chore(pullnotes): delete ${data.path}`,
    }, {
      userToken,
    })
    return { ok: true as const }
  })

const recentCommitsServerFn = createServerFn({ method: 'GET' })
  .inputValidator((input: { target: RepoTargetInput }) => input)
  .handler(async ({ data }) => {
    await requireSession()
    return listRecentCommits(data.target)
  })

const searchPexelsServerFn = createServerFn({ method: 'GET' })
  .inputValidator((input: { query: string }) => input)
  .handler(async ({ data }) => {
    await requireSession()

    const apiKey = process.env.PEXELS_API_KEY?.trim()
    if (!apiKey) {
      throw new Error('Missing PEXELS_API_KEY.')
    }

    const query = data.query.trim() || 'notion cover'
    const url = new URL('https://api.pexels.com/v1/search')
    url.searchParams.set('query', query)
    url.searchParams.set('per_page', '8')
    url.searchParams.set('orientation', 'landscape')

    const response = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
        Authorization: apiKey,
      },
    })

    if (!response.ok) {
      throw new Error(`Pexels search failed (${response.status}).`)
    }

    const payload = (await response.json()) as {
      photos: Array<{
        id: string
        alt: string | null
        src: {
          medium?: string
          large2x?: string
          large?: string
          landscape?: string
          original?: string
        }
        photographer: string
        photographer_url: string
      }>
    }

    return payload.photos
      .map((item) => {
        const previewUrl = item.src.medium || item.src.large || item.src.landscape || item.src.original || ''
        const fullUrl = item.src.large2x || item.src.large || item.src.original || previewUrl
        if (!previewUrl || !fullUrl) return null

        return {
          id: String(item.id),
          previewUrl,
          fullUrl,
          alt: item.alt || 'Pexels cover',
          authorName: item.photographer,
          authorUrl: item.photographer_url,
        }
      })
      .filter((item): item is CoverPhoto => Boolean(item))
  })

const uploadImageAssetServerFn = createServerFn({ method: 'POST' })
  .inputValidator((input: {
    target: RepoTargetInput
    fileName: string
    mimeType: string
    contentBase64: string
  }) => input)
  .handler(async ({ data }) => {
    await requireSession()
    const userToken = await requireGitHubAccessToken()

    const normalizedName = sanitizeFileName(data.fileName)
    const extension = getFileExtension(normalizedName)
    const safeExt = extensionFromMimeType(data.mimeType) || extension || 'png'
    const relativePath = `${IMAGE_ASSET_ROOT}/${createImageAssetName(safeExt)}`

    const result = await upsertRepoFile(data.target, {
      path: relativePath,
      contentBase64: data.contentBase64,
      message: `chore(pullnotes): upload ${relativePath}`,
    }, {
      userToken,
    })

    return {
      path: result.path,
      relativePath: normalizeStoredImagePath(relativePath),
    }
  })

const repoVisibilityServerFn = createServerFn({ method: 'GET' })
  .inputValidator((input: { target: RepoTargetInput }) => input)
  .handler(async ({ data }) => {
    await requireSession()
    const userToken = await requireGitHubAccessToken()
    return getRepoVisibility(data.target, { userToken })
  })

const listMediaDirectoryServerFn = createServerFn({ method: 'GET' })
  .inputValidator((input: { target: RepoTargetInput; directoryPath: string }) => input)
  .handler(async ({ data }) => {
    await requireSession()
    const userToken = await requireGitHubAccessToken()
    const list = await listRepoDirectoryDownloadUrls(data.target, data.directoryPath, { userToken })
    return list
      .filter((item) => item.type === 'file')
      .map((item) => ({
        name: item.name,
        url: item.downloadUrl,
      }))
  })

export const Route = createFileRoute('/$owner/$repo/$branch')({
  validateSearch: (search): RouteSearch => {
    const raw = search as Record<string, unknown>

    return {
      root: typeof raw.root === 'string' ? raw.root : undefined,
      file: typeof raw.file === 'string' ? raw.file : undefined,
    }
  },
  component: App,
})

export function App() {
  const routeSearch = useSearch({ strict: false }) as RouteSearch
  const params = useParams({ strict: false }) as {
    owner?: string
    repo?: string
    branch?: string
    _splat?: string
  }
  const navigate = useNavigate()

  const listFiles = useServerFn(listFilesServerFn)
  const getFile = useServerFn(getFileServerFn)
  const saveFile = useServerFn(saveFileServerFn)
  const deleteFile = useServerFn(deleteFileServerFn)
  const getRecentCommits = useServerFn(recentCommitsServerFn)
  const searchPexels = useServerFn(searchPexelsServerFn)
  const uploadImageAsset = useServerFn(uploadImageAssetServerFn)
  const getRepoVisibilityFn = useServerFn(repoVisibilityServerFn)
  const listMediaDirectory = useServerFn(listMediaDirectoryServerFn)

  const { data: authSession, isPending: authPending } = authClient.useSession()
  const titleInputRef = useRef<HTMLTextAreaElement>(null)
  const editorRegionRef = useRef<HTMLDivElement>(null)
  const isResolvingLeaveRef = useRef(false)
  const imagePickerInputRef = useRef<HTMLInputElement | null>(null)

  const [files, setFiles] = useState<MarkdownFile[]>([])
  const [filterQuery, setFilterQuery] = useState('')
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set(['']))
  const [isLoadingFile, setIsLoadingFile] = useState(false)
  const [isLoadingRepo, setIsLoadingRepo] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [icon, setIcon] = useState('')
  const [cover, setCover] = useState('')
  const [sha, setSha] = useState<string | undefined>(undefined)
  const [hasLoadedFile, setHasLoadedFile] = useState(false)
  const [loadedPath, setLoadedPath] = useState<string | null>(null)
  const [savedTitle, setSavedTitle] = useState('')
  const [savedIcon, setSavedIcon] = useState('')
  const [savedCover, setSavedCover] = useState('')
  const [savedBody, setSavedBody] = useState('')
  const [hasUserEdits, setHasUserEdits] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [recentCommits, setRecentCommits] = useState<Array<{
    sha: string
    message: string
    authorName: string
    authorAvatarUrl: string | null
    date: string | null
  }>>([])
  const [isEmojiPopoverOpen, setIsEmojiPopoverOpen] = useState(false)
  const [emojiQuery, setEmojiQuery] = useState('')
  const [allEmojiOptions, setAllEmojiOptions] = useState<EmojiOption[] | null>(null)
  const [isEmojiSearchLoading, setIsEmojiSearchLoading] = useState(false)
  const [isCoverPopoverOpen, setIsCoverPopoverOpen] = useState(false)
  const [coverQuery, setCoverQuery] = useState('')
  const [coverResults, setCoverResults] = useState<CoverPhoto[]>([])
  const [isCoverSearchLoading, setIsCoverSearchLoading] = useState(false)
  const [coverSearchError, setCoverSearchError] = useState<string | null>(null)
  const [highlightedPath, setHighlightedPath] = useState<string | null>(null)
  const [recentRepos, setRecentRepos] = useState<RecentRepoItem[]>([])
  const [isAboutOpen, setIsAboutOpen] = useState(false)
  const [tocItems, setTocItems] = useState<EditorTocItem[]>([])
  const [activeTocId, setActiveTocId] = useState<string | null>(null)
  const [editorInstance, setEditorInstance] = useState<TiptapEditor | null>(null)
  const [isRepoPrivate, setIsRepoPrivate] = useState(false)
  const [bodyForEditor, setBodyForEditor] = useState('')
  const [coverLayoutTick, setCoverLayoutTick] = useState(0)
  const mediaDirectoryCacheRef = useRef(
    new Map<string, { expiresAt: number; files: Map<string, string> }>(),
  )
  const mediaDirectoryRequestRef = useRef(new Map<string, Promise<Map<string, string>>>())
  const latestDraftRef = useRef({
    title: '',
    icon: '',
    cover: '',
    body: '',
  })
  const [tocTop, setTocTop] = useState(96)
  const [pendingImageUploads, setPendingImageUploads] = useState(0)
  const [isSlashCommandOpen, setIsSlashCommandOpen] = useState(false)

  useEffect(() => {
    return () => {
      if (imagePickerInputRef.current?.parentNode) {
        imagePickerInputRef.current.parentNode.removeChild(imagePickerInputRef.current)
      }
      imagePickerInputRef.current = null
    }
  }, [])

  const owner = String(params.owner || '').trim()
  const repo = String(params.repo || '').trim()
  const branch = String(params.branch || '').trim()
  const rootPath = (routeSearch.root || '').replace(/^\/+|\/+$/g, '')
  const filePathFromRoute =
    typeof params._splat === 'string' && params._splat.trim()
      ? decodePathFromUrl(params._splat)
      : null
  const filePathFromSearch =
    typeof routeSearch.file === 'string'
      ? routeSearch.file.replace(/^\/+|\/+$/g, '').trim() || null
      : null
  const filePathFromUrl = filePathFromRoute || filePathFromSearch

  useEffect(() => {
    setTocItems([])
    setActiveTocId(null)
    setPendingImageUploads(0)
    setIsSlashCommandOpen(false)
  }, [selectedPath])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const update = () => {
      const titleTop = titleInputRef.current?.getBoundingClientRect().top
      if (typeof titleTop !== 'number' || Number.isNaN(titleTop)) return
      const next = Math.max(12, Math.round(titleTop))
      setTocTop((prev) => (Math.abs(prev - next) > 1 ? next : prev))
    }

    const raf = window.requestAnimationFrame(update)
    const timeout = window.setTimeout(update, 60)
    window.addEventListener('resize', update)

    return () => {
      window.cancelAnimationFrame(raf)
      window.clearTimeout(timeout)
      window.removeEventListener('resize', update)
    }
  }, [cover, selectedPath, isLoadingFile, hasLoadedFile, coverLayoutTick])

  useEffect(() => {
    latestDraftRef.current = {
      title,
      icon,
      cover,
      body,
    }
  }, [title, icon, cover, body])

  const activeTarget = useMemo(
    () => ({ owner, repo, branch, rootPath }),
    [owner, repo, branch, rootPath],
  )

  const setSelectedPathAndUrl = (nextPath: string | null, replace = false) => {
    const search = {
      ...(rootPath ? { root: rootPath } : {}),
      ...(nextPath ? { file: nextPath } : {}),
    }
    void navigate({
      to: '/$owner/$repo/$branch',
      params: {
        owner,
        repo,
        branch,
      },
      search,
      replace,
    })
  }

  const tree = useMemo(() => buildTree(files), [files])
  const fileMap = useMemo(() => new Map(files.map((file) => [file.path, file])), [files])
  const fileMapRef = useRef(fileMap)
  useEffect(() => {
    fileMapRef.current = fileMap
  }, [fileMap])
  const isAuthenticated = Boolean(authSession?.user)
  const { theme, setTheme } = useTheme()
  const themeMode: ThemeMode =
    theme === 'dark' || theme === 'light' || theme === 'system' ? theme : 'system'
  const titleMissing = title.trim().length === 0

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!isAuthenticated || !owner || !repo || !branch) return
      try {
        const info = await getRepoVisibilityFn({
          data: {
            target: activeTarget,
          },
        })
        if (cancelled) return
        setIsRepoPrivate(Boolean(info.private))
      } catch {
        if (cancelled) return
        setIsRepoPrivate(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [isAuthenticated, owner, repo, branch, activeTarget, getRepoVisibilityFn])

  useEffect(() => {
    let cancelled = false

    const resolveDirectoryFileMap = async (directoryPath: string) => {
      const key = directoryPath
      const cached = mediaDirectoryCacheRef.current.get(key)
      if (cached && cached.expiresAt > Date.now()) {
        return cached.files
      }

      const pending = mediaDirectoryRequestRef.current.get(key)
      if (pending) return pending

      const request = (async () => {
        const result = await listMediaDirectory({
          data: {
            target: activeTarget,
            directoryPath,
          },
        })
        const files = new Map<string, string>()
        for (const item of result) {
          if (!item.name || !item.url) continue
          files.set(item.name, item.url)
        }
        mediaDirectoryCacheRef.current.set(key, {
          expiresAt: Date.now() + 30_000,
          files,
        })
        return files
      })().finally(() => {
        mediaDirectoryRequestRef.current.delete(key)
      })

      mediaDirectoryRequestRef.current.set(key, request)
      return request
    }

    const resolveDisplayUrl = async (source: string): Promise<string> => {
      if (isNonRelativeUrl(source)) return source
      if (!isRepoPrivate) {
        return toGitHubImageUrl({
          owner,
          repo,
          branch,
          rootPath,
          relativePath: source,
        })
      }

      const relativePath = source.replace(/^\/+/, '')
      const filename = getFileName(relativePath)
      if (!filename) return source
      const directoryPath = getParentPath(relativePath)
      const files = await resolveDirectoryFileMap(directoryPath)
      return (
        files.get(filename) ||
        toGitHubImageUrl({
          owner,
          repo,
          branch,
          rootPath,
          relativePath: source,
        })
      )
    }

    const build = async () => {
      const sources = getImageSourcesInMarkdown(body).filter((source) => !isNonRelativeUrl(source))
      if (!sources.length) {
        if (!cancelled) setBodyForEditor(body)
        return
      }

      const unique = Array.from(new Set(sources))
      const resolved = await Promise.all(
        unique.map(async (source) => [source, await resolveDisplayUrl(source)] as const),
      )
      if (cancelled) return

      const map = new Map<string, string>(resolved)
      setBodyForEditor(mapImageSourcesInMarkdown(body, (src) => map.get(src) || src))
    }

    void build()
    return () => {
      cancelled = true
    }
  }, [body, owner, repo, branch, rootPath, isRepoPrivate, activeTarget, listMediaDirectory])
  const filteredEmojiOptions = useMemo(() => {
    const query = emojiQuery.trim().toLowerCase()
    if (!query) return ICON_OPTIONS

    const source = allEmojiOptions || ICON_OPTIONS
    return source
      .filter((item) => item.label.toLowerCase().includes(query) || item.unicode.includes(query))
      .slice(0, 120)
  }, [emojiQuery, allEmojiOptions])

  useEffect(() => {
    if (!isEmojiPopoverOpen || allEmojiOptions) return

    let cancelled = false
    const load = async () => {
      setIsEmojiSearchLoading(true)
      try {
        const module = (await import('emojibase-data/en/compact.json')) as {
          default: Array<{ unicode?: string; label?: string }>
        }
        if (cancelled) return
        const options = module.default
          .filter((item) => Boolean(item.unicode && item.label))
          .map((item) => ({
            unicode: item.unicode as string,
            label: item.label as string,
          }))
        setAllEmojiOptions(options)
      } finally {
        if (!cancelled) setIsEmojiSearchLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [isEmojiPopoverOpen, allEmojiOptions])

  useEffect(() => {
    if (!isCoverPopoverOpen) return

    let cancelled = false
    const timeout = setTimeout(() => {
      void (async () => {
        setIsCoverSearchLoading(true)
        setCoverSearchError(null)
        try {
          const results = await searchPexels({
            data: {
              query: coverQuery,
            },
          })
          if (cancelled) return
          setCoverResults(results)
        } catch (error) {
          if (cancelled) return
          setCoverResults([])
          setCoverSearchError(errorToMessage(error))
        } finally {
          if (!cancelled) setIsCoverSearchLoading(false)
        }
      })()
    }, 250)

    return () => {
      cancelled = true
      clearTimeout(timeout)
    }
  }, [isCoverPopoverOpen, coverQuery, searchPexels])

  const isDirty =
    hasUserEdits &&
    hasLoadedFile &&
    !isLoadingFile &&
    loadedPath === selectedPath &&
    (title.trim() !== savedTitle.trim() ||
      icon.trim() !== savedIcon.trim() ||
      cover.trim() !== savedCover.trim() ||
      normalizeBodyForCompare(body) !== normalizeBodyForCompare(savedBody))
  const isSelectedFileLoaded =
    hasLoadedFile && Boolean(selectedPath) && loadedPath === selectedPath && !isLoadingFile
  const canSave =
    Boolean(isAuthenticated) &&
    isSelectedFileLoaded &&
    pendingImageUploads === 0 &&
    !isSaving &&
    !isLoadingRepo &&
    !titleMissing &&
    isDirty
  const recentRepoMenuItems = useMemo(
    () =>
      recentRepos
        .filter(
          (item) =>
            !(
              item.owner.toLowerCase() === owner.toLowerCase() &&
              item.repo.toLowerCase() === repo.toLowerCase() &&
              item.branch.toLowerCase() === branch.toLowerCase()
            ),
        )
        .slice(0, MAX_RECENT_REPO_MENU_ITEMS),
    [recentRepos, owner, repo, branch],
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    setRecentRepos(readRecentReposFromStorage())
  }, [])

  useEffect(() => {
    if (!owner || !repo || !branch) return

    const nextEntry: RecentRepoItem = {
      owner,
      repo,
      branch,
      visitedAt: new Date().toISOString(),
    }

    setRecentRepos((prev) => {
      const deduped = prev.filter(
        (item) =>
          !(
            item.owner.toLowerCase() === nextEntry.owner.toLowerCase() &&
            item.repo.toLowerCase() === nextEntry.repo.toLowerCase() &&
            item.branch.toLowerCase() === nextEntry.branch.toLowerCase()
          ),
      )
      const next = [nextEntry, ...deduped]
      writeRecentReposToStorage(next)
      return next
    })
  }, [owner, repo, branch])

  useEffect(() => {
    if (!selectedPath) return
    expandParents(selectedPath, setExpandedFolders)
  }, [selectedPath])

  const leaveBlocker = useBlocker({
    shouldBlockFn: () => (isDirty || pendingImageUploads > 0) && !isSaving,
    enableBeforeUnload: isDirty || pendingImageUploads > 0,
    withResolver: true,
  })

  const repoUrl = `https://github.com/${owner}/${repo}/tree/${branch}${rootPath ? `/${rootPath}` : ''}`
  const commitsUrl = `https://github.com/${owner}/${repo}/commits/${branch}`
  const fileUrl = selectedPath
    ? `https://github.com/${owner}/${repo}/blob/${branch}${rootPath ? `/${rootPath}` : ''}/${selectedPath}`
    : null
  const toFileUrl = (path: string) =>
    `https://github.com/${owner}/${repo}/blob/${branch}${rootPath ? `/${rootPath}` : ''}/${path}`
  const breadcrumbs = useMemo(() => {
    if (!selectedPath) return []
    const stem = selectedPath.replace(/\.md$/i, '')
    const parts = stem.split('/').filter(Boolean)
    return parts.map((_, index) => {
      const mdPath = `${parts.slice(0, index + 1).join('/')}.md`
      const file = fileMap.get(mdPath)
      return {
        path: mdPath,
        label: file?.title?.trim() || parts[index] || 'untitled',
        icon: file?.icon?.trim() || '',
      }
    })
  }, [selectedPath, fileMap])
  const loadRecentCommits = async () => {
    try {
      const commits = await getRecentCommits({
        data: {
          target: activeTarget,
        },
      })
      setRecentCommits(commits)
    } catch {
      setRecentCommits([])
    }
  }

  const refreshFiles = async (options?: { preferredPath?: string | null }) => {
    const nextFiles = await listFiles({
      data: {
        target: activeTarget,
      },
    })

    setFiles(nextFiles)
    const nextPaths = new Set(nextFiles.map((file) => file.path))
    const preferredPath = options?.preferredPath ?? null

    if (preferredPath && nextPaths.has(preferredPath)) {
      if (selectedPath !== preferredPath) {
        setSelectedPathAndUrl(preferredPath, true)
      }
      return
    }

    if (filePathFromUrl && nextPaths.has(filePathFromUrl)) {
      if (selectedPath !== filePathFromUrl) {
        setSelectedPath(filePathFromUrl)
      }
      return
    }

    if (selectedPath && nextPaths.has(selectedPath)) return

    if (nextFiles[0]) {
      setSelectedPathAndUrl(nextFiles[0].path, true)
      return
    }

    if (selectedPath || filePathFromUrl) {
      setSelectedPathAndUrl(null, true)
    }
  }

  useEffect(() => {
    setSelectedPath(filePathFromUrl)
  }, [filePathFromUrl])

  useEffect(() => {
    // Normalize path-based links to query-based URL so route component state is preserved.
    if (!filePathFromRoute) return
    setSelectedPathAndUrl(filePathFromRoute, true)
  }, [filePathFromRoute])

  useEffect(() => {
    setFiles([])
    setSelectedPath(filePathFromUrl)
    setTitle('')
    setBody('')
    setIcon('')
    setCover('')
    setSha(undefined)
    setHasLoadedFile(false)
    setLoadedPath(null)
    setSavedTitle('')
    setSavedIcon('')
    setSavedCover('')
    setSavedBody('')
    setHasUserEdits(false)
    setErrorMessage(null)
    setRecentCommits([])
    setIsLoadingRepo(true)
  }, [owner, repo, branch, rootPath])

  useEffect(() => {
    if (!isAuthenticated) {
      setFiles([])
      setSelectedPath(filePathFromUrl)
      setIsLoadingRepo(false)
      return
    }

    const loadFiles = async () => {
      setIsLoadingRepo(true)
      setErrorMessage(null)

      try {
        await refreshFiles()
      } catch (error) {
        setErrorMessage(errorToMessage(error))
      } finally {
        setIsLoadingRepo(false)
      }
    }

    void loadFiles()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, owner, repo, branch, rootPath])

  useEffect(() => {
    if (!isAuthenticated) return
    void loadRecentCommits()
  }, [isAuthenticated, activeTarget, getRecentCommits])

  useEffect(() => {
    if (!highlightedPath) return
    const timeout = setTimeout(() => setHighlightedPath(null), 900)
    return () => clearTimeout(timeout)
  }, [highlightedPath])

  useEffect(() => {
    if (!selectedPath || !isAuthenticated) return

    const expectedSha = fileMapRef.current.get(selectedPath)?.sha
    const cached = readCachedMarkdownFile(activeTarget, selectedPath)
    const canUseCached = Boolean(cached && (!expectedSha || cached.sha === expectedSha))
    let cancelled = false

    if (canUseCached && cached) {
      setTitle(cached.title)
      setIcon(cached.icon)
      setCover(cached.cover)
      setBody(cached.body)
      setSha(cached.sha)
      setLoadedPath(selectedPath)
      setSavedTitle(cached.title)
      setSavedIcon(cached.icon)
      setSavedCover(cached.cover)
      setSavedBody(cached.body)
      setHasUserEdits(false)
      setHasLoadedFile(true)
    } else {
      setHasLoadedFile(false)
    }

    const load = async () => {
      setIsLoadingFile(!canUseCached)
      setErrorMessage(null)

      try {
        const file = await getFile({
          data: {
            target: activeTarget,
            path: selectedPath,
          },
        })
        if (cancelled) return

        setTitle(file.title)
        setIcon(file.icon)
        setCover(file.cover)
        setBody(file.body)
        setSha(file.sha)
        setLoadedPath(file.path)
        setSavedTitle(file.title)
        setSavedIcon(file.icon)
        setSavedCover(file.cover)
        setSavedBody(file.body)
        setHasUserEdits(false)
        setHasLoadedFile(true)
        writeCachedMarkdownFile(activeTarget, file.path, {
          sha: file.sha,
          title: file.title,
          icon: file.icon,
          cover: file.cover,
          body: file.body,
        })
      } catch (error) {
        if (cancelled) return
        const message = errorToMessage(error)
        setErrorMessage(
          canUseCached ? `Showing cached content. Could not refresh from GitHub: ${message}` : message,
        )
      } finally {
        if (!cancelled) setIsLoadingFile(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [selectedPath, getFile, isAuthenticated, activeTarget])

  const focusEditor = () => {
    const editorEl = editorRegionRef.current?.querySelector('.ProseMirror') as HTMLElement | null
    editorEl?.focus()
  }

  const focusTitleInput = () => {
    const input = titleInputRef.current
    if (!input) return
    input.focus()
    const cursor = input.value.length
    input.setSelectionRange(cursor, cursor)
  }

  const readFileAsBase64 = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () => reject(new Error('Failed to read image file.'))
      reader.onload = () => {
        const result = String(reader.result || '')
        const content = result.replace(/^data:.*?;base64,/, '')
        resolve(content)
      }
      reader.readAsDataURL(file)
    })

  const chooseImageFile = () =>
    new Promise<File | null>((resolve) => {
      let input = imagePickerInputRef.current
      if (!input) {
        input = document.createElement('input')
        input.style.display = 'none'
        document.body.appendChild(input)
        imagePickerInputRef.current = input
      }
      input.type = 'file'
      input.accept = 'image/*'
      input.multiple = false
      input.onchange = () => {
        const file = input.files?.[0] || null
        input.value = ''
        resolve(file)
      }
      input.click()
    })

  const uploadImageToRepo = async (file: File) => {
    const contentBase64 = await readFileAsBase64(file)
    const uploaded = await uploadImageAsset({
      data: {
        target: activeTarget,
        fileName: file.name || 'image.png',
        mimeType: file.type || '',
        contentBase64,
      },
    })

    const relativePath = uploaded.relativePath
    const defaultEditorPath = toGitHubImageUrl({
      owner,
      repo,
      branch,
      rootPath,
      relativePath,
    })

    if (!isRepoPrivate) {
      return {
        relativePath,
        editorPath: defaultEditorPath,
      }
    }

    const directoryPath = getParentPath(relativePath)
    mediaDirectoryCacheRef.current.delete(directoryPath)
    mediaDirectoryRequestRef.current.delete(directoryPath)

    try {
      const list = await listMediaDirectory({
        data: {
          target: activeTarget,
          directoryPath,
        },
      })
      const byName = new Map<string, string>()
      for (const item of list) {
        if (!item.name || !item.url) continue
        byName.set(item.name, item.url)
      }

      mediaDirectoryCacheRef.current.set(directoryPath, {
        expiresAt: Date.now() + 30_000,
        files: byName,
      })

      const filename = getFileName(relativePath)
      const resolved = filename ? byName.get(filename) : null
      return {
        relativePath,
        editorPath: resolved || defaultEditorPath,
      }
    } catch {
      return {
        relativePath,
        editorPath: defaultEditorPath,
      }
    }
  }

  const mergeFirstBodyLineIntoTitle = () => {
    const lines = body.split('\n')
    const firstLine = lines[0] || ''
    if (!firstLine) return

    const remainingBody = lines.slice(1).join('\n')
    const joinCursor = title.length
    const nextTitle = `${title}${firstLine}`

    setTitle(nextTitle)
    setBody(remainingBody)
    setHasUserEdits(true)

    window.requestAnimationFrame(() => {
      const input = titleInputRef.current
      if (!input) return
      input.focus()
      input.setSelectionRange(joinCursor, joinCursor)
    })
  }

  const handleSetCover = (nextCover: string) => {
    const trimmed = nextCover.trim()
    if (trimmed && !isAllowedCoverUrl(trimmed)) {
      setErrorMessage('Cover URL must come from Pexels or Unsplash.')
      return
    }
    setErrorMessage(null)
    if (trimmed !== cover.trim()) {
      setHasUserEdits(true)
    }
    setCover(trimmed)
    setIsCoverPopoverOpen(false)
  }

  const handleSetIcon = (nextIcon: string) => {
    if (nextIcon !== icon) {
      setHasUserEdits(true)
    }
    setIcon(nextIcon)
    setIsEmojiPopoverOpen(false)
    setEmojiQuery('')
    setErrorMessage(null)
  }

  const showErrorToast = (toastId: string | number, message: string) => {
    toast.error(message, {
      id: toastId,
      duration: 12000,
      action: {
        label: 'Dismiss',
        onClick: () => toast.dismiss(toastId),
      },
    })
  }

  const handleSave = async (options?: { silent?: boolean }): Promise<boolean> => {
    if (!selectedPath) return false
    const draftAtStart = latestDraftRef.current
    const cleanTitle = draftAtStart.title.trim()
    const persistedBody = mapImageSourcesInMarkdown(draftAtStart.body, (src) =>
      fromRenderedImageUrl({
        owner,
        repo,
        branch,
        rootPath,
        renderedPath: src,
      }),
    )
    if (!cleanTitle) {
      setErrorMessage('Title is required.')
      return false
    }

    setIsSaving(true)
    setErrorMessage(null)
    const toastId = options?.silent ? null : toast.loading('Saving changes...')

    try {
      const result = await saveFile({
        data: {
          target: activeTarget,
          path: selectedPath,
          title: cleanTitle,
          icon: draftAtStart.icon,
          cover: draftAtStart.cover,
          body: persistedBody,
          sha,
        },
      })

      setSha(result.sha)
      setSavedTitle(cleanTitle)
      setSavedIcon(draftAtStart.icon)
      setSavedCover(draftAtStart.cover)
      setSavedBody(draftAtStart.body)
      const latestDraft = latestDraftRef.current
      const unchangedSinceSaveStart =
        latestDraft.title.trim() === cleanTitle &&
        latestDraft.icon.trim() === draftAtStart.icon.trim() &&
        latestDraft.cover.trim() === draftAtStart.cover.trim() &&
        normalizeBodyForCompare(latestDraft.body) === normalizeBodyForCompare(draftAtStart.body)
      setHasUserEdits(!unchangedSinceSaveStart)

      setFiles((previous) =>
        previous.map((file) =>
          file.path === selectedPath
            ? {
                ...file,
                sha: result.sha,
                title: cleanTitle,
                icon: draftAtStart.icon,
                cover: draftAtStart.cover,
              }
            : file,
        ),
      )

      writeCachedMarkdownFile(activeTarget, selectedPath, {
        sha: result.sha,
        title: cleanTitle,
        icon: draftAtStart.icon,
        cover: draftAtStart.cover,
        body: draftAtStart.body,
      })
      await loadRecentCommits()
      if (toastId !== null) {
        toast.success('Saved', { id: toastId })
      }
      return true
    } catch (error) {
      const message = errorToMessage(error)
      setErrorMessage(message)
      if (toastId !== null) {
        showErrorToast(toastId, message)
      } else {
        toast.error(message)
      }
      return false
    } finally {
      setIsSaving(false)
    }
  }

  const handleResetChanges = () => {
    if (!isDirty || !isSelectedFileLoaded || isSaving) return
    if (!window.confirm('Discard all unsaved changes?')) return

    setTitle(savedTitle)
    setIcon(savedIcon)
    setCover(savedCover)
    setBody(savedBody)
    setHasUserEdits(false)
    setErrorMessage(null)
  }

  const handleBodyChange = (nextBody: string) => {
    setBody(nextBody)
    const isEditorFocused =
      typeof document !== 'undefined' &&
      Boolean(editorRegionRef.current?.contains(document.activeElement))
    if (isEditorFocused && hasLoadedFile && loadedPath === selectedPath && !isLoadingFile) {
      setHasUserEdits(true)
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const hasPrimaryModifier = event.metaKey || event.ctrlKey
      const hasOtherModifiers = event.altKey || event.shiftKey
      const isSaveCombo = hasPrimaryModifier && !hasOtherModifiers && event.key.toLowerCase() === 's'
      if (!isSaveCombo) return

      event.preventDefault()

      const blocked =
        !isAuthenticated || !selectedPath || isSaving || isLoadingFile || !isDirty || titleMissing
      if (blocked) return

      void handleSave()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isAuthenticated, selectedPath, isSaving, isLoadingFile, isDirty, titleMissing, handleSave])

  useEffect(() => {
    if (!canSave || isSaving || isSlashCommandOpen) return

    const timeout = setTimeout(() => {
      void handleSave({ silent: true })
    }, 3000)

    return () => clearTimeout(timeout)
  }, [canSave, isSaving, isSlashCommandOpen, handleSave])

  useEffect(() => {
    if (leaveBlocker.status !== 'blocked' || isResolvingLeaveRef.current) return
    isResolvingLeaveRef.current = true

    void (async () => {
      if (typeof window === 'undefined') {
        leaveBlocker.proceed?.()
        isResolvingLeaveRef.current = false
        return
      }

      const shouldSave = window.confirm(
        pendingImageUploads > 0
          ? 'Images are still uploading. Press OK to stay on this page, or Cancel to leave now.'
          : 'You have unsaved changes. Press OK to save before leaving, or Cancel to leave without saving.',
      )

      if (pendingImageUploads > 0) {
        if (shouldSave) {
          leaveBlocker.reset?.()
        } else {
          leaveBlocker.proceed?.()
        }
        isResolvingLeaveRef.current = false
        return
      }

      if (!shouldSave) {
        leaveBlocker.proceed?.()
        isResolvingLeaveRef.current = false
        return
      }

      const didSave = await handleSave()
      if (didSave) leaveBlocker.proceed?.()
      else leaveBlocker.reset?.()
      isResolvingLeaveRef.current = false
    })()
  }, [leaveBlocker, handleSave, pendingImageUploads])

  const handleCreate = async () => {
    const nextTitle = window.prompt('Title')
    if (!nextTitle) return
    const cleanTitle = nextTitle.trim()
    if (!cleanTitle) {
      setErrorMessage('Title is required.')
      return
    }

    const nextSlug = toSlug(cleanTitle)
    if (!nextSlug) {
      setErrorMessage('Title is required.')
      return
    }
    const targetPath = selectedPath
      ? `${dirname(selectedPath) ? `${dirname(selectedPath)}/` : ''}${nextSlug}.md`
      : `${nextSlug}.md`

    setIsSaving(true)
    setErrorMessage(null)
    const toastId = toast.loading('Creating page...')

    try {
      const result = await saveFile({
        data: {
          target: activeTarget,
          path: targetPath,
          title: cleanTitle,
          icon: '',
          cover: '',
          body: '',
        },
      })
      writeCachedMarkdownFile(activeTarget, targetPath, {
        sha: result.sha,
        title: cleanTitle,
        icon: '',
        cover: '',
        body: '',
      })

      await refreshFiles({ preferredPath: targetPath })
      setSelectedPathAndUrl(targetPath)
      expandParents(targetPath, setExpandedFolders)
      setHighlightedPath(targetPath)
      await loadRecentCommits()
      toast.success('Page created', { id: toastId })
    } catch (error) {
      const message = errorToMessage(error)
      setErrorMessage(message)
      showErrorToast(toastId, message)
    } finally {
      setIsSaving(false)
    }
  }

  const handleCreateChild = async (parentPath: string) => {
    const nextTitle = window.prompt('Title')
    if (!nextTitle) return
    const cleanTitle = nextTitle.trim()
    if (!cleanTitle) {
      setErrorMessage('Title is required.')
      return
    }

    const nextSlug = toSlug(cleanTitle)
    if (!nextSlug) {
      setErrorMessage('Title is required.')
      return
    }

    const targetDir = `${dirname(parentPath) ? `${dirname(parentPath)}/` : ''}${fileLabel(parentPath)}`
    const targetPath = `${targetDir}/${nextSlug}.md`

    setIsSaving(true)
    setErrorMessage(null)
    const toastId = toast.loading('Creating child page...')

    try {
      const result = await saveFile({
        data: {
          target: activeTarget,
          path: targetPath,
          title: cleanTitle,
          icon: '',
          cover: '',
          body: '',
        },
      })
      writeCachedMarkdownFile(activeTarget, targetPath, {
        sha: result.sha,
        title: cleanTitle,
        icon: '',
        cover: '',
        body: '',
      })

      await refreshFiles({ preferredPath: targetPath })
      setSelectedPathAndUrl(targetPath)
      expandParents(targetPath, setExpandedFolders)
      setHighlightedPath(targetPath)
      await loadRecentCommits()
      toast.success('Child page created', { id: toastId })
    } catch (error) {
      const message = errorToMessage(error)
      setErrorMessage(message)
      showErrorToast(toastId, message)
    } finally {
      setIsSaving(false)
    }
  }

  const toggleFolder = (path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const handleSignIn = async () => {
    await authClient.signIn.social({
      provider: 'github',
      callbackURL: window.location.pathname + window.location.search,
    })
  }

  const handleSignOut = async () => {
    await authClient.signOut()
    await navigate({ to: '/', replace: true })
  }

  const handleOpenRecentRepo = (item: RecentRepoItem) => {
    void navigate({
      to: '/$owner/$repo/$branch',
      params: {
        owner: item.owner,
        repo: item.repo,
        branch: item.branch,
      },
    })
  }

  const handleRename = async () => {
    if (!selectedPath || !sha) return
    const current = fileLabel(selectedPath)
    const nextName = window.prompt('Rename page', current)
    if (!nextName) return
    const nextSlug = toSlug(nextName)
    if (!nextSlug) return

    const nextPath = `${dirname(selectedPath) ? `${dirname(selectedPath)}/` : ''}${nextSlug}.md`
    if (nextPath === selectedPath) return

    setIsSaving(true)
    setErrorMessage(null)
    const toastId = toast.loading('Renaming page...')
    try {
      await movePageWithChildren({
        oldPath: selectedPath,
        newPath: nextPath,
        oldFile: { sha, title, icon, cover, body },
      })
      remapSelectedPathAfterRename(selectedPath, nextPath)
      await refreshFiles({ preferredPath: nextPath })
      expandParents(nextPath, setExpandedFolders)
      await loadRecentCommits()
      toast.success('Page renamed', { id: toastId })
    } catch (error) {
      const message = errorToMessage(error)
      setErrorMessage(message)
      showErrorToast(toastId, message)
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selectedPath || !sha) return
    const deletedPaths = subtreePathsFor(selectedPath)
    const childCount = deletedPaths.length - 1
    const confirmMessage =
      childCount > 0
        ? `Delete ${selectedPath} and ${childCount} child page${childCount === 1 ? '' : 's'}?`
        : `Delete ${selectedPath}?`
    if (!window.confirm(confirmMessage)) return

    setIsSaving(true)
    setErrorMessage(null)
    const toastId = toast.loading('Deleting page...')
    try {
      const deletedSet = new Set(deletedPaths)
      const nextPath = files.find((file) => !deletedSet.has(file.path))?.path ?? null
      await deletePageWithChildren({
        path: selectedPath,
        sha,
      })
      for (const path of deletedPaths) {
        deleteCachedMarkdownFile(activeTarget, path)
      }

      if (nextPath) {
        await refreshFiles({ preferredPath: nextPath })
      } else {
        setSelectedPathAndUrl(null, true)
        setTitle('')
        setIcon('')
        setCover('')
        setBody('')
        setSha(undefined)
        setHasLoadedFile(false)
        setLoadedPath(null)
        setSavedTitle('')
        setSavedIcon('')
        setSavedCover('')
        setSavedBody('')
        setHasUserEdits(false)
        await refreshFiles()
      }
      await loadRecentCommits()
      toast.success('Page deleted', { id: toastId })
    } catch (error) {
      const message = errorToMessage(error)
      setErrorMessage(message)
      showErrorToast(toastId, message)
    } finally {
      setIsSaving(false)
    }
  }

  const handleRenamePath = async (path: string) => {
    const current = fileLabel(path)
    const nextName = window.prompt('Rename page', current)
    if (!nextName) return
    const nextSlug = toSlug(nextName)
    if (!nextSlug) return

    const nextPath = `${dirname(path) ? `${dirname(path)}/` : ''}${nextSlug}.md`
    if (nextPath === path) return

    setIsSaving(true)
    setErrorMessage(null)
    const toastId = toast.loading('Renaming page...')
    try {
      const loadedFile =
        selectedPath === path && hasLoadedFile && loadedPath === path && sha
          ? { sha, title, icon, cover, body }
          : await getFile({
              data: {
                target: activeTarget,
                path,
              },
            })

      await movePageWithChildren({
        oldPath: path,
        newPath: nextPath,
        oldFile: loadedFile,
      })
      remapSelectedPathAfterRename(path, nextPath)
      await refreshFiles({ preferredPath: nextPath })
      expandParents(nextPath, setExpandedFolders)
      await loadRecentCommits()
      toast.success('Page renamed', { id: toastId })
    } catch (error) {
      const message = errorToMessage(error)
      setErrorMessage(message)
      showErrorToast(toastId, message)
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeletePath = async (path: string) => {
    const deletedPaths = subtreePathsFor(path)
    const childCount = deletedPaths.length - 1
    const confirmMessage =
      childCount > 0
        ? `Delete ${path} and ${childCount} child page${childCount === 1 ? '' : 's'}?`
        : `Delete ${path}?`
    if (!window.confirm(confirmMessage)) return

    setIsSaving(true)
    setErrorMessage(null)
    const toastId = toast.loading('Deleting page...')
    try {
      const deletedSet = new Set(deletedPaths)
      const selectionIsDeleted = selectedPath ? deletedSet.has(selectedPath) : false
      const nextPath = selectionIsDeleted
        ? files.find((file) => !deletedSet.has(file.path))?.path ?? null
        : null
      const loaded =
        selectedPath === path && hasLoadedFile && loadedPath === path && sha
          ? { sha }
          : await getFile({
              data: {
                target: activeTarget,
                path,
              },
            })

      await deletePageWithChildren({
        path,
        sha: loaded.sha,
      })
      for (const deletedPath of deletedPaths) {
        deleteCachedMarkdownFile(activeTarget, deletedPath)
      }

      if (selectionIsDeleted) {
        if (nextPath) {
          await refreshFiles({ preferredPath: nextPath })
        } else {
          setSelectedPathAndUrl(null, true)
          setTitle('')
          setIcon('')
          setCover('')
          setBody('')
          setSha(undefined)
          setHasLoadedFile(false)
          setLoadedPath(null)
          setSavedTitle('')
          setSavedIcon('')
          setSavedCover('')
          setSavedBody('')
          setHasUserEdits(false)
          await refreshFiles()
        }
      } else {
        await refreshFiles()
      }
      await loadRecentCommits()
      toast.success('Page deleted', { id: toastId })
    } catch (error) {
      const message = errorToMessage(error)
      setErrorMessage(message)
      showErrorToast(toastId, message)
    } finally {
      setIsSaving(false)
    }
  }

  const childDirFor = (path: string) =>
    `${dirname(path) ? `${dirname(path)}/` : ''}${fileLabel(path)}`

  const childPathsFor = (path: string) => {
    const dir = childDirFor(path)
    const prefix = `${dir}/`
    return files
      .map((file) => file.path)
      .filter((filePath) => filePath.startsWith(prefix))
  }

  const subtreePathsFor = (path: string) => [path, ...childPathsFor(path)]

  const remapSelectedPathAfterRename = (oldPath: string, newPath: string) => {
    if (!selectedPath) return
    if (selectedPath === oldPath) {
      setSelectedPathAndUrl(newPath)
      return
    }

    const oldDir = childDirFor(oldPath)
    const newDir = childDirFor(newPath)
    const prefix = `${oldDir}/`
    if (selectedPath.startsWith(prefix)) {
      const suffix = selectedPath.slice(prefix.length)
      setSelectedPathAndUrl(`${newDir}/${suffix}`)
    }
  }

  const movePageWithChildren = async (input: {
    oldPath: string
    newPath: string
    oldFile: {
      sha: string
      title: string
      icon: string
      cover: string
      body: string
    }
  }) => {
    const oldDir = childDirFor(input.oldPath)
    const newDir = childDirFor(input.newPath)
    const childPaths = childPathsFor(input.oldPath)
    const childFiles = await Promise.all(
      childPaths.map((path) =>
        getFile({
          data: {
            target: activeTarget,
            path,
          },
        }),
      ),
    )

    const movedRoot = await saveFile({
      data: {
        target: activeTarget,
        path: input.newPath,
        title: input.oldFile.title,
        icon: input.oldFile.icon,
        cover: input.oldFile.cover,
        body: input.oldFile.body,
      },
    })
    writeCachedMarkdownFile(activeTarget, input.newPath, {
      sha: movedRoot.sha,
      title: input.oldFile.title,
      icon: input.oldFile.icon,
      cover: input.oldFile.cover,
      body: input.oldFile.body,
    })
    deleteCachedMarkdownFile(activeTarget, input.oldPath)

    for (const child of childFiles) {
      const suffix = child.path.slice(`${oldDir}/`.length)
      const nextChildPath = `${newDir}/${suffix}`
      const movedChild = await saveFile({
        data: {
          target: activeTarget,
          path: nextChildPath,
          title: child.title,
          icon: child.icon,
          cover: child.cover,
          body: child.body,
        },
      })
      writeCachedMarkdownFile(activeTarget, nextChildPath, {
        sha: movedChild.sha,
        title: child.title,
        icon: child.icon,
        cover: child.cover,
        body: child.body,
      })
      deleteCachedMarkdownFile(activeTarget, child.path)
    }

    const deletes = [
      { path: input.oldPath, sha: input.oldFile.sha },
      ...childFiles.map((child) => ({ path: child.path, sha: child.sha })),
    ].sort((a, b) => b.path.length - a.path.length)

    for (const item of deletes) {
      await deleteFile({
        data: {
          target: activeTarget,
          path: item.path,
          sha: item.sha,
        },
      })
    }
  }

  const deletePageWithChildren = async (input: {
    path: string
    sha: string
  }) => {
    const childPaths = childPathsFor(input.path)
    const childFiles = await Promise.all(
      childPaths.map((path) =>
        getFile({
          data: {
            target: activeTarget,
            path,
          },
        }),
      ),
    )

    const deletes = [
      { path: input.path, sha: input.sha },
      ...childFiles.map((child) => ({ path: child.path, sha: child.sha })),
    ].sort((a, b) => b.path.length - a.path.length)

    for (const item of deletes) {
      await deleteFile({
        data: {
          target: activeTarget,
          path: item.path,
          sha: item.sha,
        },
      })
    }
  }

  if (authPending) {
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
    void navigate({ to: '/', replace: true })
    return (
      <main className="grid min-h-screen place-items-center p-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
          Redirecting...
        </div>
      </main>
    )
  }

  return (
    <SidebarProvider keyboardShortcut={false}>
      <Sidebar>
        <SidebarHeader>
          {isLoadingRepo ? (
            <>
              <Skeleton className="h-12 w-full rounded-md" />
              <div className="flex items-center gap-2">
                <Skeleton className="h-8 flex-1 rounded-md" />
                <Skeleton className="size-8 rounded-md" />
              </div>
            </>
          ) : (
            <>
              <SidebarMenu>
                <SidebarMenuItem>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
                        <Avatar className="size-8 rounded-md">
                          <AvatarImage src={`https://github.com/${owner}.png`} alt={owner} />
                          <AvatarFallback>{owner.slice(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <div className="grid flex-1 text-left text-sm leading-tight">
                          <span className="truncate font-medium">{owner}/{repo}</span>
                          <span className="truncate text-xs text-muted-foreground">{branch}</span>
                        </div>
                        <ChevronsUpDown className="ml-auto size-4" />
                      </SidebarMenuButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg" align="start" side="bottom" sideOffset={4}>
                      <DropdownMenuItem asChild>
                        <a href={repoUrl} target="_blank" rel="noreferrer">
                          Open on GitHub
                          <DropdownMenuShortcut>
                            <ExternalLink className="size-3.5" />
                          </DropdownMenuShortcut>
                        </a>
                      </DropdownMenuItem>
                      {recentRepoMenuItems.length > 0 ? (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuLabel className="text-xs text-muted-foreground">
                            Recent repositories
                          </DropdownMenuLabel>
                          {recentRepoMenuItems.map((item) => (
                            <DropdownMenuItem
                              key={`${item.owner}/${item.repo}/${item.branch}`}
                              onSelect={() => handleOpenRecentRepo(item)}
                            >
                              <img
                                src={`https://github.com/${item.owner}.png`}
                                alt={item.owner}
                                className="size-4 rounded-sm"
                              />
                              <span className="truncate">{item.repo}</span>
                            </DropdownMenuItem>
                          ))}
                          <DropdownMenuSeparator />
                        </>
                      ) : null}
                      <DropdownMenuItem onSelect={() => void navigate({ to: '/' })}>
                        Choose another repository
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </SidebarMenuItem>
              </SidebarMenu>

              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <SidebarInput
                    value={filterQuery}
                    onChange={(event) => setFilterQuery(event.target.value)}
                    placeholder="Search files"
                    className="h-8 pl-9"
                    disabled={!isAuthenticated}
                  />
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-8"
                      onClick={() => void handleCreate()}
                      disabled={!isAuthenticated || isSaving}
                    >
                      <Plus className="size-4" />
                      <span className="sr-only">Add page</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Add page</TooltipContent>
                </Tooltip>
              </div>
            </>
          )}
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            {isLoadingRepo ? (
              <div className="space-y-1">
                {Array.from({ length: 3 }).map((_, index) => (
                  <Skeleton
                    key={`sidebar-skeleton-${index}`}
                    className="h-7 w-full rounded-md"
                  />
                ))}
              </div>
            ) : (
                <TreeView
                  root={tree}
                  expandedFolders={expandedFolders}
                  onToggleFolder={toggleFolder}
                  onSelectFile={(path) => setSelectedPathAndUrl(path)}
                  selectedPath={selectedPath}
                  highlightedPath={highlightedPath}
                  fileSearch={filterQuery}
                  onCreateChild={(path) => void handleCreateChild(path)}
                  onRename={(path) => void handleRenamePath(path)}
                  onDelete={(path) => void handleDeletePath(path)}
                  toFileUrl={toFileUrl}
                />
            )}
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter>
          {isLoadingRepo ? (
            <Skeleton className="h-12 w-full rounded-md" />
          ) : (
            <SidebarMenu>
              <SidebarMenuItem>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
                      <Avatar className="size-8">
                        <AvatarImage src={`https://github.com/${owner}.png`} alt={owner} />
                        <AvatarFallback>{owner.slice(0, 2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <div className="grid flex-1 text-left text-sm leading-tight">
                        <span className="truncate font-medium">{authSession?.user?.name || authSession?.user?.email || 'User'}</span>
                        <span className="truncate text-xs text-muted-foreground">{authSession?.user?.email || ''}</span>
                      </div>
                      <ChevronsUpDown className="ml-auto size-4" />
                    </SidebarMenuButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg" align="end" side="top" sideOffset={4}>
                    <DropdownMenuItem onSelect={() => setIsAboutOpen(true)}>
                      About PullNotes
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      <DropdownMenuLabel className="text-xs text-muted-foreground">
                        Theme
                      </DropdownMenuLabel>
                      <DropdownMenuRadioGroup
                        value={themeMode}
                        onValueChange={(value) => setTheme(value as ThemeMode)}
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
                    {isAuthenticated ? (
                      <DropdownMenuItem variant="destructive" onSelect={() => void handleSignOut()}>
                        Sign out
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem onSelect={() => void handleSignIn()}>
                        <LogIn className="mr-2 size-4" />
                        Sign in
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </SidebarMenuItem>
            </SidebarMenu>
          )}
        </SidebarFooter>
      </Sidebar>

      <SidebarInset>
        <div className="flex min-h-svh flex-col">
          {isLoadingRepo || files.length > 0 ? (
            <div className="sticky top-0 z-20 flex h-12 items-center justify-between bg-background px-4">
              <div className="flex min-w-0 items-center gap-2">
                <SidebarTrigger className="md:hidden" />
                <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4 md:hidden" />
                {selectedPath ? (
                  <Breadcrumb>
                    <BreadcrumbList className="gap-1 text-sm">
                      {breadcrumbs.map((crumb, index) => {
                        const isLast = index === breadcrumbs.length - 1
                        return (
                          <Fragment key={crumb.path}>
                            <BreadcrumbItem className="min-w-0">
                              {isLast ? (
                                <BreadcrumbPage className="flex min-w-0 items-center gap-1">
                                  {crumb.icon ? (
                                    <span className="inline-flex size-4 shrink-0 items-center justify-center text-sm leading-none">
                                      {crumb.icon}
                                    </span>
                                  ) : null}
                                  <span className="truncate">{crumb.label}</span>
                                </BreadcrumbPage>
                              ) : (
                                <BreadcrumbLink asChild>
                                  <button
                                    type="button"
                                    onClick={() => setSelectedPathAndUrl(crumb.path)}
                                    className="flex min-w-0 items-center gap-1"
                                  >
                                    {crumb.icon ? (
                                      <span className="inline-flex size-4 shrink-0 items-center justify-center text-sm leading-none">
                                        {crumb.icon}
                                      </span>
                                    ) : null}
                                    <span className="truncate">{crumb.label}</span>
                                  </button>
                                </BreadcrumbLink>
                              )}
                            </BreadcrumbItem>
                            {!isLast ? <BreadcrumbSeparator /> : null}
                          </Fragment>
                        )
                      })}
                    </BreadcrumbList>
                  </Breadcrumb>
                ) : (
                  <div className="truncate text-sm font-medium">
                    {isLoadingRepo ? <Skeleton className="h-5 w-30 rounded-md" /> : 'No file selected'}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                {recentCommits[0] ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="hidden h-7 items-center gap-2 px-2 text-xs sm:flex text-muted-foreground"
                      >
                        {recentCommits[0].authorAvatarUrl ? (
                          <img
                            src={recentCommits[0].authorAvatarUrl}
                            alt={recentCommits[0].authorName}
                            className="size-5 rounded-full"
                          />
                        ) : null}
                        <span>{formatRelativeTime(recentCommits[0].date)}</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" side="bottom" sideOffset={6}>
                      {recentCommits.map((commit) => (
                        <DropdownMenuItem key={commit.sha} asChild>
                          <a
                            href={`https://github.com/${owner}/${repo}/commit/${commit.sha}`}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-2"
                          >
                            {commit.authorAvatarUrl ? (
                              <img
                                src={commit.authorAvatarUrl}
                                alt={commit.authorName}
                                className="size-4 rounded-full"
                              />
                            ) : null}
                            <span className="text-sm">{formatRelativeTime(commit.date)}</span>
                          </a>
                        </DropdownMenuItem>
                      ))}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem asChild>
                        <a href={commitsUrl} target="_blank" rel="noreferrer">
                          View all commits
                        </a>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
                <div className="inline-flex items-center">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 rounded-r-none px-2 text-xs"
                    onClick={() => void handleSave()}
                    disabled={!canSave}
                  >
                    Save
                    <span className="ml-2 inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                      <Command className="size-3" />
                      <span>S</span>
                    </span>
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 w-7 rounded-l-none border-l-0 p-0"
                    onClick={handleResetChanges}
                    disabled={!isDirty || !isSelectedFileLoaded || isSaving}
                    title="Discard all unsaved changes"
                    aria-label="Discard all unsaved changes"
                  >
                    <Undo2 className="size-3.5" />
                  </Button>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 w-7 p-0"
                      disabled={!selectedPath || !sha || isSaving}
                    >
                      <Ellipsis className="size-4" />
                      <span className="sr-only">Page actions</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" side="bottom" sideOffset={6}>
                    {fileUrl ? (
                      <DropdownMenuItem asChild>
                        <a href={fileUrl} target="_blank" rel="noreferrer">
                          Open on GitHub
                          <DropdownMenuShortcut>
                            <ExternalLink className="size-3.5" />
                          </DropdownMenuShortcut>
                        </a>
                      </DropdownMenuItem>
                    ) : null}
                    {fileUrl ? <DropdownMenuSeparator /> : null}
                    {selectedPath ? (
                      <DropdownMenuItem onSelect={() => void handleCreateChild(selectedPath)}>
                        Add child
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem onSelect={() => void handleRename()}>
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => void handleDelete()}>
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ) : null}

          <div className="flex min-h-0 flex-1 flex-col">
            {errorMessage ? (
              <div className="bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {errorMessage}
              </div>
            ) : null}

            {!isAuthenticated ? (
              <div className="grid flex-1 place-items-center text-muted-foreground">
                Sign in with GitHub to edit content.
              </div>
            ) : isLoadingRepo ? (
              <div className="flex flex-1">
                <div className="mx-auto w-full max-w-2xl px-6 pt-6">
                  <Skeleton className="h-12 mt-24 w-full rounded-md" />
                </div>
              </div>
            ) : files.length === 0 ? (
              <div className="grid flex-1 place-items-center p-6">
                <Empty className="max-w-md">
                  <EmptyHeader>
                    <EmptyTitle>No pages yet</EmptyTitle>
                    <EmptyDescription>This repository is empty. Create your first page to start editing.</EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    <Button type="button" onClick={() => void handleCreate()}>
                      Add a page
                      <Plus />
                    </Button>
                  </EmptyContent>
                </Empty>
              </div>
            ) : !selectedPath ? (
              <div className="grid flex-1 place-items-center text-muted-foreground">
                Select a file from the left
              </div>
            ) : isLoadingFile ? (
              <div className="flex flex-1">
                <div className="mx-auto w-full max-w-2xl px-6 pt-6">
                  <Skeleton className="h-12 mt-24 w-full rounded-md" />
                </div>
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col">
              <div ref={editorRegionRef} className={`w-full pb-10 ${cover ? '' : 'pt-20'}`}>
                {cover ? (
                  <div className="group/cover relative mb-2 w-full">
                    <img
                      src={cover}
                      alt="Cover"
                      onLoad={() => setCoverLayoutTick((value) => value + 1)}
                      onError={() => setCoverLayoutTick((value) => value + 1)}
                      className="h-64 w-full object-cover"
                    />
                    <div className="absolute top-3 right-3 flex items-center gap-2 opacity-0 transition-opacity group-hover/cover:opacity-100">
                      <Popover
                        open={isCoverPopoverOpen}
                        onOpenChange={(open) => {
                          setIsCoverPopoverOpen(open)
                          if (!open) {
                            setCoverQuery('')
                            setCoverSearchError(null)
                          }
                        }}
                      >
                        <PopoverTrigger asChild>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            className="h-7 px-2 text-xs text-muted-foreground"
                          >
                            Change cover
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[30rem] p-2" align="end" sideOffset={8}>
                          <div className="space-y-2">
                            <div className="relative">
                              <Input
                                value={coverQuery}
                                onChange={(event) => setCoverQuery(event.target.value)}
                                placeholder="Search Pexels"
                                className="h-7 pr-8"
                              />
                              {isCoverSearchLoading ? (
                                <Loader2 className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
                              ) : null}
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              {isCoverSearchLoading
                                ? COVER_RESULT_SKELETON_IDS.map((id) => (
                                    <Skeleton key={`cover-result-skeleton-${id}`} className="h-24 w-full rounded-md" />
                                  ))
                                : coverResults.map((item) => (
                                    <button
                                      key={item.id}
                                      type="button"
                                      className="group/image relative overflow-hidden rounded-md border text-left"
                                      onClick={() => handleSetCover(item.fullUrl)}
                                      title={item.alt}
                                    >
                                      <img
                                        src={item.previewUrl}
                                        alt={item.alt}
                                        className="h-24 w-full object-cover transition-transform group-hover/image:scale-[1.02]"
                                      />
                                    </button>
                                  ))}
                            </div>
                            {!isCoverSearchLoading && coverSearchError ? (
                              <p className="text-xs text-destructive">{coverSearchError}</p>
                            ) : null}
                            {!isCoverSearchLoading && !coverSearchError && coverResults.length === 0 ? (
                              <p className="text-xs text-muted-foreground">No covers found.</p>
                            ) : null}
                          </div>
                        </PopoverContent>
                      </Popover>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="h-7 px-2 text-xs text-muted-foreground"
                        onClick={() => setCover('')}
                      >
                        Remove cover
                      </Button>
                    </div>
                  </div>
                ) : null}

                {icon ? (
                  <div className="relative mx-auto w-full max-w-2xl px-6">
                    <Popover
                      open={isEmojiPopoverOpen}
                      onOpenChange={(open) => {
                        setIsEmojiPopoverOpen(open)
                        if (!open) {
                          setEmojiQuery('')
                        }
                      }}
                    >
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          className={`${cover ? '-mt-[39px]' : 'mt-0'} z-10 mb-2 h-auto inline-flex items-center justify-center rounded-lg p-0 text-6xl leading-none`}
                          aria-label="Change icon"
                        >
                          {icon}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-80 p-2" align="start" sideOffset={8}>
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <Input
                              value={emojiQuery}
                              onChange={(event) => setEmojiQuery(event.target.value)}
                              placeholder="Search emoji"
                              className="h-7"
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-xs text-muted-foreground"
                              onClick={() => handleSetIcon('')}
                            >
                              Remove
                            </Button>
                          </div>
                          <ScrollArea className="h-36">
                            <div className="grid grid-cols-8 gap-1 pr-2">
                              {filteredEmojiOptions.map((item) => (
                                <button
                                  key={item.unicode}
                                  type="button"
                                  title={item.label}
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-lg hover:bg-accent"
                                  onClick={() => handleSetIcon(item.unicode)}
                                >
                                  {item.unicode}
                                </button>
                              ))}
                            </div>
                            {isEmojiSearchLoading && emojiQuery.trim() ? (
                              <p className="p-2 text-xs text-muted-foreground">Searching emojis…</p>
                            ) : null}
                            {!isEmojiSearchLoading && filteredEmojiOptions.length === 0 ? (
                              <p className="p-2 text-xs text-muted-foreground">No emojis found.</p>
                            ) : null}
                          </ScrollArea>
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                ) : null}

                <div className="mx-auto w-full max-w-2xl px-6">
                  <div className={`group/title relative ${cover ? 'z-10' : ''}`}>
                    <div className="pointer-events-none absolute top-0 left-0 flex h-7 items-center gap-1 opacity-0 transition-opacity group-hover/title:opacity-100 group-hover/title:pointer-events-auto group-focus-within/title:opacity-100 group-focus-within/title:pointer-events-auto">
                    {!icon ? (
                      <Popover
                        open={isEmojiPopoverOpen}
                        onOpenChange={(open) => {
                          setIsEmojiPopoverOpen(open)
                          if (!open) {
                            setEmojiQuery('')
                          }
                        }}
                      >
                        <PopoverTrigger asChild>
                          <Button type="button" variant="secondary" size="sm" className="h-7 px-2 text-xs text-muted-foreground">
                            <SmilePlus className="size-4" />
                            Add icon
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-80 p-2" align="start" sideOffset={8}>
                          <div className="space-y-2">
                            <div className="flex items-center gap-1">
                              <Input
                                value={emojiQuery}
                                onChange={(event) => setEmojiQuery(event.target.value)}
                                placeholder="Search emoji"
                                className="h-7"
                              />
                            </div>
                            <ScrollArea className="h-36">
                              <div className="grid grid-cols-8 gap-1 pr-2">
                                {filteredEmojiOptions.map((item) => (
                                  <button
                                    key={item.unicode}
                                    type="button"
                                    title={item.label}
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-lg hover:bg-accent"
                                    onClick={() => handleSetIcon(item.unicode)}
                                  >
                                    {item.unicode}
                                  </button>
                                ))}
                              </div>
                              {isEmojiSearchLoading && emojiQuery.trim() ? (
                                <p className="p-2 text-xs text-muted-foreground">Searching emojis…</p>
                              ) : null}
                              {!isEmojiSearchLoading && filteredEmojiOptions.length === 0 ? (
                                <p className="p-2 text-xs text-muted-foreground">No emojis found.</p>
                              ) : null}
                            </ScrollArea>
                          </div>
                        </PopoverContent>
                      </Popover>
                    ) : null}

                    {!cover ? (
                      <Popover
                        open={isCoverPopoverOpen}
                        onOpenChange={(open) => {
                          setIsCoverPopoverOpen(open)
                          if (!open) {
                            setCoverQuery('')
                            setCoverSearchError(null)
                          }
                        }}
                      >
                        <PopoverTrigger asChild>
                          <Button type="button" variant="secondary" size="sm" className="h-7 px-2 text-xs text-muted-foreground">
                            <ImagePlus className="size-4" />
                            Add cover
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[30rem] p-2" align="start" sideOffset={8}>
                          <div className="space-y-2">
                            <div className="relative">
                              <Input
                                value={coverQuery}
                                onChange={(event) => setCoverQuery(event.target.value)}
                                placeholder="Search Pexels"
                                className="h-7 pr-8"
                              />
                              {isCoverSearchLoading ? (
                                <Loader2 className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
                              ) : null}
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              {isCoverSearchLoading
                                ? COVER_RESULT_SKELETON_IDS.map((id) => (
                                    <Skeleton key={`cover-result-skeleton-${id}`} className="h-24 w-full rounded-md" />
                                  ))
                                : coverResults.map((item) => (
                                    <button
                                      key={item.id}
                                      type="button"
                                      className="group/image relative overflow-hidden rounded-md border text-left"
                                      onClick={() => handleSetCover(item.fullUrl)}
                                      title={item.alt}
                                    >
                                      <img
                                        src={item.previewUrl}
                                        alt={item.alt}
                                        className="h-24 w-full object-cover transition-transform group-hover/image:scale-[1.02]"
                                      />
                                    </button>
                                  ))}
                            </div>
                            {!isCoverSearchLoading && coverSearchError ? (
                              <p className="text-xs text-destructive">{coverSearchError}</p>
                            ) : null}
                            {!isCoverSearchLoading && !coverSearchError && coverResults.length === 0 ? (
                              <p className="text-xs text-muted-foreground">No covers found.</p>
                            ) : null}
                          </div>
                        </PopoverContent>
                      </Popover>
                    ) : null}
                  </div>

                  <textarea
                    ref={titleInputRef}
                    value={title}
                    onChange={(event) => {
                      setTitle(event.target.value)
                      if (hasLoadedFile && loadedPath === selectedPath && !isLoadingFile) {
                        setHasUserEdits(true)
                      }
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        const input = event.currentTarget
                        const selectionStart = input.selectionStart ?? title.length
                        const selectionEnd = input.selectionEnd ?? selectionStart
                        const nextTitle = title.slice(0, selectionStart)
                        const movedToBody = title.slice(selectionEnd)
                        const nextBody = movedToBody
                          ? body
                            ? `${movedToBody}\n${body}`
                            : movedToBody
                          : body

                        if (nextTitle !== title || nextBody !== body) {
                          setHasUserEdits(true)
                        }

                        setTitle(nextTitle)
                        setBody(nextBody)

                        window.requestAnimationFrame(() => {
                          if (!editorInstance) {
                            focusEditor()
                            return
                          }
                          editorInstance.chain().focus().setTextSelection(1).run()
                        })
                        return
                      }
                      if (event.key === 'ArrowDown') {
                        event.preventDefault()
                        focusEditor()
                      }
                    }}
                    placeholder="Title"
                    rows={1}
                    className="field-sizing-content w-full resize-none border-0 bg-transparent px-0 py-8 text-4xl font-extrabold tracking-tight text-balance leading-tight outline-none placeholder:text-muted-foreground focus:outline-none"
                  />

                    {titleMissing ? (
                      <p className="pb-2 text-sm text-destructive">Title is required.</p>
                    ) : null}
                  </div>
                </div>

                <div className="mx-auto w-full max-w-2xl px-6">
                  <div className="flex-1 min-h-[280px]">
                    <Editor
                      className="cn-editor h-full"
                      editorClassName="h-full min-h-full border-0 bg-transparent px-0 pt-2 pb-10 text-base leading-7 shadow-none focus-visible:ring-0 focus-visible:border-transparent"
                      format="markdown"
                      value={bodyForEditor}
                      onChange={handleBodyChange}
                      onArrowUpAtStart={focusTitleInput}
                      onBackspaceAtStart={mergeFirstBodyLineIntoTitle}
                      enableImagePasteDrop
                      onUploadImage={async (file) => {
                        const uploaded = await uploadImageToRepo(file)
                        return { src: uploaded.editorPath, alt: file.name || undefined }
                      }}
                      onRequestImage={async () => {
                        const file = await chooseImageFile()
                        if (!file) return null
                        return {
                          kind: 'file',
                          file,
                          ...(file.name ? { alt: file.name } : {}),
                        } as const
                      }}
                      onPendingUploadsChange={setPendingImageUploads}
                      onSlashCommandOpenChange={setIsSlashCommandOpen}
                      onEditorReady={setEditorInstance}
                      onTocChange={({ items, activeId }) => {
                        setTocItems(items)
                        setActiveTocId(activeId)
                      }}
                    />
                  </div>
                </div>

                {tocItems.length > 1 ? (
                  <div className="fixed right-6 z-30 hidden 2xl:block" style={{ top: `${tocTop}px` }}>
                    <div className="group/toc relative">
                      <div className="flex justify-end transition-opacity duration-200 group-hover/toc:opacity-0 group-focus-within/toc:opacity-0">
                        <div className="flex flex-col items-end gap-3">
                          {tocItems.map((item) => (
                            <button
                              key={`${item.id}-mini`}
                              type="button"
                              title={item.text}
                              onClick={() => {
                                if (!editorInstance) return
                                editorInstance.chain().focus().setTextSelection(item.pos).run()
                              }}
                              className={`block h-0.5 rounded-full transition-colors ${
                                item.level === 1 ? 'w-5' : item.level === 2 ? 'w-4' : 'w-3'
                              } ${
                                activeTocId === item.id
                                  ? 'bg-foreground'
                                  : 'bg-muted-foreground/45 hover:bg-muted-foreground/70'
                              }`}
                            />
                          ))}
                        </div>
                      </div>

                      <aside className="absolute top-0 right-0 z-10 max-h-[calc(100vh-4rem)] w-60 overflow-y-auto rounded-md border bg-background/90 p-3 opacity-0 shadow-sm backdrop-blur-sm transition-all duration-200 group-hover/toc:pointer-events-auto group-hover/toc:translate-x-0 group-hover/toc:opacity-100 group-focus-within/toc:pointer-events-auto group-focus-within/toc:translate-x-0 group-focus-within/toc:opacity-100 pointer-events-none translate-x-3">
                        <div className="space-y-0.5">
                          {tocItems.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => {
                                if (!editorInstance) return
                                editorInstance.chain().focus().setTextSelection(item.pos).run()
                              }}
                              className={`truncate rounded-sm px-2 py-1 text-left text-xs transition-colors ${
                                activeTocId === item.id
                                  ? 'text-foreground'
                                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                              }`}
                              style={{
                                marginLeft: `${Math.max(0, item.level - 2) * 10}px`,
                                width: `calc(100% - ${Math.max(0, item.level - 2) * 10}px)`,
                              }}
                            >
                              {item.text}
                            </button>
                          ))}
                        </div>
                      </aside>
                    </div>
                  </div>
                ) : null}
              </div>
              </div>
            )}
          </div>
        </div>
      </SidebarInset>
      <AboutPullNotesDialog open={isAboutOpen} onOpenChange={setIsAboutOpen} />
    </SidebarProvider>
  )
}

function TreeView(props: {
  root: FolderNode
  expandedFolders: Set<string>
  onToggleFolder: (path: string) => void
  onSelectFile: (path: string) => void
  selectedPath: string | null
  highlightedPath: string | null
  fileSearch: string
  onCreateChild: (path: string) => void
  onRename: (path: string) => void
  onDelete: (path: string) => void
  toFileUrl: (path: string) => string
}) {
  const fileMap = useMemo(() => {
    const files = flattenFiles(props.root)
    return new Map(files.map((file) => [file.path, file]))
  }, [props.root])

  const searchTerm = props.fileSearch.trim().toLowerCase()
  const rootNode = {
    ...props.root,
    files: props.root.files.filter((file) => !file.path.includes('/')),
    folders: props.root.folders,
  }

  return (
    <SidebarMenu>
      {renderFolderNode({
        folder: rootNode,
        depth: 0,
        fileMap,
        expandedFolders: props.expandedFolders,
        onToggleFolder: props.onToggleFolder,
        onSelectFile: props.onSelectFile,
        selectedPath: props.selectedPath,
        highlightedPath: props.highlightedPath,
        searchTerm,
        onCreateChild: props.onCreateChild,
        onRename: props.onRename,
        onDelete: props.onDelete,
        toFileUrl: props.toFileUrl,
      })}
    </SidebarMenu>
  )
}

function renderFolderNode(args: {
  folder: FolderNode
  depth: number
  fileMap: Map<string, MarkdownFile>
  expandedFolders: Set<string>
  onToggleFolder: (path: string) => void
  onSelectFile: (path: string) => void
  selectedPath: string | null
  highlightedPath: string | null
  searchTerm: string
  onCreateChild: (path: string) => void
  onRename: (path: string) => void
  onDelete: (path: string) => void
  toFileUrl: (path: string) => string
}) {
  const {
    folder,
    depth,
    fileMap,
    expandedFolders,
    onToggleFolder,
    onSelectFile,
    selectedPath,
    highlightedPath,
    searchTerm,
    onCreateChild,
    onRename,
    onDelete,
    toFileUrl,
  } = args

  const subfolderByParentFilePath = new Map<string, FolderNode>(
    folder.folders.map((subfolder) => [`${subfolder.path}.md`, subfolder]),
  )

  const fileItems = folder.files
    .filter((file) => {
      const subfolder = subfolderByParentFilePath.get(file.path)
      if (!subfolder) return matchesSearch(file.path, searchTerm)
      return matchesSearch(file.path, searchTerm) || hasMatchingChild(subfolder, searchTerm)
    })
    .map((file) => (
      <SidebarMenuItem key={file.path}>
        <SidebarMenuButton
          isActive={selectedPath === file.path}
          onClick={() => {
            onSelectFile(file.path)
            const subfolder = subfolderByParentFilePath.get(file.path)
            if (
              subfolder &&
              !isFolderAutoExpandedBySelection(subfolder.path, selectedPath) &&
              !expandedFolders.has(subfolder.path)
            ) {
              onToggleFolder(subfolder.path)
            }
          }}
          className={`[&>svg]:text-muted-foreground hover:[&_[data-tree-icon=default]]:opacity-0 hover:[&_[data-tree-icon=chevron]]:opacity-100 transition-colors ${
            highlightedPath === file.path ? 'bg-sidebar-accent/60' : ''
          }`}
          style={{ paddingLeft: `${depth * 14 + 8}px` }}
        >
          {subfolderByParentFilePath.has(file.path) ? (
            <span className="relative inline-flex size-4 shrink-0 items-center justify-center">
              {!file.icon.trim() ? (
                <FileText data-tree-icon="default" className="size-4 text-muted-foreground transition-opacity" />
              ) : (
                <span data-tree-icon="default" className="inline-flex size-4 items-center justify-center text-sm leading-none transition-opacity">
                  {file.icon.trim()}
                </span>
              )}
              <span
                role="button"
                onClick={(event) => {
                  event.stopPropagation()
                  const subfolder = subfolderByParentFilePath.get(file.path)
                  if (subfolder) onToggleFolder(subfolder.path)
                }}
                data-tree-icon="chevron"
                className="absolute inset-0 inline-flex items-center justify-center opacity-0 transition-opacity"
              >
                {isFolderExpanded(
                  subfolderByParentFilePath.get(file.path)?.path ?? '',
                  selectedPath,
                  expandedFolders,
                ) ? (
                  <ChevronDown className="size-3.5 text-muted-foreground" />
                ) : (
                  <ChevronRight className="size-3.5 text-muted-foreground" />
                )}
              </span>
            </span>
          ) : !file.icon.trim() ? (
            <FileText className="size-4 shrink-0" />
          ) : (
            <span className="inline-flex size-4 shrink-0 items-center justify-center text-sm leading-none">
              {file.icon.trim()}
            </span>
          )}
          <span>{entryTitle(file)}</span>
        </SidebarMenuButton>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuAction className="right-2 text-muted-foreground peer-hover/menu-button:text-muted-foreground hover:text-foreground data-[state=open]:text-foreground">
              <Ellipsis />
              <span className="sr-only">Page options</span>
            </SidebarMenuAction>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="right" sideOffset={6}>
            <DropdownMenuItem asChild>
              <a href={toFileUrl(file.path)} target="_blank" rel="noreferrer">
                Open on GitHub
                <DropdownMenuShortcut>
                  <ExternalLink className="size-3.5" />
                </DropdownMenuShortcut>
              </a>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onCreateChild(file.path)}>
              Add child
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onRename(file.path)}>
              Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => onDelete(file.path)}>
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {(() => {
          const subfolder = subfolderByParentFilePath.get(file.path)
          if (!subfolder || !isFolderExpanded(subfolder.path, selectedPath, expandedFolders)) return null
          return (
            <SidebarMenuSub className="mr-0 pr-0">
              {renderFolderNode({
                folder: subfolder,
                depth: depth + 1,
                fileMap,
                expandedFolders,
                onToggleFolder,
                onSelectFile,
                selectedPath,
                highlightedPath,
                searchTerm,
                onCreateChild,
                onRename,
                onDelete,
                toFileUrl,
              })}
            </SidebarMenuSub>
          )
        })()}
      </SidebarMenuItem>
    ))

  const folderItems = folder.folders
    .map((subfolder) => {
      const parentFilePath = `${subfolder.path}.md`
      const parentFileExists = fileMap.has(parentFilePath)
      const isExpanded = isFolderExpanded(subfolder.path, selectedPath, expandedFolders)
      const hasVisibleChild = hasMatchingChild(subfolder, searchTerm)

      if (parentFileExists || !hasVisibleChild) {
        return null
      }

      return (
        <SidebarMenuItem key={subfolder.path}>
          <SidebarMenuButton
            onClick={() => onToggleFolder(subfolder.path)}
            style={{ paddingLeft: `${depth * 14 + 8}px` }}
          >
            {isExpanded ? (
              <ChevronDown className="size-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-3.5 text-muted-foreground" />
            )}
            <span>{subfolder.name}</span>
          </SidebarMenuButton>
          {isExpanded ? (
            <SidebarMenuSub className="mr-0 pr-0">
              {renderFolderNode({
                folder: subfolder,
                depth: depth + 1,
                fileMap,
                expandedFolders,
                onToggleFolder,
                onSelectFile,
                selectedPath,
                highlightedPath,
                searchTerm,
                onCreateChild,
                onRename,
                onDelete,
                toFileUrl,
              })}
            </SidebarMenuSub>
          ) : null}
        </SidebarMenuItem>
      )
    })
    .filter(Boolean)

  return (
    <>
      {fileItems}
      {folderItems}
    </>
  )
}

function buildTree(files: MarkdownFile[]): FolderNode {
  const root: FolderNode = {
    path: '',
    name: '',
    files: [],
    folders: [],
  }

  const folderMap = new Map<string, FolderNode>([['', root]])

  const ensureFolder = (path: string) => {
    if (folderMap.has(path)) return folderMap.get(path)!

    const parentPath = dirname(path)
    const parent = ensureFolder(parentPath)
    const nextFolder: FolderNode = {
      path,
      name: basename(path),
      files: [],
      folders: [],
    }
    parent.folders.push(nextFolder)
    folderMap.set(path, nextFolder)
    return nextFolder
  }

  for (const file of files) {
    const folderPath = dirname(file.path)
    const folder = ensureFolder(folderPath)
    folder.files.push(file)
  }

  const sortNode = (node: FolderNode) => {
    node.files.sort((a, b) => a.path.localeCompare(b.path))
    node.folders.sort((a, b) => a.path.localeCompare(b.path))
    node.folders.forEach(sortNode)
  }

  sortNode(root)

  root.files = files.filter((file) => !file.path.includes('/'))

  return root
}

const FILE_CACHE_PREFIX = 'pullnotes:md-file-cache:v1'

function buildTargetCachePrefix(target: RepoTargetInput): string {
  return [
    FILE_CACHE_PREFIX,
    encodeURIComponent(target.owner || ''),
    encodeURIComponent(target.repo || ''),
    encodeURIComponent(target.branch || ''),
    encodeURIComponent((target.rootPath || '').replace(/^\/+|\/+$/g, '')),
  ].join(':')
}

function buildFileCacheKey(target: RepoTargetInput, path: string): string {
  return `${buildTargetCachePrefix(target)}:${encodeURIComponent(path)}`
}

function readCachedMarkdownFile(
  target: RepoTargetInput,
  path: string,
): CachedMarkdownFile | null {
  if (typeof window === 'undefined') return null

  try {
    const raw = window.localStorage.getItem(buildFileCacheKey(target, path))
    if (!raw) return null
    const parsed = JSON.parse(raw) as CachedMarkdownFile
    if (
      parsed &&
      parsed.version === 1 &&
      typeof parsed.sha === 'string' &&
      typeof parsed.title === 'string' &&
      typeof parsed.icon === 'string' &&
      typeof parsed.cover === 'string' &&
      typeof parsed.body === 'string'
    ) {
      return parsed
    }
  } catch {
    return null
  }

  return null
}

function writeCachedMarkdownFile(
  target: RepoTargetInput,
  path: string,
  input: {
    sha: string
    title: string
    icon: string
    cover: string
    body: string
  },
) {
  if (typeof window === 'undefined') return
  try {
    const payload: CachedMarkdownFile = {
      version: 1,
      sha: input.sha,
      title: input.title,
      icon: input.icon,
      cover: input.cover,
      body: input.body,
      updatedAt: Date.now(),
    }
    window.localStorage.setItem(buildFileCacheKey(target, path), JSON.stringify(payload))
  } catch {
    // Ignore localStorage write failures (quota/private mode).
  }
}

function deleteCachedMarkdownFile(target: RepoTargetInput, path: string) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(buildFileCacheKey(target, path))
  } catch {
    // Ignore localStorage remove failures.
  }
}

function dirname(path: string): string {
  const index = path.lastIndexOf('/')
  return index === -1 ? '' : path.slice(0, index)
}

function basename(path: string): string {
  const index = path.lastIndexOf('/')
  return index === -1 ? path : path.slice(index + 1)
}

function fileLabel(path: string): string {
  return basename(path).replace(/\.md$/i, '')
}

function entryTitle(entry: MarkdownFile): string {
  return entry.title.trim() || fileLabel(entry.path)
}

function toSlug(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '')
}

function expandParents(
  path: string,
  setExpandedFolders: Dispatch<SetStateAction<Set<string>>>,
) {
  const dirs = dirname(path).split('/').filter(Boolean)
  const next = ['']

  for (let index = 0; index < dirs.length; index++) {
    next.push(dirs.slice(0, index + 1).join('/'))
  }

  setExpandedFolders((prev) => {
    const merged = new Set(prev)
    for (const dir of next) merged.add(dir)
    return merged
  })
}

function isFolderAutoExpandedBySelection(folderPath: string, selectedPath: string | null): boolean {
  if (!selectedPath || !folderPath) return false
  return selectedPath === `${folderPath}.md` || selectedPath.startsWith(`${folderPath}/`)
}

function isFolderExpanded(
  folderPath: string,
  selectedPath: string | null,
  expandedFolders: Set<string>,
): boolean {
  return expandedFolders.has(folderPath) || isFolderAutoExpandedBySelection(folderPath, selectedPath)
}

function readRecentReposFromStorage(): RecentRepoItem[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(RECENT_REPOS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []

    return parsed.filter((item): item is RecentRepoItem => {
      return Boolean(
        item &&
          typeof item === 'object' &&
          typeof (item as RecentRepoItem).owner === 'string' &&
          typeof (item as RecentRepoItem).repo === 'string' &&
          typeof (item as RecentRepoItem).branch === 'string' &&
          typeof (item as RecentRepoItem).visitedAt === 'string',
      )
    })
  } catch {
    return []
  }
}

function writeRecentReposToStorage(value: RecentRepoItem[]) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(RECENT_REPOS_STORAGE_KEY, JSON.stringify(value))
  } catch {
    // ignore storage write errors
  }
}

function flattenFiles(folder: FolderNode): MarkdownFile[] {
  return [...folder.files, ...folder.folders.flatMap(flattenFiles)]
}

function matchesSearch(path: string, searchTerm: string): boolean {
  if (!searchTerm) return true
  return path.toLowerCase().includes(searchTerm)
}

function hasMatchingChild(folder: FolderNode, searchTerm: string): boolean {
  if (!searchTerm) return true
  if (folder.files.some((file) => matchesSearch(file.path, searchTerm))) return true
  return folder.folders.some((subfolder) => hasMatchingChild(subfolder, searchTerm))
}

function isAllowedCoverUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.hostname === 'images.pexels.com' ||
      url.hostname === 'images.unsplash.com' ||
      url.hostname === 'source.unsplash.com' ||
      url.hostname.endsWith('.unsplash.com')
    )
  } catch {
    return false
  }
}

function normalizeBodyForCompare(value: string): string {
  return value.replace(/\r\n/g, '\n').trimEnd()
}

function decodePathFromUrl(path: string): string {
  return path
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment)
      } catch {
        return segment
      }
    })
    .join('/')
}

function mapImageSourcesInMarkdown(markdown: string, map: (src: string) => string): string {
  let next = markdown

  next = next.replace(/!\[([^\]]*)\]\(([^)\s]+)(\s+"[^"]*")?\)/g, (_, alt: string, src: string, title: string | undefined) => {
    const mapped = map(src)
    return `![${alt}](${mapped}${title || ''})`
  })

  next = next.replace(/<img[^>]*\s+src=(["'])([^"']+)\1[^>]*>/g, (full: string, quote: string, src: string) => {
    const mapped = map(src)
    return full.replace(`src=${quote}${src}${quote}`, `src=${quote}${mapped}${quote}`)
  })

  return next
}

function getImageSourcesInMarkdown(markdown: string): string[] {
  const sources: string[] = []
  const markdownRegex = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
  const htmlRegex = /<img[^>]*\s+src=(["'])([^"']+)\1[^>]*>/g

  for (const match of markdown.matchAll(markdownRegex)) {
    if (match[1]) sources.push(match[1])
  }
  for (const match of markdown.matchAll(htmlRegex)) {
    if (match[2]) sources.push(match[2])
  }

  return sources
}

function getFileName(path: string): string {
  const trimmed = path.replace(/^\/+|\/+$/g, '')
  if (!trimmed) return ''
  const index = trimmed.lastIndexOf('/')
  return index >= 0 ? trimmed.slice(index + 1) : trimmed
}

function getParentPath(path: string): string {
  const trimmed = path.replace(/^\/+|\/+$/g, '')
  if (!trimmed) return ''
  const index = trimmed.lastIndexOf('/')
  if (index <= 0) return ''
  return trimmed.slice(0, index)
}

function toGitHubImageUrl(input: {
  owner: string
  repo: string
  branch: string
  rootPath: string
  relativePath: string
}): string {
  const src = input.relativePath.trim()
  if (!src) return src
  if (isNonRelativeUrl(src)) return src

  const relativePath = src.replace(/^\/+/, '')
  if (!relativePath) return src
  const rootPath = input.rootPath.replace(/^\/+|\/+$/g, '')
  const repoPath = rootPath ? `${rootPath}/${relativePath}` : relativePath

  return `https://raw.githubusercontent.com/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/${encodeURIComponent(input.branch)}/${encodeURI(repoPath)}`
}

function fromRenderedImageUrl(input: {
  owner: string
  repo: string
  branch: string
  rootPath: string
  renderedPath: string
}): string {
  const src = input.renderedPath.trim()
  if (!src) return src

  const rawPrefix = `https://raw.githubusercontent.com/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/${encodeURIComponent(input.branch)}/`
  const mediaPrefix = `https://media.githubusercontent.com/media/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/${encodeURIComponent(input.branch)}/`
  if (src.startsWith(rawPrefix)) {
    const [rawPath] = src.slice(rawPrefix.length).split('?')
    return normalizeStoredImagePath(trimImageRootPath(decodePathFromUrl(rawPath), input.rootPath))
  }
  if (src.startsWith(mediaPrefix)) {
    const [rawPath] = src.slice(mediaPrefix.length).split('?')
    return normalizeStoredImagePath(trimImageRootPath(decodePathFromUrl(rawPath), input.rootPath))
  }

  const proxyPrefix = `/api/media/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/${encodeURIComponent(input.branch)}/`
  if (src.startsWith(proxyPrefix)) {
    const [encodedPath] = src.slice(proxyPrefix.length).split('?')
    return decodePathFromUrl(encodedPath)
  }

  try {
    const parsed = new URL(src)
    if (parsed.href.startsWith(rawPrefix)) {
      const [rawPath] = parsed.href.slice(rawPrefix.length).split('?')
      return normalizeStoredImagePath(trimImageRootPath(decodePathFromUrl(rawPath), input.rootPath))
    }
    if (parsed.href.startsWith(mediaPrefix)) {
      const [rawPath] = parsed.href.slice(mediaPrefix.length).split('?')
      return normalizeStoredImagePath(trimImageRootPath(decodePathFromUrl(rawPath), input.rootPath))
    }
    if (parsed.pathname.startsWith(proxyPrefix)) {
      const encodedPath = parsed.pathname.slice(proxyPrefix.length)
      return decodePathFromUrl(encodedPath)
    }
  } catch {
    // path is not an absolute URL
  }

  return src
}

function isNonRelativeUrl(src: string): boolean {
  if (/^(https?:)?\/\//i.test(src)) return true
  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return true
  return false
}

function trimImageRootPath(path: string, rootPath: string): string {
  const normalizedRoot = rootPath.replace(/^\/+|\/+$/g, '')
  if (!normalizedRoot) return path
  return path.startsWith(`${normalizedRoot}/`) ? path.slice(normalizedRoot.length + 1) : path
}

function normalizeStoredImagePath(path: string): string {
  const trimmed = path.trim()
  if (trimmed.startsWith('/')) return trimmed
  if (trimmed.startsWith(`${IMAGE_ASSET_ROOT}/`)) {
    return `/${trimmed}`
  }
  return trimmed
}

function sanitizeFileName(value: string): string {
  const trimmed = value.trim().replace(/[/\\?%*:|"<>]/g, '-')
  if (!trimmed) return 'image.png'
  return trimmed
}

function getFileExtension(value: string): string {
  const ext = value.split('.').pop()?.toLowerCase() || ''
  if (!ext) return ''
  if (!/^[a-z0-9]+$/.test(ext)) return ''
  return ext
}

function extensionFromMimeType(value: string): string {
  const mime = value.trim().toLowerCase()
  switch (mime) {
    case 'image/jpeg':
      return 'jpg'
    case 'image/png':
      return 'png'
    case 'image/webp':
      return 'webp'
    case 'image/gif':
      return 'gif'
    case 'image/svg+xml':
      return 'svg'
    case 'image/avif':
      return 'avif'
    default:
      return ''
  }
}

function createImageAssetName(extension: string): string {
  const uuid =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random()
          .toString(36)
          .slice(2, 10)}`
  return `${uuid}.${extension}`
}

function errorToMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)

  if (text.includes('401') || text.toLowerCase().includes('unauthorized')) {
    return 'Unauthorized. Sign in again and retry.'
  }

  if (text.includes('409') && text.toLowerCase().includes('git repository is empty')) {
    return 'Repository is empty. Create the first file to start.'
  }

  if (text.includes('409')) {
    return 'Save failed because the file changed upstream. Reload the file and try again.'
  }

  return text
}

function formatRelativeTime(input: string | null): string {
  if (!input) return 'unknown'
  const date = new Date(input)
  const diffMs = Date.now() - date.getTime()
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  const minute = 60_000
  const hour = 3_600_000
  const day = 86_400_000

  if (diffMs < minute) return 'just now'
  if (diffMs < hour) return rtf.format(-Math.floor(diffMs / minute), 'minute')
  if (diffMs < day) return rtf.format(-Math.floor(diffMs / hour), 'hour')
  if (diffMs < 30 * day) return rtf.format(-Math.floor(diffMs / day), 'day')
  return date.toLocaleDateString()
}
