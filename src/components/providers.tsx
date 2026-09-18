'use client'

import { ThemeProvider as NextThemesProvider } from 'next-themes'
import { Toaster } from '@/components/ui/sonner'
import { PWAInstallPrompt } from '@/components/pwa-install-prompt'
import { useServiceWorker } from '@/hooks/use-service-worker'
// FEATURE D — locale ownership (lang/dir on <html>, persistence, catalogs)
import { I18nProvider } from '@/i18n'

function PWAProvider({ children }: { children: React.ReactNode }) {
  useServiceWorker()
  return <>{children}</>
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem
      disableTransitionOnChange
    >
      <I18nProvider>
        <PWAProvider>
          {children}
          <Toaster position="top-right" />
          <PWAInstallPrompt />
        </PWAProvider>
      </I18nProvider>
    </NextThemesProvider>
  )
}
