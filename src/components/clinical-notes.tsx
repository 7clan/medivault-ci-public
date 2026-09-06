'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { formatDateTime } from '@/lib/utils-helpers'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus,
  Trash2,
  Loader2,
  Pin,
  PinOff,
  Edit3,
  X,
  Check,
  StickyNote,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export interface ClinicalNoteData {
  id: string
  patientId: string
  doctorId: string
  visitId?: string | null
  title: string
  content: string
  category: string
  isPinned: boolean
  createdAt: string
  updatedAt: string
  patient?: { id: string; firstName: string; lastName: string }
  doctor?: { id: string; name: string }
  visit?: { id: string; visitDate: string; visitType: string }
}

interface ClinicalNotesProps {
  patientId: string
}

const CATEGORY_COLORS: Record<string, string> = {
  General: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
  Diagnosis: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  'Treatment Plan': 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
  'Lab Results': 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  'Follow-up': 'bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300',
  Referral: 'bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-300',
}

const NOTE_CATEGORIES = ['General', 'Diagnosis', 'Treatment Plan', 'Lab Results', 'Follow-up', 'Referral']

export function ClinicalNotes({ patientId }: ClinicalNotesProps) {
  const { toast } = useToast()
  const [notes, setNotes] = useState<ClinicalNoteData[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [saving, setSaving] = useState(false)

  // Quick-add form state
  const [quickAdd, setQuickAdd] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newContent, setNewContent] = useState('')
  const [newCategory, setNewCategory] = useState('General')

  // Edit form state
  const [editTitle, setEditTitle] = useState('')
  const [editContent, setEditContent] = useState('')
  const [editCategory, setEditCategory] = useState('General')

  useEffect(() => {
    let cancelled = false
    const fetchNotes = async () => {
      try {
        const res = await fetch(`/api/notes?patientId=${patientId}`)
        if (res.ok && !cancelled) {
          const data = await res.json()
          setNotes(data)
        }
      } catch {
        console.error('Failed to load clinical notes')
      }
      if (!cancelled) setLoading(false)
    }
    fetchNotes()
    return () => { cancelled = true }
  }, [patientId])

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id))
    setEditingId(null)
  }

  const startEdit = (note: ClinicalNoteData) => {
    setEditingId(note.id)
    setEditTitle(note.title)
    setEditContent(note.content)
    setEditCategory(note.category)
  }

  const cancelEdit = () => {
    setEditingId(null)
  }

  const handleSaveEdit = async () => {
    if (!editingId || !editTitle.trim() || !editContent.trim()) return
    setSaving(true)
    try {
      const res = await fetch(`/api/notes/${editingId}`,  { credentials: 'include',
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editTitle.trim(),
          content: editContent.trim(),
          category: editCategory,
        }),
      })
      if (res.ok) {
        const updated = await res.json()
        setNotes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)))
        toast({ title: 'Note updated' })
        setEditingId(null)
      }
    } catch {
      toast({ title: 'Error updating note', variant: 'destructive' })
    }
    setSaving(false)
  }

  const handleTogglePin = async (note: ClinicalNoteData) => {
    try {
      const res = await fetch(`/api/notes/${note.id}`,  { credentials: 'include',
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPinned: !note.isPinned }),
      })
      if (res.ok) {
        const updated = await res.json()
        setNotes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)))
      }
    } catch {
      toast({ title: 'Error toggling pin', variant: 'destructive' })
    }
  }

  const handleDelete = async () => {
    if (!deleteConfirm) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/notes/${deleteConfirm}`, { method: 'DELETE' })
      if (res.ok) {
        setNotes((prev) => prev.filter((n) => n.id !== deleteConfirm))
        toast({ title: 'Note deleted' })
      }
    } catch {
      toast({ title: 'Error deleting note', variant: 'destructive' })
    }
    setDeleting(false)
    setDeleteConfirm(null)
  }

  const handleQuickAdd = async () => {
    if (!newTitle.trim() || !newContent.trim()) return
    setSaving(true)
    try {
      const res = await fetch('/api/notes',  { credentials: 'include',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientId,
          title: newTitle.trim(),
          content: newContent.trim(),
          category: newCategory,
        }),
      })
      if (res.ok) {
        const created = await res.json()
        setNotes((prev) => [created, ...prev])
        toast({ title: 'Note added' })
        setNewTitle('')
        setNewContent('')
        setNewCategory('General')
        setQuickAdd(false)
      }
    } catch {
      toast({ title: 'Error adding note', variant: 'destructive' })
    }
    setSaving(false)
  }

  const pinnedNotes = notes.filter((n) => n.isPinned)
  const regularNotes = notes.filter((n) => !n.isPinned)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Quick Add */}
      <AnimatePresence>
        {quickAdd && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <Card className="border-emerald-200 dark:border-emerald-800">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-gray-900 dark:text-white">New Clinical Note</h4>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => { setQuickAdd(false); setNewTitle(''); setNewContent(''); setNewCategory('General') }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="flex gap-2">
                  <Input
                    placeholder="Note title"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    className="flex-1 h-9"
                  />
                  <Select value={newCategory} onValueChange={setNewCategory}>
                    <SelectTrigger className="w-[140px] h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {NOTE_CATEGORIES.map((cat) => (
                        <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Textarea
                  placeholder="Note content..."
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  className="min-h-[80px] resize-none"
                />
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setQuickAdd(false); setNewTitle(''); setNewContent(''); setNewCategory('General') }}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleQuickAdd}
                    disabled={saving || !newTitle.trim() || !newContent.trim()}
                    className="bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-teal-600 text-white"
                  >
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Plus className="h-3.5 w-3.5 mr-1.5" />}
                    Add Note
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {notes.length === 0 && !quickAdd ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
        >
          <Card className="border-dashed border-2 border-gray-300 dark:border-gray-700">
            <CardContent className="flex flex-col items-center justify-center py-8">
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/30 flex items-center justify-center mb-3">
                <StickyNote className="h-7 w-7 text-emerald-400" />
              </div>
              <p className="text-sm text-muted-foreground">No clinical notes yet</p>
              <Button
                variant="link"
                size="sm"
                className="text-emerald-600"
                onClick={() => setQuickAdd(true)}
              >
                Add first note
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      ) : (
        <>
          {/* Pinned Notes */}
          <AnimatePresence>
            {pinnedNotes.map((note, index) => (
              <NoteItem
                key={note.id}
                note={note}
                index={index}
                expanded={expandedId === note.id}
                editing={editingId === note.id}
                editTitle={editTitle}
                editContent={editContent}
                editCategory={editCategory}
                onToggleExpand={() => toggleExpand(note.id)}
                onTogglePin={() => handleTogglePin(note)}
                onStartEdit={() => startEdit(note)}
                onCancelEdit={cancelEdit}
                onSaveEdit={handleSaveEdit}
                onDelete={() => setDeleteConfirm(note.id)}
                onEditTitleChange={setEditTitle}
                onEditContentChange={setEditContent}
                onEditCategoryChange={setEditCategory}
                saving={saving}
              />
            ))}
          </AnimatePresence>

          {/* Regular Notes */}
          <AnimatePresence>
            {regularNotes.map((note, index) => (
              <NoteItem
                key={note.id}
                note={note}
                index={pinnedNotes.length + index}
                expanded={expandedId === note.id}
                editing={editingId === note.id}
                editTitle={editTitle}
                editContent={editContent}
                editCategory={editCategory}
                onToggleExpand={() => toggleExpand(note.id)}
                onTogglePin={() => handleTogglePin(note)}
                onStartEdit={() => startEdit(note)}
                onCancelEdit={cancelEdit}
                onSaveEdit={handleSaveEdit}
                onDelete={() => setDeleteConfirm(note.id)}
                onEditTitleChange={setEditTitle}
                onEditContentChange={setEditContent}
                onEditCategoryChange={setEditCategory}
                saving={saving}
              />
            ))}
          </AnimatePresence>
        </>
      )}

      {/* Delete Confirmation */}
      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Delete Clinical Note
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this clinical note? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Export quickAdd toggle and count */}
      <div className="flex items-center gap-2">
        {!quickAdd && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setQuickAdd(true)}
            className="border-emerald-200 dark:border-emerald-800 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/20"
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add Note
          </Button>
        )}
        <Badge variant="secondary" className="text-xs bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400">
          {notes.length} note{notes.length !== 1 ? 's' : ''}
        </Badge>
      </div>
    </div>
  )
}

interface NoteItemProps {
  note: ClinicalNoteData
  index: number
  expanded: boolean
  editing: boolean
  editTitle: string
  editContent: string
  editCategory: string
  onToggleExpand: () => void
  onTogglePin: () => void
  onStartEdit: () => void
  onCancelEdit: () => void
  onSaveEdit: () => void
  onDelete: () => void
  onEditTitleChange: (v: string) => void
  onEditContentChange: (v: string) => void
  onEditCategoryChange: (v: string) => void
  saving: boolean
}

function getCategoryBorderClass(category: string): string {
  const map: Record<string, string> = {
    'General': 'note-border-general',
    'Diagnosis': 'note-border-diagnosis',
    'Treatment Plan': 'note-border-treatment',
    'Lab Results': 'note-border-lab',
    'Follow-up': 'note-border-followup',
    'Referral': 'note-border-referral',
  }
  return map[category] || 'note-border-general'
}

function NoteItem({
  note,
  index,
  expanded,
  editing,
  editTitle,
  editContent,
  editCategory,
  onToggleExpand,
  onTogglePin,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onEditTitleChange,
  onEditContentChange,
  onEditCategoryChange,
  saving,
}: NoteItemProps) {
  const categoryColor = CATEGORY_COLORS[note.category] || CATEGORY_COLORS.General
  const borderClass = getCategoryBorderClass(note.category)

  return (
    <motion.div
      key={note.id}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.2, delay: index * 0.03 }}
    >
      <Card className={`${borderClass} hover:shadow-md transition-all duration-200 ${
        note.isPinned ? 'ring-1 ring-amber-200 dark:ring-amber-800/50' : ''
      }`}>
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2 min-w-0 flex-1">
              {/* Pin toggle with animation */}
              <Button
                variant="ghost"
                size="icon"
                className={`h-7 w-7 flex-shrink-0 ${note.isPinned ? 'text-amber-500 hover:text-amber-600' : 'text-gray-300 hover:text-amber-500 dark:text-gray-600'}`}
                onClick={onTogglePin}
                title={note.isPinned ? 'Unpin' : 'Pin'}
              >
                <motion.div
                  className="pin-animated"
                  whileHover={{ rotate: -15, scale: 1.2 }}
                  whileTap={{ scale: 0.9 }}
                >
                  {note.isPinned ? <Pin className="h-3.5 w-3.5" /> : <PinOff className="h-3.5 w-3.5" />}
                </motion.div>
              </Button>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className="font-medium text-sm text-gray-900 dark:text-white cursor-pointer hover:text-emerald-600 transition-colors"
                    onClick={onToggleExpand}
                  >
                    {note.title}
                  </span>
                  <Badge className={`text-[10px] rounded-full bg-gradient-to-r ${categoryColor}`}>
                    {note.category}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {formatDateTime(note.createdAt)}
                </p>
                {!expanded && !editing && (
                  <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">
                    {note.content}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1 flex-shrink-0">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={onToggleExpand}
              >
                {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </Button>
              {!editing && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 hover:bg-emerald-50 dark:hover:bg-emerald-950/20"
                  onClick={onStartEdit}
                >
                  <Edit3 className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/50"
                onClick={onDelete}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* Expanded / Edit View */}
          <AnimatePresence>
            {(expanded || editing) && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800 space-y-3">
                  {editing ? (
                    <>
                      <Input
                        value={editTitle}
                        onChange={(e) => onEditTitleChange(e.target.value)}
                        placeholder="Title"
                        className="h-9"
                      />
                      <Select value={editCategory} onValueChange={onEditCategoryChange}>
                        <SelectTrigger className="h-9 w-[180px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {NOTE_CATEGORIES.map((cat) => (
                            <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Textarea
                        value={editContent}
                        onChange={(e) => onEditContentChange(e.target.value)}
                        placeholder="Content"
                        className="min-h-[100px] resize-none"
                      />
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={onCancelEdit}>
                          <X className="h-3.5 w-3.5 mr-1" />
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          onClick={onSaveEdit}
                          disabled={saving || !editTitle.trim() || !editContent.trim()}
                          className="bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-teal-600 text-white"
                        >
                          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Check className="h-3.5 w-3.5 mr-1" />}
                          Save
                        </Button>
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">
                      {note.content}
                    </p>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>
    </motion.div>
  )
}
