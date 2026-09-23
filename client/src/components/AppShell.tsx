import type { ReactNode } from "react"
import { NavLink } from "react-router"
import { CalendarDays, Radio, Search, Trophy, Users, type LucideIcon } from "lucide-react"

// App chrome (issue #19). Desktop: one top bar with the logo, main nav
// and search. Phone: a slim header plus a bottom tab bar; the game page
// turns the phone chrome off because it has its own back header.
// Events, Players, Rankings and Search arrive in later slices, so they
// show as "coming soon" instead of linking to pages that do not exist.

interface NavItem {
  label: string
  icon: LucideIcon
  to?: string
}

const NAV: NavItem[] = [
  { label: "Live", icon: Radio, to: "/" },
  { label: "Events", icon: CalendarDays },
  { label: "Players", icon: Users },
  { label: "Rankings", icon: Trophy },
]

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`font-display text-[26px] leading-none font-extrabold tracking-wide uppercase ${className}`}>
      Live<span className="text-primary">Chess</span>
    </span>
  )
}

export function AppShell({ children, phoneChrome = true }: { children: ReactNode; phoneChrome?: boolean }) {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="hidden items-center gap-8 border-b border-border bg-bar px-8 py-3 md:flex lg:px-12">
        <NavLink to="/" aria-label="LiveChess home">
          <Logo className="text-[28px]" />
        </NavLink>
        <div className="flex-1" />
        <nav aria-label="Main" className="flex items-center gap-7 text-[15px] font-semibold">
          {NAV.map((item) =>
            item.to ? (
              <NavLink
                key={item.label}
                to={item.to}
                end
                className={({ isActive }) => (isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {item.label}
              </NavLink>
            ) : (
              <Soon key={item.label}>{item.label}</Soon>
            ),
          )}
        </nav>
        <span
          aria-disabled="true"
          title="Search is coming soon"
          className="flex h-11 items-center gap-2 rounded-full border border-line-strong px-4 text-[15px] font-semibold text-muted-foreground"
        >
          <Search className="size-5" aria-hidden />
          Search
        </span>
      </header>

      {phoneChrome && (
        <header className="flex items-center justify-between bg-bar px-4 py-3 md:hidden">
          <NavLink to="/" aria-label="LiveChess home">
            <Logo />
          </NavLink>
          <span
            aria-disabled="true"
            title="Search is coming soon"
            className="flex size-11 items-center justify-center rounded-full border border-line-strong text-muted-foreground"
          >
            <Search className="size-5" aria-hidden />
            <span className="sr-only">Search, coming soon</span>
          </span>
        </header>
      )}

      <div className="flex-1">{children}</div>

      {phoneChrome && (
        <nav
          aria-label="Main"
          className="sticky bottom-0 grid grid-cols-4 border-t border-border bg-bar pt-2 pb-[max(env(safe-area-inset-bottom),12px)] md:hidden"
        >
          {NAV.map(({ label, icon: Icon, to }) =>
            to ? (
              <NavLink
                key={label}
                to={to}
                end
                className={({ isActive }) =>
                  `flex min-h-12 flex-col items-center justify-center gap-1 text-[11px] ${
                    isActive ? "font-bold text-primary" : "text-muted-foreground"
                  }`
                }
              >
                <Icon className="size-5.5" aria-hidden />
                {label}
              </NavLink>
            ) : (
              <span
                key={label}
                aria-disabled="true"
                title={`${label} is coming soon`}
                className="flex min-h-12 flex-col items-center justify-center gap-1 text-[11px] text-muted-foreground/60"
              >
                <Icon className="size-5.5" aria-hidden />
                {label}
              </span>
            ),
          )}
        </nav>
      )}
    </div>
  )
}

function Soon({ children }: { children: ReactNode }) {
  return (
    <span aria-disabled="true" title="Coming soon" className="cursor-default text-muted-foreground/60">
      {children}
    </span>
  )
}
