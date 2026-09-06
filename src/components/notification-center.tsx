'use client'

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Bell, X, FileText, UserPlus, AlertTriangle, CheckCircle, Trash2, Clock, Shield } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useAppStore } from '@/store/app-store'

interface Notification {
  id: string
  type: 'success' | 'info' | 'warning' | 'error'
  title: string
  description: string
  timestamp: Date
  read: boolean
}

const MAX_NOTIFICATIONS = 20

function loadNotifications(): Notification[] {
  if (typeof window === 'undefined') return []
  try {
    const stored = localStorage.getItem('medivault-notifications')
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

function saveNotifications(notifications: Notification[]) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem('medivault-notifications', JSON.stringify(notifications.slice(0, MAX_NOTIFICATIONS)))
  } catch {
    // localStorage may be full
  }
}

export function addNotification(type: Notification['type'], title: string, description: string) {
  const notifications = loadNotifications()
  const newNotification: Notification = {
    id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    type,
    title,
    description,
    timestamp: new Date(),
    read: false,
  }
  const updated = [newNotification, ...notifications].slice(0, MAX_NOTIFICATIONS)
  saveNotifications(updated)
  window.dispatchEvent(new CustomEvent('medivault:notification-update'))
}

function getNotificationIcon(type: Notification['type']) {
  switch (type) {
    case 'success': return <CheckCircle className="h-4 w-4 text-emerald-500" />
    case 'info': return <FileText className="h-4 w-4 text-teal-500" />
    case 'warning': return <AlertTriangle className="h-4 w-4 text-amber-500" />
    case 'error': return <X className="h-4 w-4 text-red-500" />
  }
}

function getNotificationBg(type: Notification['type']) {
  switch (type) {
    case 'success': return 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/50'
    case 'info': return 'bg-teal-50 dark:bg-teal-950/30 border-teal-200 dark:border-teal-800/50'
    case 'warning': return 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800/50'
    case 'error': return 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800/50'
  }
}

export { addNotification as notify }

export function NotificationCenter() {
  const [isOpen, setIsOpen] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>(loadNotifications)
  const [bellRinging, setBellRinging] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const currentView = useAppStore((s) => s.currentView)
  const prevUnreadCount = useRef(0)

  // Listen for notification updates
  useEffect(() => {
    const handleUpdate = () => {
      const updated = loadNotifications()
      setNotifications(updated)
      // Trigger bell ring if new unread notifications arrived
      const newUnread = updated.filter((n) => !n.read).length
      if (newUnread > prevUnreadCount.current && prevUnreadCount.current >= 0) {
        setBellRinging(true)
        setTimeout(() => setBellRinging(false), 800)
      }
      prevUnreadCount.current = newUnread
    }
    window.addEventListener('medivault:notification-update', handleUpdate)
    return () => window.removeEventListener('medivault:notification-update', handleUpdate)
  }, [])

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  // Only show in app views (after all hooks)
  if (currentView === 'login' || currentView === 'setup') return null

  const unreadCount = notifications.filter((n) => !n.read).length

  const handleMarkAllRead = () => {
    const updated = notifications.map((n) => ({ ...n, read: true }))
    saveNotifications(updated)
    setNotifications(updated)
  }

  const handleClearAll = () => {
    saveNotifications([])
    setNotifications([])
  }

  const formatTimeAgo = (date: Date | string) => {
    const now = new Date()
    const then = new Date(date)
    const diffMs = now.getTime() - then.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    return `${diffDays}d ago`
  }

  return (
    <div ref={dropdownRef} className="relative">
      <motion.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}>
        <Button
          variant="ghost"
          size="icon"
          className="relative text-muted-foreground hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 transition-colors duration-200"
          onClick={() => setIsOpen(!isOpen)}
          title="Notifications"
        >
          <Bell className={`h-4 w-4 ${bellRinging ? 'bell-ring' : ''}`} />
          {unreadCount > 0 && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-emerald-500 text-[10px] text-white flex items-center justify-center font-bold shadow-sm"
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </motion.span>
          )}
        </Button>
      </motion.div>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            className="absolute right-0 top-full mt-2 w-80 sm:w-96 bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-800 z-50 overflow-hidden"
            initial={{ opacity: 0, y: -8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.95 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30">
              <div className="flex items-center gap-2">
                <Bell className="h-4 w-4 text-emerald-600" />
                <h3 className="font-semibold text-sm text-gray-900 dark:text-white">Notifications</h3>
                {unreadCount > 0 && (
                  <Badge variant="secondary" className="text-xs bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/50">
                    {unreadCount} new
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-1">
                {unreadCount > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-muted-foreground hover:text-emerald-600 h-7 px-2"
                    onClick={handleMarkAllRead}
                  >
                    Mark all read
                  </Button>
                )}
                {notifications.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-muted-foreground hover:text-red-500 h-7 px-2"
                    onClick={handleClearAll}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>

            {/* Notification List */}
            <div className="max-h-80 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
                  <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-3">
                    <Shield className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <p className="text-sm text-muted-foreground">No notifications yet</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Activity alerts will appear here</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  {notifications.map((notification) => (
                    <motion.div
                      key={notification.id}
                      layout
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className={`px-4 py-3 transition-colors duration-150 hover:bg-gray-50 dark:hover:bg-gray-800/50 ${
                        !notification.read ? 'bg-emerald-50/30 dark:bg-emerald-950/10' : ''
                      }`}
                    >
                      <div className="flex gap-3">
                        <div className="mt-0.5 flex-shrink-0">
                          {getNotificationIcon(notification.type)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p className={`text-sm font-medium ${!notification.read ? 'text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-300'}`}>
                              {notification.title}
                            </p>
                            {!notification.read && (
                              <div className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0 mt-1.5" />
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                            {notification.description}
                          </p>
                          <div className="flex items-center gap-1 mt-1">
                            <Clock className="h-3 w-3 text-muted-foreground" />
                            <span className="text-[11px] text-muted-foreground">
                              {formatTimeAgo(notification.timestamp)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
