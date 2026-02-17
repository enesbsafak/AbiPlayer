import { NavLink } from 'react-router-dom'
import { Tv, Film, Clapperboard, Calendar, Star, Search, Settings, Radio, Zap } from 'lucide-react'
import { APP_NAME, APP_VERSION_LABEL } from '@/constants/app-info'

const navItems = [
  { to: '/', icon: Radio, label: 'Ana Sayfa' },
  { to: '/live', icon: Tv, label: 'Canli TV' },
  { to: '/vod', icon: Film, label: 'Filmler' },
  { to: '/series', icon: Clapperboard, label: 'Diziler' },
  { to: '/epg', icon: Calendar, label: 'Yayin Akisi' },
  { to: '/favorites', icon: Star, label: 'Favoriler' },
  { to: '/search', icon: Search, label: 'Ara' }
]

export function Sidebar() {
  return (
    <aside className="panel-glass relative m-2 ml-3 flex h-[calc(100%-1rem)] w-[72px] flex-col overflow-hidden rounded-3xl border-white/20 py-4 lg:w-72">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(circle_at_50%_0%,rgba(124,106,247,0.28),transparent_65%)]" />
      <div className="pointer-events-none absolute -left-10 top-12 h-28 w-28 rounded-full bg-[#2dd4bf]/20 blur-3xl" />

      <div className="relative mb-4 hidden items-center gap-3 px-5 lg:flex">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/35 bg-white/15 text-surface-100 shadow-[0_8px_18px_rgba(0,0,0,0.26)]">
          <Zap size={16} />
        </div>
        <div>
          <p className="text-[13px] font-semibold text-white">{APP_NAME}</p>
          <p className="text-[11px] text-surface-500 mt-0.5">{APP_VERSION_LABEL}</p>
        </div>
      </div>

      <nav className="relative flex flex-1 flex-col gap-1.5 px-2.5 lg:px-4">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all ${
                isActive
                  ? 'bg-[linear-gradient(90deg,rgba(124,106,247,0.28),rgba(124,106,247,0.08))] text-surface-50 shadow-[inset_2px_0_0_0_rgba(160,138,255,0.9)]'
                  : 'text-surface-200 hover:bg-white/12 hover:text-surface-50'
              }`
            }
          >
            <item.icon size={18} className="shrink-0 transition-transform group-hover:scale-105" />
            <span className="hidden font-medium lg:block">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="relative mt-3 px-2.5 lg:px-4">
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
              isActive
                ? 'bg-[linear-gradient(90deg,rgba(45,212,191,0.24),rgba(45,212,191,0.06))] text-surface-50 shadow-[inset_2px_0_0_0_rgba(45,212,191,0.9)]'
                : 'text-surface-200 hover:bg-white/12 hover:text-surface-50'
            }`
          }
        >
          <Settings size={18} className="shrink-0" />
          <span className="hidden font-medium lg:block">Ayarlar</span>
        </NavLink>
      </div>
    </aside>
  )
}
