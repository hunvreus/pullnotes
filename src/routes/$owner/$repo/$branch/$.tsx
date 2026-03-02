import { createFileRoute } from '@tanstack/react-router'
import { App } from '../$branch'

type RouteSearch = {
  root?: string
  file?: string
}

export const Route = createFileRoute('/$owner/$repo/$branch/$')({
  validateSearch: (search): RouteSearch => {
    const raw = search as Record<string, unknown>

    return {
      root: typeof raw.root === 'string' ? raw.root : undefined,
      file: typeof raw.file === 'string' ? raw.file : undefined,
    }
  },
  component: App,
})
