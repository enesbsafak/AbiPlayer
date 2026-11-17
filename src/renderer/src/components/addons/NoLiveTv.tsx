import { Link } from 'react-router-dom'
import { useStore } from '@/store'
import { GuideIcon, LiveIcon } from '@/components/ui/icons'
import { PRIMARY_PILL } from '@/components/home/home-ui'
import { strings } from '@/strings'

const text = strings.catalog.addon

/**
 * Canlı TV and Yayın Akışı while an add-on is the active source: an add-on
 * has films and series, no channels and no guide. A calm statement and the
 * way to what it does have, instead of a list that never loads.
 */
export function NoLiveTv({ section }: { section: 'live' | 'epg' }) {
  const Icon = section === 'live' ? LiveIcon : GuideIcon
  return (
    <div className="flex h-full min-h-0 flex-col p-3">
      <section
        aria-labelledby="no-live-title"
        className="flex min-h-0 flex-1 items-center justify-center rounded-tile bg-raised p-8 short:p-6"
      >
        <div className="flex max-w-xl flex-col items-center gap-4 text-center">
          <Icon size={96} weight={1.8} className={`${section === 'live' ? 'text-coral' : 'text-sun'} short:hidden`} />
          <h2 id="no-live-title" className="font-title text-[clamp(26px,2.6vw,34px)] leading-[1.15]">
            {text.noLive}
          </h2>
          <p className="text-base leading-relaxed text-surface-400">{text.noLiveHint}</p>
          <Link to="/vod" className={`${PRIMARY_PILL} mt-3`}>
            {text.openFilms}
          </Link>
        </div>
      </section>
    </div>
  )
}

/** The active source is an add-on (it has no live TV). */
export function useActiveSourceIsAddon(): boolean {
  return useStore((s) => s.sources.find((source) => source.id === s.activeSourceId)?.type === 'addon')
}
