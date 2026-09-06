'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Loader2, UserPlus, User, Calendar, Phone, Mail, MapPin, StickyNote, Shield } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

interface AddPatientDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (patient: any) => void
}

export function AddPatientDialog({ open, onOpenChange, onCreated }: AddPatientDialogProps) {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [address, setAddress] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/patients',  { credentials: 'include',
        method: 'POST',
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
        setError(data.error || 'Failed to create patient')
        return
      }

      const patient = await res.json()
      onCreated(patient)

      setFirstName('')
      setLastName('')
      setDateOfBirth('')
      setPhone('')
      setEmail('')
      setAddress('')
      setNotes('')
    } catch {
      setError('Failed to create patient. Please try again.')
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

  const filledCount = [firstName, lastName].filter(Boolean).length
  const optionalFilled = [dateOfBirth, phone, email, address, notes].filter(Boolean).length

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center">
              <UserPlus className="h-4 w-4 text-white" />
            </div>
            Add New Patient
          </DialogTitle>
          <DialogDescription>
            Enter the patient&apos;s information to create their profile
          </DialogDescription>
        </DialogHeader>

        {/* Progress indicator */}
        <div className="flex items-center gap-2 px-1">
          <div className="flex gap-1 flex-1">
            {[1, 2].map((step) => (
              <div
                key={step}
                className={`h-1 flex-1 rounded-full transition-all duration-300 ${
                  filledCount >= step ? 'bg-emerald-500' : 'bg-gray-200 dark:bg-gray-700'
                }`}
              />
            ))}
          </div>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {optionalFilled > 0 && `${optionalFilled} optional filled`}
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

          {/* Name fields with icons */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="firstName" className="flex items-center gap-1.5">
                <User className="h-3.5 w-3.5 text-emerald-600" />
                First Name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="firstName"
                placeholder="John"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="transition-all duration-200 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName" className="flex items-center gap-1.5">
                <User className="h-3.5 w-3.5 text-emerald-600" />
                Last Name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="lastName"
                placeholder="Smith"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="transition-all duration-200 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400"
                required
              />
            </div>
          </div>

          {/* Optional fields with visual separators */}
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-gray-200 dark:border-gray-700" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="px-2 bg-white dark:bg-gray-900 text-muted-foreground rounded">
                Optional Details
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="dob" className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
              Date of Birth
            </Label>
            <Input
              id="dob"
              type="date"
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
              className="transition-all duration-200 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="patientPhone" className="flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                Phone
              </Label>
              <Input
                id="patientPhone"
                type="tel"
                placeholder="+1 234 567 8900"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="transition-all duration-200 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="patientEmail" className="flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                Email
              </Label>
              <Input
                id="patientEmail"
                type="email"
                placeholder="patient@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="transition-all duration-200 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="address" className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
              Address
            </Label>
            <Input
              id="address"
              placeholder="123 Main St, City"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="transition-all duration-200 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes" className="flex items-center gap-1.5">
              <StickyNote className="h-3.5 w-3.5 text-muted-foreground" />
              Notes
            </Label>
            <Textarea
              id="notes"
              placeholder="Any additional notes about the patient..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="transition-all duration-200 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400 resize-none"
            />
          </div>

          <DialogFooter className="gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={loading}
              className="transition-all duration-200"
            >
              Cancel
            </Button>
            <motion.div whileTap={{ scale: 0.98 }}>
              <Button
                type="submit"
                className="bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-teal-600 text-white shadow-md shadow-emerald-200/40 dark:shadow-emerald-900/30 transition-all duration-300"
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Adding...
                  </>
                ) : (
                  <>
                    <UserPlus className="mr-2 h-4 w-4" />
                    Add Patient
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
