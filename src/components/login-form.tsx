'use client'

import { useState } from 'react'
import { doctorInfoFromMeResponse } from '@/lib/auth-me'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/store/app-store'
import { motion, AnimatePresence } from 'framer-motion'
import { Shield, Mail, Lock, Loader2, Stethoscope, Heart, FileText, ScanLine, Check, Eye, EyeOff } from 'lucide-react'

export function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [rememberMe, setRememberMe] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const { toast } = useToast()
  const setCurrentView = useAppStore((s) => s.setCurrentView)
  const setDoctorInfo = useAppStore((s) => s.setDoctorInfo)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      // Login via Fastify API service
      const loginRes = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        credentials: 'include',
      })

      if (loginRes.ok) {
        const loginData = await loginRes.json().catch(() => null)
        // Fetch current user info
        try {
          const meRes = await fetch('/api/auth/me', { credentials: 'include' })
          if (meRes.ok) {
            const meData = await meRes.json()
            // PFT run 34701835070 fix: the me response nests the user
            // object ({ user: { ... } }) — the shared parser normalizes it.
            const info = doctorInfoFromMeResponse(meData, email)
            setDoctorInfo(info.name, info.email, info.id)
          } else {
            const info = doctorInfoFromMeResponse(loginData?.user, email)
            setDoctorInfo(info.name, info.email, info.id)
          }
        } catch {
          const info = doctorInfoFromMeResponse(null, email)
          setDoctorInfo(info.name, info.email, info.id)
        }
        setCurrentView('dashboard')
        toast({
          title: 'Welcome back!',
          description: 'You have successfully logged in.',
        })
      } else {
        setError('Invalid email or password. Please try again.')
        toast({
          title: 'Login Failed',
          description: 'Please check your credentials and try again.',
          variant: 'destructive',
        })
      }
    } catch {
      setError('An error occurred. Please try again.')
      toast({
        title: 'Error',
        description: 'Something went wrong. Please try again.',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  const handleSetup = () => {
    setCurrentView('setup')
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden animated-gradient">
      {/* Animated heartbeat SVG pattern background */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="none" viewBox="0 0 800 600">
          <defs>
            <linearGradient id="heartbeatGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="oklch(0.696 0.17 162.48)" stopOpacity="0.06" />
              <stop offset="50%" stopColor="oklch(0.6 0.118 184.704)" stopOpacity="0.04" />
              <stop offset="100%" stopColor="oklch(0.696 0.17 162.48)" stopOpacity="0.06" />
            </linearGradient>
          </defs>
          {/* Heartbeat line 1 */}
          <motion.path
            d="M-50,300 L150,300 L200,300 L220,300 L240,260 L260,340 L280,240 L300,320 L320,280 L340,300 L600,300 L850,300"
            fill="none"
            stroke="url(#heartbeatGrad)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 3, ease: 'easeInOut' }}
          />
          {/* Heartbeat line 2 - offset */}
          <motion.path
            d="M-50,420 L200,420 L350,420 L370,420 L390,380 L410,460 L430,360 L450,440 L470,400 L490,420 L650,420 L850,420"
            fill="none"
            stroke="url(#heartbeatGrad)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 3.5, ease: 'easeInOut', delay: 0.5 }}
          />
        </svg>
      </div>

      {/* Floating blurred circles */}
      <div className="absolute inset-0 opacity-40 dark:opacity-20 pointer-events-none">
        <div className="absolute top-[10%] left-[15%] w-64 h-64 rounded-full bg-emerald-300/20 blur-3xl login-bg-circle-1" />
        <div className="absolute bottom-[15%] right-[10%] w-80 h-80 rounded-full bg-teal-300/20 blur-3xl login-bg-circle-2" />
        <div className="absolute top-[50%] right-[30%] w-48 h-48 rounded-full bg-emerald-200/15 blur-2xl login-bg-circle-3" />
      </div>

      {/* Floating medical cross SVGs */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <svg className="absolute top-[8%] left-[8%] w-8 h-8 text-emerald-400 medical-cross-bg opacity-[0.08]" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2zm-3 10h-3v3h-2v-3H8v-2h3V8h2v3h3v2z"/>
        </svg>
        <svg className="absolute top-[20%] right-[12%] w-6 h-6 text-teal-400 medical-cross-bg-delayed opacity-[0.06]" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2zm-3 10h-3v3h-2v-3H8v-2h3V8h2v3h3v2z"/>
        </svg>
        <svg className="absolute bottom-[25%] left-[20%] w-10 h-10 text-emerald-500 medical-cross-bg-slow opacity-[0.07]" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2zm-3 10h-3v3h-2v-3H8v-2h3V8h2v3h3v2z"/>
        </svg>
        <svg className="absolute bottom-[12%] right-[25%] w-5 h-5 text-teal-500 medical-cross-bg opacity-[0.05]" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2zm-3 10h-3v3h-2v-3H8v-2h3V8h2v3h3v2z"/>
        </svg>
        {/* Floating small circles */}
        <div className="absolute top-[35%] left-[75%] w-3 h-3 rounded-full bg-emerald-400 medical-cross-bg-delayed opacity-[0.1]" />
        <div className="absolute top-[60%] left-[10%] w-2 h-2 rounded-full bg-teal-400 medical-cross-bg-slow opacity-[0.12]" />
        <div className="absolute top-[75%] left-[55%] w-4 h-4 rounded-full bg-emerald-300 medical-cross-bg opacity-[0.08]" />
      </div>

      <motion.div
        className="w-full max-w-md relative z-10"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        {/* Logo & Brand */}
        <div className="text-center mb-8">
          <motion.div
            className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white mb-4 shadow-xl shadow-emerald-200/50 dark:shadow-emerald-900/30 login-logo-glow"
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 260, damping: 20, delay: 0.1 }}
            whileHover={{ scale: 1.08, rotate: 2 }}
          >
            <Stethoscope className="w-10 h-10" />
          </motion.div>
          <motion.div
            className="flex items-center justify-center gap-2.5"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-white">
              MediVault
            </h1>
            <motion.span
              className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/50 shadow-sm"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.4, type: 'spring', stiffness: 400 }}
            >
              v2.0
            </motion.span>
          </motion.div>
          <motion.p
            className="text-muted-foreground mt-1"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
          >
            Secure Medical Document Management
          </motion.p>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.4 }}
        >
          <Card className="shadow-xl border-0 dark:bg-gray-900/80 dark:border dark:border-gray-800 login-card-frosted relative overflow-hidden">
            {/* Gradient top border - 3px emerald to teal */}
            <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-600" />
            
            <CardHeader className="text-center pb-2 pt-6">
              <CardTitle className="text-xl">Sign In</CardTitle>
              <CardDescription>
                Access your patient documents securely
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
                      className="p-3 rounded-lg bg-red-50 dark:bg-red-950/50 border-l-[3px] border-l-red-500 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm"
                    >
                      {error}
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="space-y-2">
                  <div className="floating-label-group">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-[5] transition-colors duration-300" />
                    <Input
                      id="email"
                      type="email"
                      placeholder=" "
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="pl-10 transition-all duration-300 focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 dark:focus:border-emerald-600 h-11 peer login-input-focus"
                      required
                    />
                    <Label htmlFor="email" className="floating-label-group">Email</Label>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="floating-label-group">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-[5] transition-colors duration-300" />
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder=" "
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pl-10 pr-10 transition-all duration-300 focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-400 dark:focus:border-emerald-600 h-11 peer login-input-focus"
                      required
                    />
                    <Label htmlFor="password" className="floating-label-group">Password</Label>
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 z-[5] text-muted-foreground hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors duration-200"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      <motion.div
                        animate={{ rotate: showPassword ? 0 : 180 }}
                        transition={{ duration: 0.3 }}
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </motion.div>
                    </button>
                  </div>
                </div>

                {/* Remember Me + Forgot Password */}
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2.5 cursor-pointer group">
                    <div className="relative">
                      <input
                        type="checkbox"
                        checked={rememberMe}
                        onChange={(e) => setRememberMe(e.target.checked)}
                        className="peer sr-only"
                      />
                      <div className="w-5 h-5 rounded-md border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 flex items-center justify-center transition-all duration-200 peer-checked:border-emerald-500 peer-checked:bg-emerald-500 group-hover:border-emerald-400 dark:group-hover:border-emerald-600">
                        <motion.div
                          initial={false}
                          animate={{ scale: rememberMe ? 1 : 0, opacity: rememberMe ? 1 : 0 }}
                          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                        >
                          <Check className="h-3 w-3 text-white" />
                        </motion.div>
                      </div>
                    </div>
                    <span className="text-sm text-muted-foreground select-none">Remember me</span>
                  </label>
                  <motion.a
                    href="#"
                    className="text-sm text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 hover:underline underline-offset-2 transition-colors duration-200"
                    whileHover={{ x: 1 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={(e) => e.preventDefault()}
                  >
                    Forgot password?
                  </motion.a>
                </div>

                {/* Gradient divider line */}
                <div className="gradient-divider" />

                {/* Sign In Button with shimmer animation and gradient shadow */}
                <motion.div whileTap={{ scale: 0.98 }} className="relative">
                  {/* Gradient shadow below button */}
                  <div className="absolute -bottom-2 left-[10%] right-[10%] h-4 bg-gradient-to-r from-emerald-500/30 via-teal-400/25 to-emerald-500/30 blur-lg rounded-full pointer-events-none" />
                  <Button
                    type="submit"
                    className="w-full bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-teal-600 text-white shadow-md shadow-emerald-200/50 dark:shadow-emerald-900/30 h-11 transition-all duration-300 hover:shadow-lg hover:shadow-emerald-300/50 dark:hover:shadow-emerald-900/50 relative overflow-hidden shimmer"
                    disabled={loading}
                  >
                    <AnimatePresence mode="wait">
                      {loading ? (
                        <motion.span
                          key="loading"
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          className="flex items-center"
                        >
                          <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>
                            <Loader2 className="mr-2 h-4 w-4" />
                          </motion.div>
                          Signing in...
                        </motion.span>
                      ) : (
                        <motion.span
                          key="idle"
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          className="flex items-center"
                        >
                          <Shield className="mr-2 h-4 w-4" />
                          Sign In
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </Button>
                </motion.div>

                {/* Terms of Service and Privacy Policy */}
                <p className="text-center text-xs text-muted-foreground">
                  By signing in, you agree to our{' '}
                  <a href="#" className="text-emerald-600 dark:text-emerald-400 hover:underline underline-offset-2 transition-colors">
                    Terms of Service
                  </a>{' '}
                  and{' '}
                  <a href="#" className="text-emerald-600 dark:text-emerald-400 hover:underline underline-offset-2 transition-colors">
                    Privacy Policy
                  </a>
                </p>
              </form>

              <div className="mt-6 pt-6 border-t dark:border-gray-800 text-center">
                <p className="text-sm text-muted-foreground mb-3">
                  First time using MediVault?
                </p>
                <motion.div whileTap={{ scale: 0.98 }}>
                  <Button variant="outline" onClick={handleSetup} className="w-full h-11 transition-all duration-200 hover:border-emerald-300 dark:hover:border-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/20">
                    Set Up Your Account
                  </Button>
                </motion.div>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Feature Cards - Staggered entrance with hover glow effects */}
        <div className="mt-8 grid grid-cols-3 gap-3 sm:gap-4">
          {[
            { icon: ScanLine, label: 'Scan Documents', desc: 'Camera capture', color: 'emerald', floatClass: 'float-gentle' },
            { icon: FileText, label: 'Secure Storage', desc: 'Local & offline', color: 'teal', floatClass: 'float-gentle-delay-1' },
            { icon: Heart, label: 'Patient Care', desc: 'Organized records', color: 'rose', floatClass: 'float-gentle-delay-2' },
          ].map((feature, index) => (
            <motion.div
              key={feature.label}
              className="group relative overflow-hidden rounded-xl p-3 sm:p-4 text-center bg-white/60 dark:bg-gray-900/40 glass shine-sweep cursor-default feature-card-glow"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 + index * 0.15, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              whileHover={{ y: -4, scale: 1.04 }}
            >
              <motion.div
                className="absolute inset-0 bg-gradient-to-br opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-xl"
                style={{
                  background: feature.color === 'emerald'
                    ? 'linear-gradient(to bottom right, rgba(16, 185, 129, 0.08), rgba(20, 184, 166, 0.08))'
                    : feature.color === 'teal'
                    ? 'linear-gradient(to bottom right, rgba(20, 184, 166, 0.08), rgba(16, 185, 129, 0.08))'
                    : 'linear-gradient(to bottom right, rgba(244, 63, 94, 0.08), rgba(249, 115, 22, 0.08))',
                }}
              />
              <div className={`${feature.floatClass}`}>
                <div className={`w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-${feature.color}-50 dark:bg-${feature.color}-950/30 flex items-center justify-center mx-auto mb-1.5 transition-all duration-300 group-hover:scale-110 group-hover:shadow-md relative z-10`}>
                  <feature.icon className={`h-5 w-5 text-${feature.color}-600`} />
                </div>
              </div>
              <p className="text-xs font-medium text-gray-900 dark:text-white relative z-10">{feature.label}</p>
              <p className="text-[11px] text-muted-foreground relative z-10">{feature.desc}</p>
            </motion.div>
          ))}
        </div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="text-center text-xs text-muted-foreground mt-6 flex items-center justify-center gap-1"
        >
          <Shield className="h-3 w-3" />
          End-to-end encrypted &bull; HIPAA compliant design
        </motion.p>
      </motion.div>
    </div>
  )
}
