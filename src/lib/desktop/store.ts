'use client'

import { create } from 'zustand'
import type {
  AppSettings,
  DeviceStatus,
  ServiceStatus,
  DatabaseStatus,
  LoginResponse,
  DesktopView,
} from './types'

// ---------- Persistence helpers ----------

const SETTINGS_KEY = 'medivault-desktop-settings'
const SESSION_KEY = 'medivault-desktop-session'

type StoredSession = Pick<LoginResponse, 'user_id' | 'email' | 'role' | 'expires_at'>

function loadSettings(): Partial<AppSettings> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function saveSettings(s: Partial<AppSettings>) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
  } catch {
    // localStorage full / unavailable
  }
}

function loadSession(): StoredSession | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const s: StoredSession = JSON.parse(raw)
    // Check if still valid
    if (new Date(s.expires_at).getTime() <= Date.now()) {
      localStorage.removeItem(SESSION_KEY)
      return null
    }
    return s
  } catch {
    return null
  }
}

function saveSession(s: StoredSession) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(s))
  } catch {
    // ignore
  }
}

function clearStoredSession() {
  if (typeof window === 'undefined') return
  localStorage.removeItem(SESSION_KEY)
}

// ---------- State shape ----------

export interface DesktopState {
  // Auth
  isAuthenticated: boolean
  currentUser: StoredSession | null
  sessionChecked: boolean

  // Navigation
  currentView: DesktopView

  // Connection
  serverUrl: string
  connectionError: string | null

  // Status
  deviceStatus: DeviceStatus | null
  serviceStatus: ServiceStatus | null
  databaseStatus: DatabaseStatus | null

  // Settings
  settings: Partial<AppSettings>

  // Actions — Auth
  setAuthenticated: (session: LoginResponse) => void
  logout: () => void
  setSessionChecked: (v: boolean) => void

  // Actions — Navigation
  setCurrentView: (view: DesktopView) => void

  // Actions — Connection
  setServerUrl: (url: string) => void
  setConnectionError: (err: string | null) => void

  // Actions — Status
  setDeviceStatus: (s: DeviceStatus | null) => void
  setServiceStatus: (s: ServiceStatus | null) => void
  setDatabaseStatus: (s: DatabaseStatus | null) => void

  // Actions — Settings
  updateSettings: (partial: Partial<AppSettings>) => void
}

export const useDesktopStore = create<DesktopState>((set, get) => {
  const storedSettings = loadSettings()
  const storedSession = loadSession()

  return {
    // Auth
    isAuthenticated: !!storedSession,
    currentUser: storedSession,
    sessionChecked: false,

    // Navigation
    currentView: 'dashboard',

    // Connection
    serverUrl: storedSettings.server_url ?? '',
    connectionError: null,

    // Status
    deviceStatus: null,
    serviceStatus: null,
    databaseStatus: null,

    // Settings
    settings: storedSettings,

    // --- Auth actions ---
    setAuthenticated: (session) => {
      const stored: StoredSession = {
        user_id: session.user_id,
        email: session.email,
        role: session.role,
        expires_at: session.expires_at,
      }
      saveSession(stored)
      set({
        isAuthenticated: true,
        currentUser: stored,
        sessionChecked: true,
        connectionError: null,
      })
    },

    logout: () => {
      clearStoredSession()
      set({
        isAuthenticated: false,
        currentUser: null,
        currentView: 'dashboard',
        deviceStatus: null,
        serviceStatus: null,
        databaseStatus: null,
        connectionError: null,
      })
    },

    setSessionChecked: (v) => set({ sessionChecked: v }),

    // --- Navigation ---
    setCurrentView: (view) => set({ currentView: view }),

    // --- Connection ---
    setServerUrl: (url) => {
      saveSettings({ ...get().settings, server_url: url })
      set({ serverUrl: url, settings: { ...get().settings, server_url: url } })
    },

    setConnectionError: (err) => set({ connectionError: err }),

    // --- Status ---
    setDeviceStatus: (s) => set({ deviceStatus: s }),
    setServiceStatus: (s) => set({ serviceStatus: s }),
    setDatabaseStatus: (s) => set({ databaseStatus: s }),

    // --- Settings ---
    updateSettings: (partial) => {
      const merged = { ...get().settings, ...partial }
      saveSettings(merged)
      set({ settings: merged })
    },
  }
})
