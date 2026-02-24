import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/github-app/callback')({
  server: {
    handlers: {
      GET: ({ request }) => {
        const url = new URL(request.url)
        const target = new URL('/', url)
        const installationId = url.searchParams.get('installation_id')

        if (installationId) {
          target.searchParams.set('installed', '1')
        }

        return Response.redirect(target.toString(), 302)
      },
    },
  },
})
