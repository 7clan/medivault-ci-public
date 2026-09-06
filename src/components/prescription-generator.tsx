'use client'

import { useState, useEffect, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
// ScrollArea with horizontal orientation requires using ScrollBar directly, so we use native overflow
import { useToast } from '@/hooks/use-toast'
import { motion, AnimatePresence } from 'framer-motion'
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
import {
  Plus,
  Trash2,
  Loader2,
  Pill,
  Sparkles,
  Search,
  ShieldCheck,
  Flame,
  Droplets,
  Heart,
  CircleDot,
  Thermometer,
  X,
  LayoutTemplate,
} from 'lucide-react'
import { cn } from '@/lib/utils'

export interface MedicationEntry {
  name: string
  dosage: string
  frequency: string
  duration: string
  instructions: string
}

export interface PrescriptionData {
  id?: string
  patientId: string
  doctorId?: string
  visitId?: string | null
  medications: MedicationEntry[]
  notes?: string | null
  status?: string
  createdAt?: string
  patient?: { id: string; firstName: string; lastName: string; dateOfBirth: string | null; phone: string | null; address: string | null }
  doctor?: { id: string; name: string; phone: string | null; specialty: string | null }
}

interface PrescriptionGeneratorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  patientId: string
  patientName: string
  visitId?: string | null
  onSaved?: (prescription: PrescriptionData) => void
}

const FREQUENCY_OPTIONS = [
  'Once daily',
  'Twice daily',
  'Three times daily',
  'As needed',
  'Every 4 hours',
  'Every 6 hours',
  'Every 8 hours',
  'Weekly',
]

const DURATION_OPTIONS = [
  '3 days',
  '5 days',
  '7 days',
  '10 days',
  '14 days',
  '30 days',
  '60 days',
  '90 days',
  'Ongoing',
]

type MedicationCategory = 'Antibiotic' | 'Pain/Inflammation' | 'Diabetes' | 'Hypertension' | 'GERD/Acid Reflux' | 'Fever/Pain'

interface PrescriptionTemplate {
  name: string
  dosage: string
  frequency: string
  duration: string
  instructions: string
  category: MedicationCategory
}

const CATEGORY_CONFIG: Record<MedicationCategory, {
  color: string
  bgColor: string
  borderColor: string
  hoverBg: string
  darkBgColor: string
  darkBorderColor: string
  darkHoverBg: string
  icon: typeof ShieldCheck
  badgeClass: string
}> = {
  'Antibiotic': {
    color: 'text-blue-600 dark:text-blue-400',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    hoverBg: 'hover:bg-blue-100',
    darkBgColor: 'dark:bg-blue-950/30',
    darkBorderColor: 'dark:border-blue-800',
    darkHoverBg: 'dark:hover:bg-blue-950/50',
    icon: ShieldCheck,
    badgeClass: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
  },
  'Pain/Inflammation': {
    color: 'text-rose-600 dark:text-rose-400',
    bgColor: 'bg-rose-50',
    borderColor: 'border-rose-200',
    hoverBg: 'hover:bg-rose-100',
    darkBgColor: 'dark:bg-rose-950/30',
    darkBorderColor: 'dark:border-rose-800',
    darkHoverBg: 'dark:hover:bg-rose-950/50',
    icon: Flame,
    badgeClass: 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300',
  },
  'Diabetes': {
    color: 'text-violet-600 dark:text-violet-400',
    bgColor: 'bg-violet-50',
    borderColor: 'border-violet-200',
    hoverBg: 'hover:bg-violet-100',
    darkBgColor: 'dark:bg-violet-950/30',
    darkBorderColor: 'dark:border-violet-800',
    darkHoverBg: 'dark:hover:bg-violet-950/50',
    icon: Droplets,
    badgeClass: 'bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300',
  },
  'Hypertension': {
    color: 'text-amber-600 dark:text-amber-400',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-200',
    hoverBg: 'hover:bg-amber-100',
    darkBgColor: 'dark:bg-amber-950/30',
    darkBorderColor: 'dark:border-amber-800',
    darkHoverBg: 'dark:hover:bg-amber-950/50',
    icon: Heart,
    badgeClass: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300',
  },
  'GERD/Acid Reflux': {
    color: 'text-teal-600 dark:text-teal-400',
    bgColor: 'bg-teal-50',
    borderColor: 'border-teal-200',
    hoverBg: 'hover:bg-teal-100',
    darkBgColor: 'dark:bg-teal-950/30',
    darkBorderColor: 'dark:border-teal-800',
    darkHoverBg: 'dark:hover:bg-teal-950/50',
    icon: CircleDot,
    badgeClass: 'bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-300',
  },
  'Fever/Pain': {
    color: 'text-orange-600 dark:text-orange-400',
    bgColor: 'bg-orange-50',
    borderColor: 'border-orange-200',
    hoverBg: 'hover:bg-orange-100',
    darkBgColor: 'dark:bg-orange-950/30',
    darkBorderColor: 'dark:border-orange-800',
    darkHoverBg: 'dark:hover:bg-orange-950/50',
    icon: Thermometer,
    badgeClass: 'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300',
  },
}

const PRESCRIPTION_TEMPLATES: PrescriptionTemplate[] = [
  {
    name: 'Amoxicillin',
    dosage: '500mg',
    frequency: 'Three times daily',
    duration: '7 days',
    instructions: 'Complete the full course of antibiotics',
    category: 'Antibiotic',
  },
  {
    name: 'Ibuprofen',
    dosage: '400mg',
    frequency: 'Three times daily',
    duration: '5 days',
    instructions: 'Take with food to reduce stomach upset',
    category: 'Pain/Inflammation',
  },
  {
    name: 'Metformin',
    dosage: '500mg',
    frequency: 'Twice daily',
    duration: 'Ongoing',
    instructions: 'Take with meals to minimize GI effects',
    category: 'Diabetes',
  },
  {
    name: 'Lisinopril',
    dosage: '10mg',
    frequency: 'Once daily',
    duration: 'Ongoing',
    instructions: 'Monitor blood pressure regularly',
    category: 'Hypertension',
  },
  {
    name: 'Omeprazole',
    dosage: '20mg',
    frequency: 'Once daily',
    duration: '14 days',
    instructions: 'Take 30 minutes before breakfast',
    category: 'GERD/Acid Reflux',
  },
  {
    name: 'Paracetamol',
    dosage: '500mg',
    frequency: 'Every 6 hours',
    duration: '5 days',
    instructions: 'Take with water, do not exceed 4g per day',
    category: 'Fever/Pain',
  },
  {
    name: 'Azithromycin',
    dosage: '250mg',
    frequency: 'Once daily',
    duration: '5 days',
    instructions: 'Take on an empty stomach, 1 hour before or 2 hours after meals',
    category: 'Antibiotic',
  },
  {
    name: 'Losartan',
    dosage: '50mg',
    frequency: 'Once daily',
    duration: 'Ongoing',
    instructions: 'May be taken with or without food. Monitor kidney function.',
    category: 'Hypertension',
  },
]

const ALL_CATEGORIES: MedicationCategory[] = [
  'Antibiotic',
  'Pain/Inflammation',
  'Diabetes',
  'Hypertension',
  'GERD/Acid Reflux',
  'Fever/Pain',
]

const emptyMedication = (): MedicationEntry => ({
  name: '',
  dosage: '',
  frequency: 'Once daily',
  duration: '7 days',
  instructions: '',
})

export function PrescriptionGenerator({
  open,
  onOpenChange,
  patientId,
  patientName,
  visitId,
  onSaved,
}: PrescriptionGeneratorProps) {
  const { toast } = useToast()
  const [medications, setMedications] = useState<MedicationEntry[]>([emptyMedication()])
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [templateSearch, setTemplateSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState<MedicationCategory | 'All'>('All')
  const [templatesExpanded, setTemplatesExpanded] = useState(true)

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => {
        setMedications([emptyMedication()])
        setNotes('')
        setTemplateSearch('')
        setActiveCategory('All')
        setTemplatesExpanded(true)
      }, 0)
      return () => clearTimeout(timer)
    }
  }, [open])

  const filteredTemplates = useMemo(() => {
    return PRESCRIPTION_TEMPLATES.filter((t) => {
      const matchesSearch =
        templateSearch === '' ||
        t.name.toLowerCase().includes(templateSearch.toLowerCase()) ||
        t.category.toLowerCase().includes(templateSearch.toLowerCase()) ||
        t.dosage.toLowerCase().includes(templateSearch.toLowerCase())
      const matchesCategory = activeCategory === 'All' || t.category === activeCategory
      return matchesSearch && matchesCategory
    })
  }, [templateSearch, activeCategory])

  const addMedication = () => {
    setMedications((prev) => [...prev, emptyMedication()])
  }

  const removeMedication = (index: number) => {
    if (medications.length <= 1) return
    setMedications((prev) => prev.filter((_, i) => i !== index))
  }

  const updateMedication = (index: number, field: keyof MedicationEntry, value: string) => {
    setMedications((prev) =>
      prev.map((med, i) => (i === index ? { ...med, [field]: value } : med))
    )
  }

  const applyTemplate = (template: PrescriptionTemplate) => {
    // Find the first empty medication row and pre-fill it
    const emptyIndex = medications.findIndex((m) => m.name.trim() === '')
    if (emptyIndex >= 0) {
      setMedications((prev) =>
        prev.map((med, i) =>
          i === emptyIndex
            ? {
                name: template.name,
                dosage: template.dosage,
                frequency: template.frequency,
                duration: template.duration,
                instructions: template.instructions,
              }
            : med
        )
      )
    } else {
      // All rows filled - add a new one
      setMedications((prev) => [
        ...prev,
        {
          name: template.name,
          dosage: template.dosage,
          frequency: template.frequency,
          duration: template.duration,
          instructions: template.instructions,
        },
      ])
    }
    toast({
      title: `${template.name} ${template.dosage} applied`,
      description: `Filled from ${template.category} template`,
    })
  }

  const handleSave = async () => {
    const validMeds = medications.filter((m) => m.name.trim() !== '')
    if (validMeds.length === 0) {
      toast({ title: 'Please add at least one medication', variant: 'destructive' })
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/prescriptions',  { credentials: 'include',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientId,
          visitId: visitId || null,
          medications: validMeds,
          notes: notes.trim() || null,
        }),
      })
      if (res.ok) {
        const saved = await res.json()
        toast({ title: 'Prescription Created' })
        onOpenChange(false)
        onSaved?.(saved)
      } else {
        const err = await res.json()
        toast({ title: err.error || 'Failed to create prescription', variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Error creating prescription', variant: 'destructive' })
    }
    setSaving(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Pill className="h-5 w-5 text-emerald-600" />
            New Prescription
          </DialogTitle>
          <DialogDescription>
            Create a prescription for {patientName}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          {/* Templates Section */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <button
                type="button"
                className="flex items-center gap-1.5 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
                onClick={() => setTemplatesExpanded(!templatesExpanded)}
              >
                <LayoutTemplate className="h-4 w-4 text-emerald-600" />
                Quick Templates
                <span className="text-xs text-muted-foreground font-normal">({PRESCRIPTION_TEMPLATES.length} available)</span>
                <motion.span
                  animate={{ rotate: templatesExpanded ? 180 : 0 }}
                  transition={{ duration: 0.2 }}
                  className="text-muted-foreground"
                >
                  ▾
                </motion.span>
              </button>
            </div>

            <AnimatePresence>
              {templatesExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className="overflow-hidden"
                >
                  {/* Search */}
                  <div className="relative mb-2.5">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Search templates..."
                      value={templateSearch}
                      onChange={(e) => setTemplateSearch(e.target.value)}
                      className="h-8 pl-8 pr-8 text-sm"
                    />
                    {templateSearch && (
                      <button
                        type="button"
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        onClick={() => setTemplateSearch('')}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Category Filter Pills */}
                  <div className="flex gap-1.5 mb-3 flex-wrap">
                    <button
                      type="button"
                      onClick={() => setActiveCategory('All')}
                      className={cn(
                        'px-2.5 py-1 rounded-full text-xs font-medium transition-all',
                        activeCategory === 'All'
                          ? 'bg-emerald-600 text-white shadow-sm'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                      )}
                    >
                      All
                    </button>
                    {ALL_CATEGORIES.map((cat) => {
                      const config = CATEGORY_CONFIG[cat]
                      const Icon = config.icon
                      return (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => setActiveCategory(cat)}
                          className={cn(
                            'flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all',
                            activeCategory === cat
                              ? cn(config.bgColor, config.darkBgColor, config.color, 'shadow-sm ring-1 ring-current/20')
                              : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                          )}
                        >
                          <Icon className="h-3 w-3" />
                          <span className="hidden sm:inline">{cat}</span>
                          <span className="sm:hidden">{cat.split('/')[0]}</span>
                        </button>
                      )
                    })}
                  </div>

                  {/* Template Cards - Scrollable Horizontal Strip */}
                  {filteredTemplates.length > 0 ? (
                    <div className="overflow-x-auto pb-2 -mx-1 px-1">
                      <div className="flex gap-2 min-w-max">
                        {filteredTemplates.map((template) => {
                          const config = CATEGORY_CONFIG[template.category]
                          const Icon = config.icon
                          return (
                            <motion.button
                              key={template.name}
                              type="button"
                              whileHover={{ scale: 1.02, y: -1 }}
                              whileTap={{ scale: 0.98 }}
                              onClick={() => applyTemplate(template)}
                              className={cn(
                                'flex-shrink-0 w-[200px] rounded-lg border-l-4 p-3 text-left transition-all',
                                config.bgColor,
                                config.darkBgColor,
                                config.borderColor,
                                config.darkBorderColor,
                                config.hoverBg,
                                config.darkHoverBg,
                                'shadow-sm hover:shadow-md'
                              )}
                            >
                              <div className="flex items-start gap-2 mb-1.5">
                                <div className={cn('rounded-md p-1.5', config.badgeClass)}>
                                  <Icon className="h-3.5 w-3.5" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                                    {template.name}
                                  </p>
                                  <p className={cn('text-xs font-medium', config.color)}>
                                    {template.category}
                                  </p>
                                </div>
                              </div>
                              <div className="space-y-0.5">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs font-bold text-gray-800 dark:text-gray-200">
                                    {template.dosage}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
                                  <span>{template.frequency}</span>
                                  <span className="text-gray-300 dark:text-gray-600">·</span>
                                  <span>{template.duration}</span>
                                </div>
                              </div>
                            </motion.button>
                          )
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-6 text-sm text-muted-foreground">
                      <Search className="h-8 w-8 mx-auto mb-2 opacity-30" />
                      <p>No templates match &ldquo;{templateSearch}&rdquo;</p>
                      <p className="text-xs mt-1">Try a different search term</p>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Medication List */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                Medications ({medications.length})
              </h4>
              <Badge variant="outline" className="text-xs text-emerald-600 border-emerald-200 dark:border-emerald-800">
                <Sparkles className="h-3 w-3 mr-1" />
                {medications.filter((m) => m.name.trim() !== '').length} filled
              </Badge>
            </div>

            <AnimatePresence>
              {medications.map((med, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 space-y-2 bg-gray-50/50 dark:bg-gray-800/30"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-medium text-emerald-600 flex-shrink-0">
                      #{index + 1}
                    </span>
                    {medications.length > 1 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/50 flex-shrink-0"
                        onClick={() => removeMedication(index)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <Input
                      placeholder="Medication name"
                      value={med.name}
                      onChange={(e) => updateMedication(index, 'name', e.target.value)}
                      className="h-9"
                    />
                    <Input
                      placeholder="Dosage (e.g. 500mg)"
                      value={med.dosage}
                      onChange={(e) => updateMedication(index, 'dosage', e.target.value)}
                      className="h-9"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <Select
                      value={med.frequency}
                      onValueChange={(v) => updateMedication(index, 'frequency', v)}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="Frequency" />
                      </SelectTrigger>
                      <SelectContent>
                        {FREQUENCY_OPTIONS.map((opt) => (
                          <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Select
                      value={med.duration}
                      onValueChange={(v) => updateMedication(index, 'duration', v)}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="Duration" />
                      </SelectTrigger>
                      <SelectContent>
                        {DURATION_OPTIONS.map((opt) => (
                          <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <Textarea
                    placeholder="Special instructions (optional)"
                    value={med.instructions}
                    onChange={(e) => updateMedication(index, 'instructions', e.target.value)}
                    className="min-h-[60px] text-sm resize-none"
                  />
                </motion.div>
              ))}
            </AnimatePresence>

            <Button
              variant="outline"
              size="sm"
              onClick={addMedication}
              className="w-full border-dashed border-emerald-300 dark:border-emerald-700 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/20"
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Add Medication
            </Button>
          </div>

          {/* Notes */}
          <div>
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
              Prescription Notes
            </h4>
            <Textarea
              placeholder="Additional notes or instructions for the patient..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="min-h-[80px] resize-none"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0 flex-shrink-0 pt-2 border-t border-gray-100 dark:border-gray-800">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || medications.every((m) => !m.name.trim())}
            className="bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-teal-600 text-white"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                Saving...
              </>
            ) : (
              <>
                <Pill className="h-4 w-4 mr-1.5" />
                Create Prescription
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
