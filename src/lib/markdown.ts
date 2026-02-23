const FRONTMATTER_DELIMITER = '---'

export type MarkdownEntry = {
  title: string
  icon: string
  cover: string
  body: string
}

export function parseMarkdownEntry(content: string): MarkdownEntry {
  const normalized = content.replace(/\r\n/g, '\n')
  const { frontmatter, body } = splitFrontmatter(normalized)
  const icon = getFrontmatterValue(frontmatter, 'icon')
  const cover = getFrontmatterValue(frontmatter, 'cover')
  const fallbackTitle = getFrontmatterValue(frontmatter, 'title')
  const { title: parsedTitle, body: bodyWithoutH1 } = splitLeadingH1(body)

  return {
    title: parsedTitle || fallbackTitle,
    icon,
    cover,
    body: bodyWithoutH1,
  }
}

export function serializeMarkdownEntry(entry: MarkdownEntry): string {
  const cleanTitle = entry.title.trim()
  const cleanIcon = entry.icon.trim()
  const cleanCover = entry.cover.trim()
  const normalizedBody = entry.body.replace(/\r\n/g, '\n')
  const { body: bodyWithoutH1 } = splitLeadingH1(normalizedBody)
  const cleanBody = bodyWithoutH1.trimEnd()

  const parts: string[] = []

  if (cleanIcon || cleanCover) {
    parts.push(FRONTMATTER_DELIMITER)
    if (cleanIcon) parts.push(`icon: ${cleanIcon}`)
    if (cleanCover) parts.push(`cover: ${cleanCover}`)
    parts.push(FRONTMATTER_DELIMITER)
    parts.push('')
  }

  if (cleanTitle) {
    parts.push(`# ${cleanTitle}`)
  }

  if (cleanTitle && cleanBody) {
    parts.push('')
  }

  if (cleanBody) {
    parts.push(cleanBody)
  }

  return `${parts.join('\n').replace(/\n+$/g, '')}\n`
}

function splitFrontmatter(content: string): { frontmatter: string[]; body: string } {
  const trimmed = content.trimStart()

  if (!trimmed.startsWith(FRONTMATTER_DELIMITER)) {
    return { frontmatter: [], body: content.replace(/^\n+/, '') }
  }

  const lines = trimmed.split('\n')
  if (lines.length < 3 || lines[0]?.trim() !== FRONTMATTER_DELIMITER) {
    return { frontmatter: [], body: content.replace(/^\n+/, '') }
  }

  const closingIndex = lines.findIndex(
    (line, index) => index > 0 && line.trim() === FRONTMATTER_DELIMITER,
  )

  if (closingIndex === -1) {
    return { frontmatter: [], body: content.replace(/^\n+/, '') }
  }

  return {
    frontmatter: lines.slice(1, closingIndex),
    body: lines.slice(closingIndex + 1).join('\n').replace(/^\n+/, ''),
  }
}

function getFrontmatterValue(lines: string[], key: string): string {
  const match = lines.find((line) => line.toLowerCase().startsWith(`${key.toLowerCase()}:`))
  return match ? match.slice(key.length + 1).trim() : ''
}

function splitLeadingH1(content: string): { title: string; body: string } {
  const normalized = content.replace(/\r\n/g, '\n')
  const match = normalized.match(/^\s*#\s+(.+?)\s*(?:\n+|$)/)

  if (!match) {
    return {
      title: '',
      body: normalized.replace(/^\n+/, ''),
    }
  }

  const title = (match[1] || '').trim()
  const body = normalized.slice(match[0].length).replace(/^\n+/, '')

  return { title, body }
}
