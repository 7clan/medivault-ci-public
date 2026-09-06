'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { DOCUMENT_CATEGORIES } from '@/lib/utils-helpers'
import { Loader2, FileText, Save } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { DocumentInfo } from '@/store/app-store'

interface EditDocumentDialogProps {
  document: DocumentInfo | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (updated: DocumentInfo) => void
}

export function EditDocumentDialog({ document, open, onOpenChange, onSaved }: EditDocumentDialogProps) {
  const { toast } = useToast()
  const [title, setTitle] = useState(document?.title || '')
  const [category, setCategory] = useState(document?.category || 'General')
  const [notes, setNotes] = useState(document?.notes || '')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!document) return
    setSaving(true)

    try {
      const res = await fetch(`/api/documents/${document.id}`,  { credentials: 'include',
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          category,
          notes,
        }),
      })

      if (res.ok) {
        const updated = await res.json()
        onSaved(updated)
        toast({ title: 'Document Updated', description: 'Changes saved successfully.' })
      } else {
        const data = await res.json()
        toast({ title: 'Update Failed', description: data.error || 'Could not update document.', variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to update document.', variant: 'destructive' })
    }
    setSaving(false)
  }

  return (
    <Dialog key={document?.id || 'none'} open={open && !!document} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-emerald-600" />
            Edit Document
          </DialogTitle>
          <DialogDescription>
            Update the title, category, or add notes for &quot;{document?.fileName}&quot;
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Title</Label>
            <Input
              placeholder="e.g. Lab Results - Blood Work"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOCUMENT_CATEGORIES.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {cat}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea
              placeholder="Add notes about this document..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
            onClick={handleSave}
            disabled={saving || !title.trim()}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
