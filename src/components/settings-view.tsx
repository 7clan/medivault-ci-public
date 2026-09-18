'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/store/app-store'
import { formatFileSize } from '@/lib/utils-helpers'
import { useTheme } from 'next-themes'
import { motion } from 'framer-motion'
import {
  Download,
  HardDrive,
  Shield,
  User,
  Moon,
  Sun,
  Loader2,
  FolderDown,
  Database,
  Info,
  CheckCircle,
  Monitor,
  Smartphone,
  Usb,
  Disc,
  CloudUpload,
  Lock,
  Eye,
  Save,
  Palette,
  Users,
  FileText,
  Heart,
  Stethoscope,
  CheckCircle2,
  Clock,
  Edit3,
} from 'lucide-react'
import { useI18n } from '@/i18n'

export function SettingsView() {
  const { toast } = useToast()
  const { t, formatDate } = useI18n()
  const { doctorName, doctorEmail, setDoctorInfo } = useAppStore()
  const { theme, setTheme } = useTheme()
  const [stats, setStats] = useState<any>(null)
  const [backupLoading, setBackupLoading] = useState(false)
  const [name, setName] = useState(doctorName || '')
  const [savingProfile, setSavingProfile] = useState(false)

  // Circular progress calculation for storage
  const storageUsedMB = (stats?.totalStorage || 0) / (1024 * 1024)
  const storagePercent = Math.min((storageUsedMB / 1024) * 100, 100) // Assume 1GB cap
  const circumference = 2 * Math.PI * 42
  const fillOffset = circumference - (storagePercent / 100) * circumference

  useEffect(() => {
    const loadStats = async () => {
      try {
        const res = await fetch('/api/stats', { credentials: 'include' })
        if (res.ok) {
          const data = await res.json()
          setStats(data)
        }
      } catch (err) {
        console.error('Failed to load stats:', err)
      }
    }
    loadStats()
  }, [])

  const handleBackup = async () => {
    setBackupLoading(true)
    try {
      const res = await fetch('/api/backup', { credentials: 'include' })
      if (!res.ok) throw new Error('Backup failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `MediVault_Backup_${new Date().toISOString().split('T')[0]}.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast({
        title: t('header.backupCompleteTitle'),
        description: t('settings.backup.completeDesc'),
      })
    } catch {
      toast({
        title: t('header.backupFailedTitle'),
        description: t('header.backupFailedDesc'),
        variant: 'destructive',
      })
    }
    setBackupLoading(false)
  }

  const handleSaveProfile = () => {
    setSavingProfile(true)
    setTimeout(() => {
      setDoctorInfo(name, doctorEmail, null)
      toast({ title: t('settings.profile.updatedTitle'), description: t('settings.profile.updatedDesc') })
      setSavingProfile(false)
    }, 500)
  }

  const containerVariants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.08 },
    },
  }

  const itemVariants = {
    hidden: { opacity: 0, y: 12 },
    show: { opacity: 1, y: 0 },
  }

  return (
    <motion.div
      data-qa="settings-root"
      className="max-w-3xl mx-auto px-4 md:px-6 py-6 space-y-6"
      variants={containerVariants}
      initial="hidden"
      animate="show"
    >
      <motion.div variants={itemVariants}>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('settings.title')}</h1>
        <p className="text-muted-foreground mt-1">{t('settings.subtitle')}</p>
      </motion.div>

      {/* Doctor Profile - Enhanced with gradient avatar ring */}
      <motion.div variants={itemVariants}>
        <Card className="border-s-[3px] border-s-emerald-500 shadow-sm hover:shadow-md transition-shadow duration-300 card-hover-lift-enhanced">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <User className="h-4 w-4 text-emerald-600" />
              {t('settings.profile.title')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <motion.div
                className="flex-shrink-0 avatar-gradient-ring"
                whileHover={{ scale: 1.08 }}
                transition={{ type: 'spring', stiffness: 300 }}
              >
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center shadow-lg shadow-emerald-200/30 dark:shadow-emerald-900/30">
                  <span className="text-white font-bold text-2xl drop-shadow-sm">
                    {(doctorName || 'D')[0].toUpperCase()}
                  </span>
                </div>
              </motion.div>
              <div className="flex-1">
                <p className="font-semibold text-lg text-gray-900 dark:text-white">{doctorName || 'Doctor'}</p>
                <p className="text-sm text-muted-foreground">{doctorEmail || ''}</p>
                <p className="text-xs text-emerald-600 mt-0.5 font-medium">{t('header.clinicDoctor')}</p>
                <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} className="mt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-emerald-200 dark:border-emerald-800 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/20"
                    onClick={() => document.getElementById('profile-name-input')?.focus()}
                  >
                    <Edit3 className="h-3.5 w-3.5 me-1.5" />
                    {t('settings.profile.editProfile')}
                  </Button>
                </motion.div>
              </div>
            </div>
            <Separator />
            <div className="space-y-3">
              <div className="space-y-2">
                <Label className="text-xs font-medium">{t('settings.profile.displayName')}</Label>
                <div className="flex gap-2">
                  <Input
                    id="profile-name-input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('settings.profile.namePlaceholder')}
                    className="transition-all duration-300 focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400 focus:shadow-lg focus:shadow-emerald-500/10"
                  />
                  <motion.div whileTap={{ scale: 0.95 }}>
                    <Button
                      className="bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-teal-600 text-white flex-shrink-0 shadow-md shadow-emerald-200/30 dark:shadow-emerald-900/20"
                      onClick={handleSaveProfile}
                      disabled={savingProfile || !name.trim()}
                    >
                      {savingProfile ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4 me-1" />}
                      {t('common.save')}
                    </Button>
                  </motion.div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Animated section divider */}
      <motion.div variants={itemVariants}>
        <div className="animated-divider" />
      </motion.div>

      {/* Appearance - with left accent border */}
      <motion.div variants={itemVariants}>
        <Card className="border-s-[3px] border-s-purple-500 shadow-sm hover:shadow-md transition-shadow duration-300 card-hover-lift-enhanced">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Palette className="h-4 w-4 text-purple-600" />
              {t('settings.appearance')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <motion.div className="theme-icon-rotate">
                  {theme === 'dark' ? <Moon className="h-5 w-5 text-amber-500" /> : <Sun className="h-5 w-5 text-amber-500" />}
                </motion.div>
                <div className="settings-item cursor-default">
                  <p className="font-medium text-sm text-gray-900 dark:text-white">{t('settings.appearance.theme')}</p>
                  <p className="text-xs text-muted-foreground">{t('settings.appearance.themeDesc')}</p>
                </div>
              </div>
              <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
                <motion.div whileTap={{ scale: 0.95 }}>
                  <Button
                    size="sm"
                    variant={theme === 'light' ? 'secondary' : 'ghost'}
                    className="gap-1.5 rounded-md transition-all duration-200"
                    onClick={() => setTheme('light')}
                  >
                    <Sun className="h-3.5 w-3.5" />
                    {t('settings.light')}
                  </Button>
                </motion.div>
                <motion.div whileTap={{ scale: 0.95 }}>
                  <Button
                    size="sm"
                    variant={theme === 'dark' ? 'secondary' : 'ghost'}
                    className="gap-1.5 rounded-md transition-all duration-200"
                    onClick={() => setTheme('dark')}
                  >
                    <Moon className="h-3.5 w-3.5" />
                    {t('settings.dark')}
                  </Button>
                </motion.div>
              </div>
            </div>
            {/* Live theme preview cards */}
            <div className="flex gap-3">
              <motion.div
                className={`flex-1 p-3 rounded-lg border-2 transition-all duration-300 cursor-pointer ${theme === 'light' ? 'border-emerald-500 ring-2 ring-emerald-500/20' : 'border-gray-200 dark:border-gray-700'}`}
                animate={{ scale: theme === 'light' ? 1.02 : 1 }}
                onClick={() => setTheme('light')}
              >
                <div className="w-full h-8 rounded bg-white border border-gray-200 flex items-center justify-center mb-1.5">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 rounded-full bg-emerald-400" />
                    <div className="w-2 h-2 rounded-full bg-teal-400" />
                    <div className="w-2 h-2 rounded-full bg-amber-400" />
                  </div>
                </div>
                <div className="h-2 w-3/4 bg-gray-200 rounded" />
                <div className="h-2 w-1/2 bg-gray-100 rounded mt-1" />
                <p className="text-[10px] text-muted-foreground mt-1.5 text-center">{t('settings.light')}</p>
              </motion.div>
              <motion.div
                className={`flex-1 p-3 rounded-lg border-2 transition-all duration-300 cursor-pointer ${theme === 'dark' ? 'border-emerald-500 ring-2 ring-emerald-500/20' : 'border-gray-200 dark:border-gray-700'}`}
                animate={{ scale: theme === 'dark' ? 1.02 : 1 }}
                onClick={() => setTheme('dark')}
              >
                <div className="w-full h-8 rounded bg-gray-800 border border-gray-700 flex items-center justify-center mb-1.5">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 rounded-full bg-emerald-500" />
                    <div className="w-2 h-2 rounded-full bg-teal-500" />
                    <div className="w-2 h-2 rounded-full bg-amber-500" />
                  </div>
                </div>
                <div className="h-2 w-3/4 bg-gray-700 rounded" />
                <div className="h-2 w-1/2 bg-gray-600 rounded mt-1" />
                <p className="text-[10px] text-muted-foreground mt-1.5 text-center">{t('settings.dark')}</p>
              </motion.div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Animated section divider */}
      <motion.div variants={itemVariants}>
        <div className="animated-divider" />
      </motion.div>

      {/* Statistics - with left accent border */}
      <motion.div variants={itemVariants}>
        <Card className="border-s-[3px] border-s-teal-500 shadow-sm hover:shadow-md transition-shadow duration-300 card-hover-lift-enhanced">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Database className="h-4 w-4 text-teal-600" />
              {t('settings.stats.title')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              <motion.div
                className="p-4 rounded-xl bg-gradient-to-br from-emerald-50 to-emerald-100/50 dark:from-emerald-950/30 dark:to-emerald-950/10 border border-emerald-100 dark:border-emerald-900/50 hover:scale-[1.02] hover:shadow-sm transition-all duration-200 cursor-default"
                whileHover={{ y: -1 }}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Users className="h-4 w-4 text-emerald-600" />
                  <p className="text-xs text-muted-foreground">{t('settings.stats.totalPatients')}</p>
                </div>
                <p className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums animated-number">
                  <motion.span
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 }}
                  >{stats?.patientCount || 0}</motion.span>
                </p>
              </motion.div>
              <motion.div
                className="p-4 rounded-xl bg-gradient-to-br from-teal-50 to-teal-100/50 dark:from-teal-950/30 dark:to-teal-950/10 border border-teal-100 dark:border-teal-900/50 hover:scale-[1.02] hover:shadow-sm transition-all duration-200 cursor-default"
                whileHover={{ y: -1 }}
              >
                <div className="flex items-center gap-2 mb-1">
                  <FileText className="h-4 w-4 text-teal-600" />
                  <p className="text-xs text-muted-foreground">{t('settings.stats.totalDocuments')}</p>
                </div>
                <p className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums animated-number">
                  <motion.span
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 }}
                  >{stats?.documentCount || 0}</motion.span>
                </p>
              </motion.div>
              <motion.div
                className="p-4 rounded-xl col-span-2 bg-gradient-to-br from-amber-50 to-amber-100/50 dark:from-amber-950/30 dark:to-amber-950/10 border border-amber-100 dark:border-amber-900/50 hover:scale-[1.01] hover:shadow-sm transition-all duration-200 cursor-default"
                whileHover={{ y: -1 }}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <HardDrive className="h-4 w-4 text-amber-600" />
                      <p className="text-xs text-muted-foreground">{t('dashboard.storageUsed')}</p>
                    </div>
                    <p className="text-2xl font-bold text-gray-900 dark:text-white">
                      {formatFileSize(stats?.totalStorage || 0)}
                    </p>
                  </div>
                  {/* Circular progress indicator */}
                  <div className="relative w-16 h-16">
                    <svg width="64" height="64" viewBox="0 0 96 96" className="-rotate-90">
                      <circle
                        cx="48" cy="48" r="42"
                        fill="none"
                        stroke="oklch(0.922 0.01 85)"
                        strokeWidth="6"
                        className="dark:stroke-gray-700"
                      />
                      <motion.circle
                        cx="48" cy="48" r="42"
                        fill="none"
                        stroke="oklch(0.696 0.17 162.48)"
                        strokeWidth="6"
                        strokeLinecap="round"
                        strokeDasharray={circumference}
                        initial={{ strokeDashoffset: circumference }}
                        animate={{ strokeDashoffset: fillOffset }}
                        transition={{ duration: 1.5, ease: [0.22, 1, 0.36, 1], delay: 0.3 }}
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-xs font-bold text-gray-900 dark:text-white">{Math.round(storagePercent)}%</span>
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Animated section divider */}
      <motion.div variants={itemVariants}>
        <div className="animated-divider" />
      </motion.div>

      {/* Backup & Export - with left accent border */}
      <motion.div data-qa="settings-backup" variants={itemVariants}>
        <Card className="border-s-[3px] border-s-amber-500 shadow-sm hover:shadow-md transition-shadow duration-300 card-hover-lift-enhanced">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FolderDown className="h-4 w-4 text-amber-600" />
              {t('settings.backup.title')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t('settings.backup.desc')}
            </p>
            {/* Estimated file size */}
            {stats?.totalStorage && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <HardDrive className="h-3.5 w-3.5" />
                <span>{t('settings.backup.estimatedSize')} <span className="font-medium text-gray-700 dark:text-gray-300">{formatFileSize(stats.totalStorage)}</span></span>
              </div>
            )}
            <motion.div whileTap={{ scale: 0.98 }}>
              <Button
                className="w-full bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-600 hover:from-emerald-600 hover:via-teal-600 hover:to-teal-700 text-white h-12 text-base shadow-md shadow-emerald-200/30 dark:shadow-emerald-900/20 transition-all duration-500 hover:shadow-lg relative overflow-hidden"
                onClick={handleBackup}
                disabled={backupLoading}
              >
                {backupLoading && <div className="backup-progress-bar" />}
                <span className="absolute inset-0 bg-gradient-to-r from-emerald-400/0 via-teal-400/30 to-emerald-400/0 opacity-0 hover:opacity-100 transition-opacity duration-500" />
                <span className="relative z-10 flex items-center">
                  {backupLoading ? (
                    <>
                      <Loader2 className="h-5 w-5 me-2 animate-spin" />
                      {t('settings.backup.creating')}
                    </>
                  ) : (
                    <>
                      <motion.div
                        animate={{ y: [0, -2, 0] }}
                        transition={{ type: 'tween', duration: 1.5, repeat: Infinity }}
                      >
                        <Download className="h-5 w-5 me-2" />
                      </motion.div>
                      {t('settings.backup.download')}
                    </>
                  )}
                </span>
              </Button>
            </motion.div>

            <div className="grid grid-cols-3 gap-3">
              <motion.div
                className="flex flex-col items-center gap-1.5 p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 text-center hover:bg-emerald-50 dark:hover:bg-emerald-950/20 hover:scale-[1.03] transition-all duration-200 cursor-default"
                whileHover={{ y: -2 }}
              >
                <Usb className="h-6 w-6 text-muted-foreground group-hover:text-emerald-600" />
                <span className="text-xs font-medium text-muted-foreground">{t('settings.backup.usb')}</span>
              </motion.div>
              <motion.div
                className="flex flex-col items-center gap-1.5 p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 text-center hover:bg-emerald-50 dark:hover:bg-emerald-950/20 hover:scale-[1.03] transition-all duration-200 cursor-default"
                whileHover={{ y: -2 }}
              >
                <Disc className="h-6 w-6 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground">{t('settings.backup.cd')}</span>
              </motion.div>
              <motion.div
                className="flex flex-col items-center gap-1.5 p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 text-center hover:bg-emerald-50 dark:hover:bg-emerald-950/20 hover:scale-[1.03] transition-all duration-200 cursor-default"
                whileHover={{ y: -2 }}
              >
                <CloudUpload className="h-6 w-6 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground">{t('settings.backup.cloud')}</span>
              </motion.div>
            </div>

            <div className="flex items-start gap-2 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-sm text-emerald-700 dark:text-emerald-400">
              <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>
                {t('settings.backup.note')}
              </span>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Animated section divider */}
      <motion.div variants={itemVariants}>
        <div className="animated-divider" />
      </motion.div>

      {/* Device Compatibility - with left accent border */}
      <motion.div variants={itemVariants}>
        <Card className="border-s-[3px] border-s-rose-400 shadow-sm hover:shadow-md transition-shadow duration-300 card-hover-lift-enhanced">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Monitor className="h-4 w-4 text-rose-500" />
              {t('settings.devices.title')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              <motion.div
                className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 hover:bg-emerald-50/50 dark:hover:bg-emerald-950/10 transition-colors duration-200 settings-item"
                whileHover={{ x: 2 }}
              >
                <Monitor className="h-5 w-5 text-emerald-600" />
                <div>
                  <p className="text-sm font-medium">{t('settings.devices.desktop')}</p>
                  <p className="text-xs text-muted-foreground">{t('settings.devices.desktopDesc')}</p>
                </div>
              </motion.div>
              <motion.div
                className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 hover:bg-emerald-50/50 dark:hover:bg-emerald-950/10 transition-colors duration-200 settings-item"
                whileHover={{ x: 2 }}
              >
                <Smartphone className="h-5 w-5 text-emerald-600" />
                <div>
                  <p className="text-sm font-medium">{t('settings.devices.mobile')}</p>
                  <p className="text-xs text-muted-foreground">{t('settings.devices.mobileDesc')}</p>
                </div>
              </motion.div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Install App - PWA Download */}
      <motion.div variants={itemVariants}>
        <Card className="border-s-[3px] border-s-violet-500 shadow-sm hover:shadow-md transition-shadow duration-300 card-hover-lift-enhanced">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Download className="h-4 w-4 text-violet-600" />
              {t('settings.install.title')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t('settings.install.desc')}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Windows / Desktop Install */}
              <Button
                className="w-full bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white h-12 transition-all duration-200 group"
                onClick={() => {
                  if ((window as any).deferredPrompt) {
                    (window as any).deferredPrompt.prompt()
                  } else {
                    toast({
                      title: t('settings.install.windowsToastTitle'),
                      description: t('settings.install.windowsToastDesc'),
                      duration: 6000
                    })
                  }
                }}
              >
                <Monitor className="h-5 w-5 me-2 group-hover:scale-110 transition-transform duration-200" />
                <div className="flex flex-col items-start">
                  <span className="text-sm font-semibold leading-tight">{t('settings.install.windows')}</span>
                  <span className="text-[10px] opacity-80 leading-tight">{t('settings.install.windowsDesc')}</span>
                </div>
              </Button>
              {/* Mobile Install */}
              <Button
                className="w-full bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white h-12 transition-all duration-200 group"
                onClick={() => {
                  if ((window as any).deferredPrompt) {
                    (window as any).deferredPrompt.prompt()
                  } else {
                    toast({
                      title: t('settings.install.mobileToastTitle'),
                      description: t('settings.install.mobileToastDesc'),
                      duration: 6000
                    })
                  }
                }}
              >
                <Smartphone className="h-5 w-5 me-2 group-hover:scale-110 transition-transform duration-200" />
                <div className="flex flex-col items-start">
                  <span className="text-sm font-semibold leading-tight">{t('settings.install.mobile')}</span>
                  <span className="text-[10px] opacity-80 leading-tight">{t('settings.install.mobileDesc')}</span>
                </div>
              </Button>
            </div>
            <p className="text-[11px] text-center text-muted-foreground">
              {t('settings.install.footerHint')}
            </p>
          </CardContent>
        </Card>
      </motion.div>

      {/* Animated section divider */}
      <motion.div variants={itemVariants}>
        <div className="animated-divider" />
      </motion.div>

      {/* Security - with left accent border */}
      <motion.div variants={itemVariants}>
        <Card className="border-s-[3px] border-s-emerald-500 shadow-sm hover:shadow-md transition-shadow duration-300 card-hover-lift-enhanced">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <motion.div
                animate={{ rotate: [0, -8, 8, -8, 0] }}
                transition={{ type: 'tween', duration: 0.5, delay: 0.5, ease: 'easeInOut' }}
              >
                <Lock className="h-4 w-4 text-emerald-600" />
              </motion.div>
              {t('settings.security.title')}
              <motion.div
                className="ms-auto"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', delay: 0.5 }}
              >
                <Shield className="h-5 w-5 text-emerald-500" />
              </motion.div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { icon: Lock, label: t('settings.security.encryptedPasswords'), enabled: true },
              { icon: Eye, label: t('settings.security.sessionAuth'), enabled: true },
              { icon: Database, label: t('settings.security.localStorage'), enabled: true },
              { icon: Download, label: t('settings.security.backupCapability'), enabled: true },
              { icon: CheckCircle, label: t('settings.security.patientIsolation'), enabled: true },
              { icon: Shield, label: t('settings.security.routeProtection'), enabled: true },
            ].map((item, index) => (
              <motion.div
                key={item.label}
                className="flex items-center gap-2.5 text-sm settings-item"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05 }}
              >
                <motion.div
                  whileHover={{ rotate: 15, scale: 1.1 }}
                  transition={{ type: 'spring', stiffness: 400 }}
                >
                  <item.icon className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                </motion.div>
                <span className="text-gray-700 dark:text-gray-300 flex-1">{item.label}</span>
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', delay: 0.3 + index * 0.05 }}
                >
                  <div className="w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  </div>
                </motion.div>
              </motion.div>
            ))}
          </CardContent>
        </Card>
      </motion.div>

      {/* Animated section divider */}
      <motion.div variants={itemVariants}>
        <div className="animated-divider" />
      </motion.div>

      {/* About MediVault */}
      <motion.div variants={itemVariants}>
        <Card className="border-s-[3px] border-s-gray-400 dark:border-s-gray-600 shadow-sm hover:shadow-md transition-shadow duration-300 card-hover-lift-enhanced">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Heart className="h-4 w-4 text-rose-500" />
              {t('settings.about.title')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center text-white shadow-md shadow-emerald-200/30 dark:shadow-emerald-900/20">
                <Stethoscope className="w-5 h-5" />
              </div>
              <div>
                <p className="font-semibold text-gray-900 dark:text-white">{t('common.appName')}</p>
                <p className="text-xs text-muted-foreground">{t('common.appTagline')}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50">
                <p className="text-xs text-muted-foreground">{t('settings.about.version')}</p>
                <p className="font-medium text-gray-900 dark:text-white">2.0.0</p>
              </div>
              <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50">
                <p className="text-xs text-muted-foreground">{t('settings.about.buildDate')}</p>
                <p className="font-medium text-gray-900 dark:text-white">{formatDate(new Date(), { month: 'short', day: 'numeric', year: 'numeric' })}</p>
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-2">{t('settings.about.techStack')}</p>
              <div className="flex flex-wrap gap-1.5">
                <span className="tech-badge">Next.js 16</span>
                <span className="tech-badge">TypeScript</span>
                <span className="tech-badge">Tailwind CSS 4</span>
                <span className="tech-badge">Framer Motion</span>
                <span className="tech-badge">shadcn/ui</span>
                <span className="tech-badge">Prisma</span>
                <span className="tech-badge">Custom JWT Auth</span>
                <span className="tech-badge">Lucide Icons</span>
              </div>
            </div>
            <div className="flex items-start gap-2 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-sm text-emerald-700 dark:text-emerald-400">
              <Heart className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>
                {t('settings.about.note')}
              </span>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  )
}
