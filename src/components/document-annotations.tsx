'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/use-toast'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus,
  MessageSquare,
  Loader2,
  Pencil,
  Trash2,
  Check,
  X,
} from 'lucide-react'

const PRESET_COLORS = [
  { name: 'emerald', value: '#10b981' },
  { name: 'blue', value: '#3b82f6' },
  { name: 'amber', value: '#f59e0b' },
  { name: 'rose', value: '#f43f5e' },
  { name: 'purple', value: '#a855f7' },
  { name: 'teal', value: '#14b8a6' },
]

interface AnnotationData {
  id: string
  documentId: string
  doctorId: string
  content: string
  x: number
  y: number
  page: number
  color: string
  createdAt: string
  updatedAt: string
}

interface DocumentAnnotationsProps {
  documentId: string
}

export function DocumentAnnotations({ documentId }: DocumentAnnotationsProps) {
  const { toast } = useToast()
  const [annotations, setAnnotations] = useState<AnnotationData[]>([])
  const [loading, setLoading] = useState(true)
  const [newContent, setNewContent] = useState('')
  const [selectedColor, setSelectedColor] = useState(PRESET_COLORS[0].value)
  const [submitting, setSubmitting] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const fetchAnnotations = async () => {
      try {
        const res = await fetch(`/api/documents/${documentId}/annotations`)
        if (res.ok && !cancelled) {
          const data = await res.json()
          setAnnotations(data)
        }
      } catch {
        // silently fail
      }
      if (!cancelled) setLoading(false)
    }
    fetchAnnotations()
    return () => { cancelled = true }
  }, [documentId])

  const loadAnnotations = useCallback(async () => {
    try {
      const res = await fetch(`/api/documents/${documentId}/annotations`)
      if (res.ok) {
        const data = await res.json()
        setAnnotations(data)
      }
    } catch {
      // silently fail
    }
  }, [documentId])

  const handleAdd = async () => {
    if (!newContent.trim()) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/documents/${documentId}/annotations`,  { credentials: 'include',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newContent.trim(), x: 0, y: 0, color: selectedColor, page: 1 }),
      })
      if (res.ok) {
        setNewContent('')
        loadAnnotations()
        toast({ title: 'Annotation Added' })
      } else {
        toast({ title: 'Error', variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Network Error', variant: 'destructive' })
    }
    setSubmitting(false)
  }

  const handleUpdate = async (id: string) => {
    if (!editContent.trim()) return
    try {
      const res = await fetch(`/api/annotations/${id}`,  { credentials: 'include',
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editContent.trim() }),
      })
      if (res.ok) {
        setEditingId(null)
        loadAnnotations()
        toast({ title: 'Annotation Updated' })
      }
    } catch {
      toast({ title: 'Error', variant: 'destructive' })
    }
  }

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/annotations/${id}`, { method: 'DELETE' })
      if (res.ok) {
        setDeletingId(null)
        loadAnnotations()
        toast({ title: 'Annotation Deleted' })
      }
    } catch {
      toast({ title: 'Error', variant: 'destructive' })
    }
  }

  const startEdit = (annotation: AnnotationData) => {
    setEditingId(annotation.id)
    setEditContent(annotation.content)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 text-emerald-500 animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-sm font-medium text-foreground">Add Annotation</span>
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="Write an annotation..."
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd() }}
            className="flex-1 h-9 text-sm"
          />
          <Button
            size="icon"
            onClick={handleAdd}
            disabled={submitting || !newContent.trim()}
            className="h-9 w-9 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          </Button>
        </div>
        <div className="flex gap-2 mt-2">
          {PRESET_COLORS.map((c) => (
            <button
              key={c.name}
              onClick={() => setSelectedColor(c.value)}
              className={`w-5 h-5 rounded-full transition-all ${selectedColor === c.value ? 'ring-2 ring-offset-2 ring-gray-400 dark:ring-offset-gray-900 scale-110' : 'hover:scale-110'}`}
              style={{ backgroundColor: c.value }}
              title={c.name}
            />
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin p-4">
        {annotations.length === 0 ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-12 h-12 rounded-full bg-emerald-50 dark:bg-emerald-950/30 flex items-center justify-center mb-3">
              <MessageSquare className="h-5 w-5 text-emerald-400" />
            </div>
            <p className="text-sm font-medium text-muted-foreground">No annotations yet</p>
            <p className="text-xs text-muted-foreground mt-1">Add your first annotation above</p>
          </motion.div>
        ) : (
          <div className="space-y-2">
            <AnimatePresence>
              {annotations.map((annotation, index) => (
                <motion.div
                  key={annotation.id}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.2, delay: index * 0.05 }}
                  className="group rounded-lg border border-border p-3 hover:border-emerald-200 dark:hover:border-emerald-800 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0" style={{ backgroundColor: annotation.color }} />
                    {editingId === annotation.id ? (
                      <div className="flex-1 flex gap-2">
                        <Input value={editContent} onChange={(e) => setEditContent(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleUpdate(annotation.id); if (e.key === 'Escape') setEditingId(null) }} className="h-8 text-sm" autoFocus />
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-emerald-600" onClick={() => handleUpdate(annotation.id)}><Check className="h-3.5 w-3.5" /></Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditingId(null)}><X className="h-3.5 w-3.5" /></Button>
                      </div>
                    ) : (
                      <>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-foreground break-words">{annotation.content}</p>
                          <p className="text-xs text-muted-foreground mt-1">{new Date(annotation.createdAt).toLocaleString()}</p>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                          <Button size="icon" variant="ghost" className="h-7 w-7 hover:bg-emerald-50 dark:hover:bg-emerald-950/20" onClick={() => startEdit(annotation)}><Pencil className="h-3 w-3" /></Button>
                          {deletingId === annotation.id ? (
                            <div className="flex gap-1">
                              <Button size="icon" variant="ghost" className="h-7 w-7 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/50" onClick={() => handleDelete(annotation.id)}><Check className="h-3 w-3" /></Button>
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setDeletingId(null)}><X className="h-3 w-3" /></Button>
                            </div>
                          ) : (
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/50" onClick={() => setDeletingId(annotation.id)}><Trash2 className="h-3 w-3" /></Button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  )
}
