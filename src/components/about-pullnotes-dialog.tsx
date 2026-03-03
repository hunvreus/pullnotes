import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { Github } from 'lucide-react'

type AboutPullNotesDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const PULLNOTES_REPO_URL = 'https://github.com/hunvreus/pullnotes'
const CREATOR_PROFILE_URL = 'https://github.com/hunvreus'

export function AboutPullNotesDialog({ open, onOpenChange }: AboutPullNotesDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm gap-3 p-4">
        <DialogHeader>
          <DialogTitle>About PullNotes</DialogTitle>
          <DialogDescription>
            PullNotes is a minimal Notion-style Markdown editor for GitHub repositories, built by{' '}
            <a
              href={CREATOR_PROFILE_URL}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              Ronan Berder
            </a>
            .
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button asChild variant="outline" size="sm" className="h-8 w-full text-xs">
            <a href={PULLNOTES_REPO_URL} target="_blank" rel="noreferrer">
              <Github className="size-3.5" />
              GitHub repository
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
