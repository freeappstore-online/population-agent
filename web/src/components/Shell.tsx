import type { ReactNode } from 'react'

interface ShellProps {
  children: ReactNode
}

/**
 * Standalone-app layout shell. Sidebar on desktop, bottom dock on mobile.
 *
 * No router — single-page apps don't need one. If you add routes later,
 * either pull react-router-dom yourself or copy the connected template's
 * Shell with NavLink wiring.
 */
export function Shell({ children }: ShellProps) {
  return (
    <div className="relative min-h-[100dvh]">
      <div className="mx-auto max-w-[1540px] px-2 pt-1 sm:px-4 lg:px-8 lg:py-8">
        <div className="min-h-[100dvh] pb-14 lg:grid lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-7 lg:pb-0">
          {/* Desktop sidebar */}
          <aside className="hidden lg:flex lg:min-h-[calc(100dvh-4rem)] lg:flex-col lg:gap-5 lg:rounded-[2rem] lg:border lg:border-[var(--line)] lg:bg-[var(--glass-strong)] lg:p-6 lg:shadow-[var(--shadow-soft)] lg:backdrop-blur-xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-[var(--line-strong)] bg-[var(--glass)] px-3 py-1 text-[0.65rem] font-bold uppercase tracking-[0.22em] text-[var(--accent-deep)]">
              population-agent
            </div>

            <div className="mt-auto text-[0.65rem] text-[var(--muted)]">
              Part of{' '}
              <a
                href="https://freeappstore.online"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-[var(--ink)]"
              >
                FreeAppStore
              </a>
            </div>
          </aside>

          {/* Main content */}
          <main className="flex min-h-0 min-w-0 flex-1 flex-col">
            {children}
          </main>
        </div>
      </div>

      {/* Mobile dock */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--line)] bg-[var(--dock)]/92 px-2 pb-[calc(env(safe-area-inset-bottom)+0.25rem)] pt-1 backdrop-blur-2xl lg:hidden">
        <div className="mx-auto grid max-w-xs grid-cols-1 py-2">
          <a
            href="https://freeappstore.online"
            target="_blank"
            rel="noopener noreferrer"
            className="text-center text-[0.65rem] font-bold uppercase tracking-[0.14em] text-[var(--muted)]"
          >
            Part of FreeAppStore
          </a>
        </div>
      </nav>
    </div>
  )
}
