import { Link, NavLink } from 'react-router-dom'
import { Tv, Film, Clapperboard, Calendar, Star, Search, Settings, Radio, Zap, Heart } from 'lucide-react'
import { APP_NAME, APP_VERSION_LABEL } from '@/constants/app-info'

const navItems = [
  { to: '/', icon: Radio, label: 'Ana Sayfa' },
  { to: '/live', icon: Tv, label: 'Canlı TV' },
  { to: '/vod', icon: Film, label: 'Filmler' },
  { to: '/series', icon: Clapperboard, label: 'Diziler' },
  { to: '/epg', icon: Calendar, label: 'Yayın Akışı' },
  { to: '/favorites', icon: Star, label: 'Favoriler' },
  { to: '/search', icon: Search, label: 'Ara' }
]

export function Sidebar() {
  return (
    <aside className="flex w-[56px] flex-col border-r border-surface-800 bg-surface-950 py-3 lg:w-60">
      <div className="mb-3 hidden items-center gap-2.5 px-4 lg:flex">
        <div className="flex size-8 items-center justify-center rounded-lg bg-accent text-white">
          <Zap size={14} />
        </div>
        <div>
          <p className="text-body-sm font-semibold text-surface-50">{APP_NAME}</p>
          <p className="text-label text-surface-500">{APP_VERSION_LABEL}</p>
        </div>
      </div>

      <nav aria-label="Ana gezinme" className="flex flex-1 flex-col gap-0.5 px-2 lg:px-3">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            // Below lg only the icon shows; the name has to come from here.
            aria-label={item.label}
            title={item.label}
            className={({ isActive }) =>
              `group flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                isActive
                  ? 'bg-surface-800 text-surface-50 font-medium'
                  : 'text-surface-400 hover:bg-surface-900 hover:text-surface-200'
              }`
            }
          >
            <item.icon size={18} className="mx-auto shrink-0 lg:mx-0" aria-hidden="true" />
            <span className="hidden lg:block">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="mt-2 flex flex-col gap-0.5 border-t border-surface-800 px-2 pt-2 lg:px-3">
        {/* Plain Link, not NavLink: this points at a tab inside /settings, and
            NavLink's active state ignores the query string. */}
        <Link
          to="/settings?tab=support"
          aria-label="Destek"
          title="Destek"
          className="flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-surface-400 transition-colors hover:bg-surface-900 hover:text-surface-200"
        >
          <Heart size={18} className="mx-auto shrink-0 lg:mx-0" aria-hidden="true" />
          <span className="hidden lg:block">Destek</span>
        </Link>

        <NavLink
          to="/settings"
          aria-label="Ayarlar"
          title="Ayarlar"
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors ${
              isActive
                ? 'bg-surface-800 text-surface-50 font-medium'
                : 'text-surface-400 hover:bg-surface-900 hover:text-surface-200'
            }`
          }
        >
          <Settings size={18} className="mx-auto shrink-0 lg:mx-0" aria-hidden="true" />
          <span className="hidden lg:block">Ayarlar</span>
        </NavLink>
      </div>
    </aside>
  )
}
