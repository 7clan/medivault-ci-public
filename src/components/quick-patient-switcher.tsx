'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useAppStore, PatientInfo } from '@/store/app-store'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, Users, Clock, Phone, UserCircle } from 'lucide-react'

// Gradient color pairs for patient avatars
const AVATAR_GRADIENTS = [
  'from-emerald-400 to-teal-500',
  'from-blue-400 to-indigo-500',
  'from-purple-400 to-pink-500',
  'from-orange-400 to-amber-500',
  'from-rose-400 to-red-500',
  'from-cyan-400 to-sky-500',
  'from-violet-400 to-purple-500',
  'from-lime-400 to-green-500',
]

function getAvatarGradient(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    const char = id.charCodeAt(i)
    hash = (hash << 5) - hash + char
  }
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length]
}

function getInitials(firstName: string, lastName: string): string {
  const f = firstName?.[0]?.toUpperCase() || ''
  const l = lastName?.[0]?.toUpperCase() || ''
  return f + l || '?'
}

function calculateAge(dob: string | null): number | null {
  if (!dob) return null
  const birthDate = new Date(dob)
  const today = new Date()
  let age = today.getFullYear() - birthDate.getFullYear()
  const monthDiff = today.getMonth() - birthDate.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--
  }
  return age
}

interface PatientSwitcherProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function QuickPatientSwitcher({ open, onOpenChange }: PatientSwitcherProps) {
  const { selectPatient, recentlyViewed } = useAppStore()
  const [patients, setPatients] = useState<PatientInfo[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Load patients when dialog opens
  useEffect(() => {
    if (!open) {
      setSearchQuery('')
      setSelectedIndex(0)
      setPatients([])
      return
    }

    const loadPatients = async () => {
      setLoading(true)
      try {
        const res = await fetch('/api/patients?limit=200', { credentials: 'include' })
        if (res.ok) {
          const data = await res.json()
          setPatients(data.patients || [])
        }
      } catch (err) {
        console.error('Failed to load patients for switcher:', err)
      } finally {
        setLoading(false)
      }
    }
    loadPatients()
  }, [open])

  // Focus input when dialog opens
  useEffect(() => {
    if (open) {
      // Small delay to allow dialog animation
      const timer = setTimeout(() => {
        inputRef.current?.focus()
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [open])

  // Filter patients by search query
  const filteredPatients = useMemo(() => {
    if (!searchQuery.trim()) return patients
    const query = searchQuery.toLowerCase().trim()
    return patients.filter((p) => {
      const fullName = `${p.firstName} ${p.lastName}`.toLowerCase()
      return (
        fullName.includes(query) ||
        p.firstName.toLowerCase().includes(query) ||
        p.lastName.toLowerCase().includes(query) ||
        p.phone?.toLowerCase().includes(query) ||
        p.email?.toLowerCase().includes(query)
      )
    })
  }, [patients, searchQuery])

  // Separate recently viewed patients
  const recentlyViewedIds = new Set(recentlyViewed.map((p) => p.id))
  const recentlyViewedPatients = useMemo(() => {
    return filteredPatients.filter((p) => recentlyViewedIds.has(p.id))
  }, [filteredPatients, recentlyViewedIds])
  const otherPatients = useMemo(() => {
    return filteredPatients.filter((p) => !recentlyViewedIds.has(p.id))
  }, [filteredPatients, recentlyViewedIds])

  // Flat list for keyboard navigation
  const allItems = useMemo(() => {
    if (searchQuery.trim()) {
      return otherPatients
    }
    return [...recentlyViewedPatients, ...otherPatients]
  }, [searchQuery, recentlyViewedPatients, otherPatients])

  // Reset selected index when search query changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [searchQuery])

  // Handle patient selection
  const handleSelect = useCallback(
    (patient: PatientInfo) => {
      selectPatient(patient)
      onOpenChange(false)
    },
    [selectPatient, onOpenChange]
  )

  // Handle keyboard navigation within the dialog
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex((prev) => Math.min(prev + 1, allItems.length - 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex((prev) => Math.max(prev - 1, 0))
          break
        case 'Enter':
          e.preventDefault()
          if (allItems[selectedIndex]) {
            handleSelect(allItems[selectedIndex])
          }
          break
      }
    },
    [allItems, selectedIndex, handleSelect]
  )

  // Scroll selected item into view
  useEffect(() => {
    if (selectedIndex >= 0 && listRef.current) {
      const items = listRef.current.querySelectorAll('[data-patient-item]')
      const selectedItem = items[selectedIndex] as HTMLElement
      selectedItem?.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  const renderPatientRow = (patient: PatientInfo, index: number) => {
    const age = calculateAge(patient.dateOfBirth)
    const initials = getInitials(patient.firstName, patient.lastName)
    const gradient = getAvatarGradient(patient.id)
    const isSelected = selectedIndex === index

    return (
      <motion.button
        key={patient.id}
        data-patient-item
        onClick={() => handleSelect(patient)}
        onMouseEnter={() => setSelectedIndex(index)}
        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors duration-150 ${
          isSelected
            ? 'bg-emerald-50 dark:bg-emerald-950/40 ring-1 ring-emerald-200 dark:ring-emerald-800'
            : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
        }`}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.1 }}
      >
        {/* Avatar with gradient */}
        <div
          className={`flex-shrink-0 w-9 h-9 rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center text-white font-semibold text-sm shadow-sm`}
        >
          {initials}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
            {patient.firstName} {patient.lastName}
          </p>
          <div className="flex items-center gap-2 mt-0.5">
            {age !== null && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <UserCircle className="h-3 w-3" />
                {age}y
              </span>
            )}
            {patient.phone && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Phone className="h-3 w-3" />
                {patient.phone}
              </span>
            )}
          </div>
        </div>
      </motion.button>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-lg p-0 gap-0 overflow-hidden rounded-xl"
      >
        {/* Accessible but visually hidden */}
        <DialogTitle className="sr-only">Quick Patient Switcher</DialogTitle>
        <DialogDescription className="sr-only">Search and navigate to a patient</DialogDescription>

        {/* Search input area */}
        <div className="flex items-center gap-3 border-b border-gray-200 dark:border-gray-800 px-4 py-3">
          <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search patients..."
            className="flex-1 bg-transparent text-sm text-gray-900 dark:text-white placeholder:text-muted-foreground outline-none"
          />
          <kbd className="inline-flex items-center justify-center h-5 px-1.5 rounded bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-[10px] font-mono text-muted-foreground shadow-sm flex-shrink-0">
            ESC
          </kbd>
        </div>

        {/* Patient list */}
        <div ref={listRef} className="max-h-[320px] overflow-y-auto px-2 py-1.5">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <motion.div
                  className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                />
                Loading patients...
              </div>
            </div>
          ) : allItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Users className="h-10 w-10 mb-2 opacity-30" />
              <p className="text-sm font-medium">No patients found</p>
              {searchQuery && (
                <p className="text-xs mt-1 opacity-60">
                  No results for &quot;{searchQuery}&quot;
                </p>
              )}
            </div>
          ) : (
            <>
              {/* Recently viewed section (only when not searching) */}
              {!searchQuery.trim() && recentlyViewedPatients.length > 0 && (
                <>
                  <div className="flex items-center gap-2 px-3 py-2 mt-1">
                    <Clock className="h-3 w-3 text-muted-foreground" />
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Recently Viewed
                    </span>
                    <div className="flex-1 h-px bg-gray-100 dark:bg-gray-800" />
                  </div>
                  {recentlyViewedPatients.map((patient, index) =>
                    renderPatientRow(patient, index)
                  )}

                  {/* Separator if there are other patients too */}
                  {otherPatients.length > 0 && (
                    <div className="flex items-center gap-2 px-3 py-2 mt-1">
                      <Users className="h-3 w-3 text-muted-foreground" />
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        All Patients
                      </span>
                      <div className="flex-1 h-px bg-gray-100 dark:bg-gray-800" />
                    </div>
                  )}
                </>
              )}

              {/* Other patients or search results */}
              {(searchQuery.trim() ? allItems : otherPatients).map((patient, index) => {
                const actualIndex = searchQuery.trim()
                  ? index
                  : recentlyViewedPatients.length + index
                return renderPatientRow(patient, actualIndex)
              })}
            </>
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <kbd className="inline-flex items-center justify-center h-4 min-w-[18px] px-1 rounded bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-[9px] font-mono">
                ↑↓
              </kbd>
              Navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="inline-flex items-center justify-center h-4 min-w-[18px] px-1 rounded bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-[9px] font-mono">
                ↵
              </kbd>
              Select
            </span>
            <span className="flex items-center gap-1">
              <kbd className="inline-flex items-center justify-center h-4 px-1 rounded bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-[9px] font-mono">
                esc
              </kbd>
              Close
            </span>
          </div>
          <span className="text-xs text-muted-foreground">
            {allItems.length} patient{allItems.length !== 1 ? 's' : ''}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
