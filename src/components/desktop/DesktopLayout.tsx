'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Badge } from '@/components/ui/badge'
import {
  Stethoscope,
  LayoutDashboard,
  Users,
  FileText,
  ScanLine,
  HardDrive,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Wifi,
  WifiOff,
  Shield,
  ShieldAlert,
  Menu,
  X,
} from 'lucide-react'
import { useDesktopStore } from '@/lib/desktop/store'
import { logout as apiLogout, getServiceStatus, getDeviceStatus, friendlyMessage } from '@/lib/desktop/api'
import type { DesktopView } from '@/lib/desktop/types'
import { BackupPanel } from './BackupPanel'
import { ScannerPanel } from './ScannerPanel'
import { SettingsPanel } from './SettingsPanel'

// ---------- Nav items ----------

interface NavItem {
  view: DesktopView
  label: string
  icon: React.ReactNode
}

const NAV_ITEMS: NavItem[] = [
  { view: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="h-4 w-4" /> },
  { view: 'patients', label: 'Patients', icon: <Users className="h-4 w-4" /> },
  { view: 'documents', label: 'Documents', icon: <FileText className="h-4 w-4" /> },
  { view: 'scanner', label: 'Scanner', icon: <ScanLine className="h-4 w-4" /> },
  { view: 'backup', label: 'Backup', icon: <HardDrive className="h-4 w-4" /> },
  { view: 'settings', label: 'Settings', icon: <Settings className="h-4 w-4" /> },
]

// ---------- Placeholder views ----------

function PlaceholderView({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex items-center justify-center h-full min-h-[400px]">
      <div className="text-center space-y-3">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-muted flex items-center justify-center">
          <Stethoscope className="w-8 h-8 text-muted-foreground/40" />
        </div>
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground max-w-sm">{description}</p>
      </div>
    </div>
  )
}

// =================== DESKTOP LAYOUT ===================

export function DesktopLayout() {
  const {
    currentView,
    setCurrentView,
    currentUser,
    logout,
    serviceStatus,
    deviceStatus,
    setServiceStatus,
    setDeviceStatus,
    serverUrl,
    connectionError,
    setConnectionError,
  } = useDesktopStore()

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [connStatus, setConnStatus] = useState<'connected' | 'disconnected' | 'unknown'>('unknown')

  useEffect(() => {
    let cancelled = false
    const check = async () => {
      try {
        const [svc, dev] = await Promise.all([
          getServiceStatus().catch(() => null),
          getDeviceStatus().catch(() => null),
        ])
        if (cancelled) return
        if (svc) {
          setServiceStatus(svc)
          setConnStatus(svc.reachable ? 'connected' : 'disconnected')
          setConnectionError(svc.reachable ? null : svc.error ?? 'Server unreachable')
        } else {
          setConnStatus('disconnected')
        }
        if (dev) setDeviceStatus(dev)
      } catch {
        if (!cancelled) setConnStatus('disconnected')
      }
    }
    check()
    const interval = setInterval(check, 30000) // every 30s
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [setServiceStatus, setDeviceStatus, setConnectionError])

  // ---- Logout ----
  const handleLogout = async () => {
    setLoggingOut(true)
    try {
      await apiLogout()
    } catch {
      // best-effort
    }
    logout()
    setLoggingOut(false)
  }

  // ---- Navigate ----
  const handleNav = (view: DesktopView) => {
    setCurrentView(view)
    setMobileMenuOpen(false)
  }

  // ---- User initials ----
  const userInitials = currentUser?.email
    ? currentUser.email.slice(0, 2).toUpperCase()
    : '??'

  // =================== RENDER ===================

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-950">
      {/* ---- TOP BAR ---- */}
      <header className="h-14 border-b bg-white dark:bg-gray-900 flex items-center px-4 gap-3 shrink-0">
        {/* Mobile menu toggle */}
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={() => setMobileMenuOpen((o) => !o)}
          aria-label="Toggle navigation menu"
        >
          {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>

        {/* Logo */}
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
            <Stethoscope className="w-4 h-4 text-white" />
          </div>
          <span className="font-semibold text-emerald-600 text-sm hidden sm:inline">MediVault</span>
        </div>

        {/* Current page title */}
        <div className="flex-1 flex items-center justify-center">
          <h1 className="text-sm font-medium">
            {NAV_ITEMS.find((n) => n.view === currentView)?.label ?? 'Dashboard'}
          </h1>
        </div>

        {/* Right section */}
        <div className="flex items-center gap-2">
          {/* Connection status */}
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center">
                {connStatus === 'connected' ? (
                  <Wifi className="h-4 w-4 text-emerald-500" />
                ) : connStatus === 'disconnected' ? (
                  <WifiOff className="h-4 w-4 text-destructive" />
                ) : (
                  <Wifi className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
            </TooltipTrigger>
            <TooltipContent>
              {connStatus === 'connected'
                ? `Connected to ${serverUrl || 'server'}`
                : connStatus === 'disconnected'
                ? connectionError ?? 'Server unreachable'
                : 'Checking connection…'}
            </TooltipContent>
          </Tooltip>

          {/* Device status */}
          {deviceStatus && (
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  {deviceStatus.registered ? (
                    <Shield className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <ShieldAlert className="h-4 w-4 text-amber-500" />
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent>
                {deviceStatus.registered
                  ? `Device enrolled: ${deviceStatus.device_name ?? 'Unknown'}`
                  : 'Device not enrolled'}
              </TooltipContent>
            </Tooltip>
          )}

          <Separator orientation="vertical" className="h-6" />

          {/* User avatar + logout */}
          <div className="flex items-center gap-2">
            <Avatar className="h-7 w-7">
              <AvatarFallback className="text-xs bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
                {userInitials}
              </AvatarFallback>
            </Avatar>
            <span className="text-xs font-medium hidden lg:inline max-w-32 truncate">
              {currentUser?.email ?? 'User'}
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={handleLogout}
                  disabled={loggingOut}
                  aria-label="Sign out"
                >
                  <LogOut className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Sign Out</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* ---- SIDEBAR (Desktop) ---- */}
        <aside
          className={`
            hidden md:flex flex-col border-r bg-white dark:bg-gray-900 shrink-0 transition-all duration-200
            ${sidebarCollapsed ? 'w-14' : 'w-52'}
          `}
          aria-label="Main navigation"
        >
          <nav className="flex-1 py-3 px-2 space-y-1">
            {NAV_ITEMS.map((item) => {
              const active = currentView === item.view
              return (
                <Tooltip key={item.view}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => handleNav(item.view)}
                      className={`
                        flex items-center gap-3 w-full rounded-md px-2.5 py-2 text-sm font-medium transition-colors
                        ${
                          active
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                        }
                        ${sidebarCollapsed ? 'justify-center' : ''}
                      `}
                      aria-current={active ? 'page' : undefined}
                    >
                      {item.icon}
                      {!sidebarCollapsed && <span>{item.label}</span>}
                    </button>
                  </TooltipTrigger>
                  {sidebarCollapsed && <TooltipContent side="right">{item.label}</TooltipContent>}
                </Tooltip>
              )
            })}
          </nav>

          {/* Collapse toggle */}
          <div className="p-2 border-t">
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => setSidebarCollapsed((c) => !c)}
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {sidebarCollapsed ? (
                <ChevronRight className="h-4 w-4" />
              ) : (
                <>
                  <ChevronLeft className="h-4 w-4 mr-2" />
                  <span className="text-xs">Collapse</span>
                </>
              )}
            </Button>
          </div>
        </aside>

        {/* ---- MOBILE SIDEBAR (Overlay) ---- */}
        {mobileMenuOpen && (
          <div className="md:hidden fixed inset-0 z-50">
            <div
              className="absolute inset-0 bg-black/50"
              onClick={() => setMobileMenuOpen(false)}
              aria-hidden
            />
            <aside className="absolute left-0 top-0 bottom-0 w-64 bg-white dark:bg-gray-900 border-r flex flex-col">
              <div className="h-14 flex items-center px-4 border-b">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-md bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
                    <Stethoscope className="w-4 h-4 text-white" />
                  </div>
                  <span className="font-semibold text-emerald-600">MediVault</span>
                </div>
              </div>
              <nav className="flex-1 py-3 px-2 space-y-1">
                {NAV_ITEMS.map((item) => {
                  const active = currentView === item.view
                  return (
                    <button
                      key={item.view}
                      type="button"
                      onClick={() => handleNav(item.view)}
                      className={`
                        flex items-center gap-3 w-full rounded-md px-3 py-2.5 text-sm font-medium transition-colors
                        ${
                          active
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                        }
                      `}
                      aria-current={active ? 'page' : undefined}
                    >
                      {item.icon}
                      <span>{item.label}</span>
                    </button>
                  )
                })}
              </nav>
            </aside>
          </div>
        )}

        {/* ---- MAIN CONTENT ---- */}
        <main className="flex-1 overflow-y-auto">
          <div className="p-4 md:p-6 max-w-5xl">
            {currentView === 'dashboard' && (
              <PlaceholderView
                title="Dashboard"
                description="Patient overview, recent activity, and quick actions will appear here. Connect to the server to see live data."
              />
            )}
            {currentView === 'patients' && (
              <PlaceholderView
                title="Patients"
                description="Search and browse patient records. This view will integrate with the patient management system."
              />
            )}
            {currentView === 'documents' && (
              <PlaceholderView
                title="Documents"
                description="View and manage uploaded documents across all patients."
              />
            )}
            {currentView === 'scanner' && <ScannerPanel />}
            {currentView === 'backup' && <BackupPanel />}
            {currentView === 'settings' && <SettingsPanel />}
          </div>
        </main>
      </div>

      {/* ---- FOOTER ---- */}
      <footer className="h-8 border-t bg-white dark:bg-gray-900 flex items-center justify-between px-4 text-[11px] text-muted-foreground shrink-0">
        <div className="flex items-center gap-2">
          <Stethoscope className="h-3 w-3" />
          <span>MediVault Desktop v1.0.0</span>
        </div>
        <div className="flex items-center gap-2">
          {connStatus === 'connected' ? (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 text-emerald-600 border-emerald-300 dark:text-emerald-400 dark:border-emerald-800">
              <Wifi className="h-2.5 w-2.5 mr-0.5" /> Connected
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 text-destructive">
              <WifiOff className="h-2.5 w-2.5 mr-0.5" /> Disconnected
            </Badge>
          )}
        </div>
      </footer>
    </div>
  )
}
