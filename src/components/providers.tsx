'use client'

import { ThemeProvider as NextThemesProvider } from 'next-themes'
import { Toaster } from '@/components/ui/toaster'
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
          {/* P3 TOASTS_NEVER_RENDER fix — ONE toast architecture: every
              component fires the shadcn use-toast store
              (src/hooks/use-toast.ts); this is its only renderer
              (src/components/ui/toaster.tsx). The Sonner <Toaster /> that
              used to sit here had no producers (nothing calls sonner's
              toast()), so all in-app feedback was silent. ui/sonner.tsx
              stays on disk unused. */}
          <Toaster />
          <PWAInstallPrompt />
        </PWAProvider>
      </I18nProvider>
    </NextThemesProvider>
  )
}
