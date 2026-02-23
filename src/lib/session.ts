import { getRequestHeaders } from '@tanstack/react-start/server'
import { auth } from '#/lib/auth'

export async function requireSession() {
  const session = await auth.api.getSession({
    headers: getRequestHeaders(),
  })

  if (!session?.user || !session.session) {
    throw new Error('Unauthorized')
  }

  return session
}

export async function requireGitHubAccessToken() {
  const session = await requireSession()
  const token = await auth.api.getAccessToken({
    headers: getRequestHeaders(),
    body: {
      providerId: 'github',
      userId: session.user.id,
    },
  })

  if (!token?.accessToken) {
    throw new Error('Missing GitHub access token. Sign in again.')
  }

  return token.accessToken
}
