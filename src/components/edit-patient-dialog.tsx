'use client'

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Loader2, User, Calendar, Phone, Mail, MapPin, StickyNote, Save } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useToast } from '@/hooks/use-toast'
import { useT } from '@/i18n'
import type { PatientInfo } from '@/store/app-store'

interface EditPatientDialogProps {
  patient: PatientInfo
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (patient: PatientInfo) => void
}

export function EditPatientDialog({
  patient,
  open,
  onOpenChange,
  onSaved,
}: EditPatientDialogProps) {
  const { toast } = useToast()

  const t = useT()
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [address, setAddress] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Reset form when dialog opens or patient changes
  useEffect(() => {
    if (open && patient) {
      setFirstName(patient.firstName)
      setLastName(patient.lastName)
      setDateOfBirth(patient.dateOfBirth || '')
      setPhone(patient.phone || '')
      setEmail(patient.email || '')
      setAddress(patient.address || '')
      setNotes(patient.notes || '')
      setError('')
    }
  }, [open, patient])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!firstName.trim() || !lastName.trim()) {
      setError(t('errors.namesRequired'))
      return
    }

    setLoading(true)

    try {
      const res = await fetch(`/api/patients/${patient.id}`,  { credentials: 'include',
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          dateOfBirth: dateOfBirth || null,
          phone: phone.trim() || null,
          email: email.trim() || null,
          address: address.trim() || null,
          notes: notes.trim() || null,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || t('errors.updatePatientFailed'))
        return
      }

      const updated = await res.json()
      onSaved(updated)
      onOpenChange(false)
      toast({
        title: t('patients.updatedTitle'),
        description: t('patients.updatedDesc', { name: `${updated.firstName} ${updated.lastName}` }),
      })
    } catch {
      setError(t('errors.updatePatientRetry'))
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    if (!loading) {
      setError('')
      onOpenChange(false)
    }
  }

  const requiredFilled = [firstName.trim(), lastName.trim()].filter(Boolean).length
  const optionalFilled = [
    dateOfBirth,
    phone,
    email,
    address,
    notes,
  ].filter(Boolean).length
  const totalFields = 7
  const completedFields = requiredFilled + optionalFilled
  const completionPercent = Math.round((completedFields / totalFields) * 100)

  const formVariants = {
    hidden: { opacity: 0, y: 8 },
    visible: (i: number) => ({
      opacity: 1,
      y: 0,
      transition: { delay: i * 0.05, duration: 0.25, ease: 'easeOut' as const },
    }),
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
              <Save className="h-4 w-4 text-white" />
            </div>
            {t('patients.editPatient')}
          </DialogTitle>
          <DialogDescription>
            {t('patients.editDescription', { name: `${patient.firstName} ${patient.lastName}` })}
          </DialogDescription>
        </DialogHeader>

        {/* Progress indicator */}
        <div className="space-y-1.5 px-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{t('patients.completion')}</span>
            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 tabular-nums">
              {completionPercent}%
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-500"
              initial={{ width: 0 }}
              animate={{ width: `${completionPercent}%` }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
            />
          </div>
          <span className="text-[11px] text-muted-foreground">
            {t('patients.fieldsFilled', { filled: completedFields, total: totalFields })}
          </span>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 mt-1">
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="p-3 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm"
              >
                {error}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Required: Name fields */}
          <motion.div
            className="grid grid-cols-2 gap-3"
            custom={0}
            initial="hidden"
            animate="visible"
            variants={formVariants}
          >
            <div className="space-y-2">
              <Label htmlFor="edit-firstName" className="flex items-center gap-1.5">
                <User className="h-3.5 w-3.5 text-emerald-600" />
                {t('patients.firstName')} <span className="text-red-500">*</span>
              </Label>
              <Input
                id="edit-firstName"
                placeholder={t('patients.firstNamePlaceholder')}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="transition-all duration-200 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-lastName" className="flex items-center gap-1.5">
                <User className="h-3.5 w-3.5 text-emerald-600" />
                {t('patients.lastName')} <span className="text-red-500">*</span>
              </Label>
              <Input
                id="edit-lastName"
                placeholder={t('patients.lastNamePlaceholder')}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="transition-all duration-200 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400"
                required
              />
            </div>
          </motion.div>

          {/* Optional fields separator */}
          <motion.div
            className="relative"
            custom={1}
            initial="hidden"
            animate="visible"
            variants={formVariants}
          >
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-gray-200 dark:border-gray-700" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="px-2 bg-white dark:bg-gray-900 text-muted-foreground rounded">
                {t('patients.optionalDetails')}
              </span>
            </div>
          </motion.div>

          {/* Date of Birth */}
          <motion.div
            className="space-y-2"
            custom={2}
            initial="hidden"
            animate="visible"
            variants={formVariants}
          >
            <Label htmlFor="edit-dob" className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
              {t('patients.dateOfBirth')}
            </Label>
            <Input
              id="edit-dob"
              type="date"
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
              className="transition-all duration-200 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400"
            />
          </motion.div>

          {/* Phone & Email */}
          <motion.div
            className="grid grid-cols-2 gap-3"
            custom={3}
            initial="hidden"
            animate="visible"
            variants={formVariants}
          >
            <div className="space-y-2">
              <Label htmlFor="edit-phone" className="flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                {t('patients.phone')}
              </Label>
              <Input
                id="edit-phone"
                type="tel"
                placeholder="+1 234 567 8900"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="transition-all duration-200 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-email" className="flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                {t('patients.email')}
              </Label>
              <Input
                id="edit-email"
                type="email"
                placeholder="patient@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="transition-all duration-200 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400"
              />
            </div>
          </motion.div>

          {/* Address */}
          <motion.div
            className="space-y-2"
            custom={4}
            initial="hidden"
            animate="visible"
            variants={formVariants}
          >
            <Label htmlFor="edit-address" className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
              {t('patients.address')}
            </Label>
            <Input
              id="edit-address"
              placeholder={t('patients.addressPlaceholder')}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="transition-all duration-200 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400"
            />
          </motion.div>

          {/* Notes */}
          <motion.div
            className="space-y-2"
            custom={5}
            initial="hidden"
            animate="visible"
            variants={formVariants}
          >
            <Label htmlFor="edit-notes" className="flex items-center gap-1.5">
              <StickyNote className="h-3.5 w-3.5 text-muted-foreground" />
              {t('patients.notes')}
            </Label>
            <Textarea
              id="edit-notes"
              placeholder={t('patients.notesPlaceholder')}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="transition-all duration-200 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400 resize-none"
            />
          </motion.div>

          <DialogFooter className="gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={loading}
              className="transition-all duration-200"
            >
              {t('common.cancel')}
            </Button>
            <motion.div whileTap={{ scale: 0.98 }}>
              <Button
                type="submit"
                className="bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-teal-600 text-white shadow-md shadow-emerald-200/40 dark:shadow-emerald-900/30 transition-all duration-300"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Loader2 className="me-2 h-4 w-4 animate-spin" />
                    {t('common.saving')}
                  </>
                ) : (
                  <>
                    <Save className="me-2 h-4 w-4" />
                    {t('common.saveChanges')}
                  </>
                )}
              </Button>
            </motion.div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
