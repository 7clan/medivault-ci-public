'use client'

import { useState, useMemo } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/store/app-store'
import { motion, AnimatePresence } from 'framer-motion'
import { Stethoscope, Mail, Lock, Phone, Loader2, ArrowLeft, UserPlus, Check, Shield, X, Plus } from 'lucide-react'

const SPECIALTY_PRESETS = [
  'General Medicine',
  'Cardiology',
  'Dermatology',
  'Pediatrics',
  'Orthopedics',
  'Neurology',
  'Oncology',
  'Ophthalmology',
  'Psychiatry',
  'Radiology',
  'Urology',
  'ENT',
]

export function SetupForm() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [phone, setPhone] = useState('')
  const [specialty, setSpecialty] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const { toast } = useToast()
  const setCurrentView = useAppStore((s) => s.setCurrentView)
  const setDoctorInfo = useAppStore((s) => s.setDoctorInfo)

  // Determine current step based on form state
  const currentStep = useMemo(() => {
    if (name.trim() && email.trim()) {
      if (password.length >= 6 && confirmPassword.length >= 6 && confirmPassword === password) {
        return 3
      }
      return 2
    }
    return 1
  }, [name, email, password, confirmPassword])

  // Form completion tracking
  const formProgress = useMemo(() => {
    let filled = 0
    const total = 4 // name, email, password, confirmPassword
    if (name.trim()) filled++
    if (email.trim()) filled++
    if (password.length >= 6) filled++
    if (confirmPassword.length >= 6 && confirmPassword === password) filled++
    return Math.round((filled / total) * 100)
  }, [name, email, password, confirmPassword])

  // Password strength checks
  const passwordChecks = useMemo(() => ({
    length: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    numbers: /[0-9]/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
  }), [password])

  // Password strength calculation
  const passwordStrength = useMemo(() => {
    if (!password) return { score: 0, label: '', color: '' }
    const passed = Object.values(passwordChecks).filter(Boolean).length
    if (passed <= 1) return { score: 1, label: 'Weak', color: 'bg-red-500' }
    if (passed <= 2) return { score: 2, label: 'Fair', color: 'bg-amber-500' }
    if (passed <= 3) return { score: 3, label: 'Good', color: 'bg-teal-500' }
    if (passed <= 4) return { score: 4, label: 'Strong', color: 'bg-emerald-500' }
    return { score: 5, label: 'Excellent', color: 'bg-emerald-400' }
  }, [password, passwordChecks])

  // Password match state
  const passwordMatch = useMemo(() => {
    if (!confirmPassword) return null
    return confirmPassword === password
  }, [confirmPassword, password])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }

    setLoading(true)

    try {
      const res = await fetch('/api/auth/setup',  { credentials: 'include',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password, phone, specialty }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Failed to create account.')
        return
      }

      // Auto-login after setup using Fastify JWT auth
      const loginRes = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        credentials: 'include',
      })
      if (loginRes.ok) {
        setDoctorInfo(name, email, data.id)
        setCurrentView('dashboard')
        toast({
          title: 'Account Created!',
          description: 'Welcome to MediVault. Your account is ready.',
        })
        return
      }
      // Fallback: account created but auto-login failed
      setDoctorInfo(name, email, data.id)
      setCurrentView('login')
      setError('Account created but auto-login failed. Please sign in.')
    } catch {
      setError('An error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden animated-gradient">
      {/* Animated background blobs */}
      <div className="absolute inset-0 opacity-40 dark:opacity-20 pointer-events-none">
        <div className="absolute top-[20%] right-[20%] w-72 h-72 rounded-full bg-teal-300/20 blur-3xl animate-pulse" />
        <div className="absolute bottom-[10%] left-[15%] w-56 h-56 rounded-full bg-emerald-300/20 blur-3xl animate-pulse [animation-delay:1.5s]" />
      </div>

      {/* Medical cross background pattern */}
      <div className="absolute inset-0 medical-cross-pattern pointer-events-none opacity-60" />

      <div className="w-full max-w-md relative z-10">
        {/* Logo */}
        <div className="text-center mb-6">
          <motion.div
            className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white mb-4 shadow-xl shadow-emerald-200/50 dark:shadow-emerald-900/30 pulse-glow"
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          >
            <Stethoscope className="w-10 h-10" />
          </motion.div>
          <motion.h1
            className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            MediVault
          </motion.h1>
          <motion.p
            className="text-muted-foreground mt-1"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.15 }}
          >
            Set up your clinic account
          </motion.p>
        </div>

        {/* Multi-Step Progress Indicator */}
        <motion.div
          className="flex items-center justify-center gap-0 mb-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
        >
          <div className="flex items-center">
            {/* Step 1: Profile */}
            <motion.div
              className="flex flex-col items-center"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.25 }}
            >
              <div className={`w-10 h-10 rounded-full flex items-center justify-center shadow-md transition-all duration-500 ${
                currentStep >= 1
                  ? 'bg-emerald-500 text-white shadow-emerald-200 dark:shadow-emerald-900/30'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500'
              }`}>
                {currentStep > 1 ? (
                  <Check className="w-5 h-5" />
                ) : (
                  <Stethoscope className="w-5 h-5" />
                )}
              </div>
              <span className={`text-[11px] font-medium mt-1.5 transition-colors duration-300 ${
                currentStep >= 1
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-gray-400 dark:text-gray-500'
              }`}>Profile</span>
            </motion.div>

            {/* Connector 1 */}
            <div className="w-12 sm:w-16 h-[2px] mx-1 relative bg-gray-200 dark:bg-gray-700">
              <motion.div
                className={`absolute inset-y-0 left-0 transition-colors duration-500 ${
                  currentStep >= 2
                    ? 'bg-emerald-500'
                    : 'bg-gray-200 dark:bg-gray-700'
                }`}
                initial={{ width: currentStep >= 2 ? '100%' : '0%' }}
                animate={{ width: currentStep >= 2 ? '100%' : '0%' }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
              />
            </div>

            {/* Step 2: Security */}
            <motion.div
              className="flex flex-col items-center"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.35, type: 'spring' }}
            >
              <div className={`w-10 h-10 rounded-full flex items-center justify-center shadow-md transition-all duration-500 ${
                currentStep >= 2
                  ? currentStep > 2
                    ? 'bg-emerald-500 text-white shadow-emerald-200 dark:shadow-emerald-900/30'
                    : 'bg-gradient-to-br from-emerald-500 to-teal-500 text-white shadow-emerald-200 dark:shadow-emerald-900/30 ring-2 ring-emerald-300/50 dark:ring-emerald-700/50 pulse-glow'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500'
              }`}>
                {currentStep > 2 ? (
                  <Check className="w-5 h-5" />
                ) : (
                  <Shield className="w-5 h-5" />
                )}
              </div>
              <span className={`text-[11px] font-medium mt-1.5 transition-colors duration-300 ${
                currentStep >= 2
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-gray-400 dark:text-gray-500'
              }`}>Security</span>
            </motion.div>

            {/* Connector 2 */}
            <div className="w-12 sm:w-16 h-[2px] mx-1 relative bg-gray-200 dark:bg-gray-700">
              <motion.div
                className={`absolute inset-y-0 left-0 transition-colors duration-500 ${
                  currentStep >= 3
                    ? 'bg-emerald-500'
                    : 'bg-gray-200 dark:bg-gray-700'
                }`}
                initial={{ width: currentStep >= 3 ? '100%' : '0%' }}
                animate={{ width: currentStep >= 3 ? '100%' : `${formProgress}%` }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
              />
            </div>

            {/* Step 3: Specialty */}
            <motion.div
              className="flex flex-col items-center"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.45 }}
            >
              <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-500 ${
                currentStep >= 3
                  ? 'bg-emerald-500 text-white shadow-md shadow-emerald-200 dark:shadow-emerald-900/30'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500'
              }`}>
                {currentStep >= 3 ? (
                  <Check className="w-5 h-5" />
                ) : (
                  <Plus className="w-5 h-5" />
                )}
              </div>
              <span className={`text-[11px] font-medium mt-1.5 transition-colors duration-300 ${
                currentStep >= 3
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-gray-400 dark:text-gray-500'
              }`}>Specialty</span>
            </motion.div>
          </div>
        </motion.div>

        {/* Progress Bar */}
        <motion.div
          className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden mb-6"
          initial={{ opacity: 0, scaleX: 0 }}
          animate={{ opacity: 1, scaleX: 1 }}
          transition={{ delay: 0.3 }}
        >
          <motion.div
            className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 rounded-full"
            initial={{ width: '0%' }}
            animate={{ width: `${formProgress}%` }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          />
        </motion.div>

        {/* Animated Card Entrance with scale effect */}
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ delay: 0.25, duration: 0.5, type: 'spring', stiffness: 200, damping: 20 }}
        >
          <Card className="shadow-xl border-0 dark:bg-gray-900 glass shadow-emerald-glow">
            <CardHeader className="pb-2">
              <CardTitle className="text-xl flex items-center gap-2">
                <UserPlus className="h-5 w-5 text-emerald-600" />
                Create Your Account
              </CardTitle>
              <CardDescription>
                Fill in your details to get started
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
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

                <div className="space-y-2">
                  <Label htmlFor="name">Full Name *</Label>
                  <div className="relative">
                    <UserPlus className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="name"
                      placeholder="Dr. John Smith"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="pl-10 transition-all duration-300 focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 dark:focus:border-emerald-600 h-11"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="setup-email">Email *</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="setup-email"
                      type="email"
                      placeholder="doctor@clinic.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="pl-10 transition-all duration-300 focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 dark:focus:border-emerald-600 h-11"
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="password">Password *</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="password"
                        type="password"
                        placeholder="Min 6 chars"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="pl-10 transition-all duration-300 focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 dark:focus:border-emerald-600 h-11"
                        required
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="confirm-password">Confirm *</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="confirm-password"
                        type="password"
                        placeholder="Repeat password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className={`pl-10 pr-10 transition-all duration-300 focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 dark:focus:border-emerald-600 h-11 ${
                          passwordMatch === true ? 'border-emerald-400 dark:border-emerald-600' :
                          passwordMatch === false ? 'border-red-400 dark:border-red-600' : ''
                        }`}
                        required
                      />
                      {/* Password match indicator */}
                      <AnimatePresence>
                        {passwordMatch !== null && confirmPassword && (
                          <motion.div
                            className="absolute right-3 top-1/2 -translate-y-1/2"
                            initial={{ scale: 0, rotate: -90 }}
                            animate={{ scale: 1, rotate: 0 }}
                            exit={{ scale: 0 }}
                            transition={{ type: 'spring', stiffness: 500, damping: 15 }}
                          >
                            {passwordMatch ? (
                              <div className="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center">
                                <Check className="h-3 w-3 text-white" strokeWidth={3} />
                              </div>
                            ) : (
                              <div className="w-5 h-5 rounded-full bg-red-500 flex items-center justify-center">
                                <X className="h-3 w-3 text-white" strokeWidth={3} />
                              </div>
                            )}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                </div>

                {/* Password Strength Meter with individual checks */}
                <AnimatePresence>
                  {password && (
                    <motion.div
                      className="space-y-2"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      {/* Animated color bar */}
                      <div className="flex gap-1">
                        {[1, 2, 3, 4, 5].map((level) => (
                          <motion.div
                            key={level}
                            className="h-1.5 flex-1 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: level * 0.04 }}
                          >
                            <motion.div
                              className={`h-full rounded-full ${passwordStrength.color}`}
                              initial={{ width: '0%' }}
                              animate={{ width: passwordStrength.score >= level ? '100%' : '0%' }}
                              transition={{ duration: 0.3, ease: 'easeOut' }}
                            />
                          </motion.div>
                        ))}
                      </div>
                      {/* Individual check indicators */}
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                        {([['length', '8+ characters'], ['uppercase', 'Uppercase (A-Z)'], ['lowercase', 'Lowercase (a-z)'], ['numbers', 'Numbers (0-9)'], ['special', 'Special (!@#$)']] as const).map(([key, label]) => (
                          <motion.div
                            key={key}
                            className="flex items-center gap-1.5 text-xs"
                            initial={{ opacity: 0, x: -5 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: 0.05 }}
                          >
                            <motion.div
                              className={`w-3.5 h-3.5 rounded-full flex items-center justify-center transition-colors duration-300 ${
                                passwordChecks[key] ? 'bg-emerald-500' : 'bg-gray-200 dark:bg-gray-700'
                              }`}
                              animate={passwordChecks[key] ? { scale: [1, 1.2, 1] } : {}}
                              transition={{ type: 'tween', duration: 0.3 }}
                            >
                              {passwordChecks[key] && <Check className="h-2 w-2 text-white" strokeWidth={3} />}
                            </motion.div>
                            <span className={`transition-colors duration-300 ${passwordChecks[key] ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`}>
                              {label}
                            </span>
                          </motion.div>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Shield className="h-3 w-3" />
                        Password strength: <span className={`font-medium ${
                          passwordStrength.score <= 1 ? 'text-red-500' :
                          passwordStrength.score <= 2 ? 'text-amber-500' :
                          passwordStrength.score <= 3 ? 'text-teal-500' :
                          passwordStrength.score <= 4 ? 'text-emerald-500' :
                          'text-emerald-400'
                        }`}>{passwordStrength.label}</span>
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="space-y-2">
                  <Label htmlFor="phone">Phone (optional)</Label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="phone"
                      placeholder="+1 234 567 8900"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="pl-10 transition-all duration-300 focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 dark:focus:border-emerald-600 h-11"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="specialty">Specialty (optional)</Label>
                  {/* Specialty preset chips */}
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    <AnimatePresence>
                      {SPECIALTY_PRESETS.filter((s) =>
                        !specialty || s.toLowerCase().includes(specialty.toLowerCase())
                      ).slice(0, 6).map((preset) => (
                        <motion.button
                          key={preset}
                          type="button"
                          onClick={() => setSpecialty(specialty === preset ? '' : preset)}
                          className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all duration-200 border ${
                            specialty === preset
                              ? 'bg-emerald-500 text-white border-emerald-500 shadow-sm shadow-emerald-200/50 dark:shadow-emerald-900/30'
                              : 'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:border-emerald-300 dark:hover:border-emerald-700 hover:text-emerald-600 dark:hover:text-emerald-400'
                          }`}
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.8 }}
                          layout
                        >
                          {preset}
                        </motion.button>
                      ))}
                    </AnimatePresence>
                  </div>
                  <Input
                    id="specialty"
                    placeholder="Or type a custom specialty..."
                    value={specialty}
                    onChange={(e) => setSpecialty(e.target.value)}
                    className="transition-all duration-300 focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 dark:focus:border-emerald-600 h-11"
                  />
                </div>

                <motion.div whileTap={{ scale: 0.98 }}>
                  <Button
                    type="submit"
                    className="w-full bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-teal-600 text-white shadow-md shadow-emerald-200/50 dark:shadow-emerald-900/30 h-11 transition-all duration-300 hover:shadow-lg hover:shadow-emerald-300/50 dark:hover:shadow-emerald-900/50"
                    disabled={loading}
                  >
                    {loading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Creating Account...
                      </>
                    ) : (
                      <>
                        <UserPlus className="mr-2 h-4 w-4" />
                        Create Account & Start
                      </>
                    )}
                  </Button>
                </motion.div>
              </form>

              <div className="mt-4 text-center">
                <Button variant="ghost" size="sm" onClick={() => setCurrentView('login')} className="transition-all duration-200 hover:text-emerald-600">
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back to Sign In
                </Button>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  )
}
