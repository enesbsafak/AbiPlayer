import { NavLink } from 'react-router-dom'
import { Tv, Film, Clapperboard, Calendar, Star, Search, Settings, Radio } from 'lucide-react'

const navItems = [
  { to: '/', icon: Radio, label: 'Home' },
  { to: '/live', icon: Tv, label: 'Live TV' },
  { to: '/vod', icon: Film, label: 'Movies' },
  { to: '/series', icon: Clapperboard, label: 'Series' },
  { to: '/epg', icon: Calendar, label: 'TV Guide' },
  { to: '/favorites', icon: Star, label: 'Favorites' },
  { to: '/search', icon: Search, label: 'Search' },
]

export function Sidebar() {
  return (
    <aside className="flex h-full w-16 flex-col items-center border-r border-surface-800 bg-surface-950 py-4 gap-1 lg:w-52 lg:items-stretch lg:px-3">
      <nav className="flex flex-1 flex-col gap-1">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-accent/10 text-accent'
                  : 'text-surface-400 hover:bg-surface-800 hover:text-white'
              }`
            }
          >
            <item.icon size={20} className="shrink-0" />
            <span className="hidden lg:block">{item.label}</span>
          </NavLink>
        ))}
      </nav>
      <NavLink
        to="/settings"
        className={({ isActive }) =>
          `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
            isActive
              ? 'bg-accent/10 text-accent'
              : 'text-surface-400 hover:bg-surface-800 hover:text-white'
          }`
        }
      >
        <Settings size={20} className="shrink-0" />
        <span className="hidden lg:block">Settings</span>
      </NavLink>
    </aside>
  )
}
