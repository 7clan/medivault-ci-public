'use client'

import { useEffect, useCallback } from 'react'
import { useAppStore } from '@/store/app-store'

interface ShortcutConfig {
  key: string
  ctrl?: boolean
  meta?: boolean
  shift?: boolean
  alt?: boolean
  action: () => void
  description: string
  category: string
  requiresNoInput?: boolean
}

const SHORTCUTS: ShortcutConfig[] = [
  {
    key: 'n',
    ctrl: true,
    action: () => {
      const store = useAppStore.getState()
      if (store.currentView === 'dashboard') {
        const event = new CustomEvent('medivault:add-patient')
        window.dispatchEvent(event)
      }
    },
    description: 'Add new patient',
    category: 'Actions',
  },
  {
    key: 'd',
    ctrl: true,
    action: () => {
      const store = useAppStore.getState()
      store.setScanTargetPatientId(null)
      store.setCurrentView('scan-capture')
    },
    description: 'Scan document',
    category: 'Actions',
  },
  {
    key: 'p',
    ctrl: true,
    action: () => {
      const event = new CustomEvent('medivault:open-patient-switcher')
      window.dispatchEvent(event)
    },
    description: 'Quick patient switcher',
    category: 'Navigation',
  },
  {
    key: 'f',
    ctrl: true,
    requiresNoInput: false,
    action: () => {
      const store = useAppStore.getState()
      if (store.currentView === 'dashboard') {
        const searchInput = document.querySelector('input[placeholder*="Search"]') as HTMLInputElement
        searchInput?.focus()
      }
    },
    description: 'Focus search',
    category: 'Navigation',
  },
  {
    key: 'k',
    ctrl: true,
    requiresNoInput: false,
    action: () => {
      const store = useAppStore.getState()
      if (store.currentView === 'dashboard') {
        const searchInput = document.querySelector('input[placeholder*="Search"]') as HTMLInputElement
        searchInput?.focus()
      }
    },
    description: 'Focus search (alt)',
    category: 'Navigation',
  },
  {
    key: 'b',
    ctrl: true,
    action: () => {
      const store = useAppStore.getState()
      store.goBack()
    },
    description: 'Go back',
    category: 'Navigation',
  },
  {
    key: 'Escape',
    action: () => {
      const closeEvent = new CustomEvent('medivault:close-dialogs')
      window.dispatchEvent(closeEvent)
    },
    description: 'Close dialogs',
    category: 'General',
    requiresNoInput: false,
  },
  {
    key: '?',
    shift: true,
    action: () => {
      const event = new CustomEvent('medivault:show-shortcuts')
      window.dispatchEvent(event)
    },
    description: 'Show keyboard shortcuts',
    category: 'Help',
  },
]

export function useKeyboardShortcuts(enabled = true) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!enabled) return

    const target = e.target as HTMLElement
    const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable

    for (const shortcut of SHORTCUTS) {
      if (shortcut.requiresNoInput !== false && isInput) continue

      const ctrlMatch = shortcut.ctrl ? (e.ctrlKey || e.metaKey) : !e.ctrlKey && !e.metaKey
      const shiftMatch = shortcut.shift ? e.shiftKey : !e.shiftKey
      const altMatch = shortcut.alt ? e.altKey : !e.altKey
      const keyMatch = e.key === shortcut.key || (shortcut.key.length === 1 && e.key.toLowerCase() === shortcut.key.toLowerCase())

      if (ctrlMatch && shiftMatch && altMatch && keyMatch) {
        e.preventDefault()
        e.stopPropagation()
        shortcut.action()
        break
      }
    }
  }, [enabled])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])
}

export function getShortcuts() {
  return SHORTCUTS
}
