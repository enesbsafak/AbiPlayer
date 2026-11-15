import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRightIcon } from '@/components/ui/icons'
import { SECTIONS, TONE } from '@/components/layout/sections'
import { tileGradient, type SectionKey } from '@/theme/palette'
import { strings } from '@/strings'
import type { TileLine } from './home-catalog'
import { SPATIAL_ATTRIBUTE } from './spatial-focus'
import { useElementSize } from './HomeRows'

/** A tile this tall has room for the quieter second line under its count. */
const ROOM_FOR_DETAIL = 196

/**
 * The look of the four tiles. `flat` is the design language (one flat colour
 * each); `gradient` is the owner's experiment: a diagonal gradient within each
 * colour family (stops in theme/palette.ts, TILE_GRADIENT) and slowly drifting
 * bubbles. This constant is the one switch back.
 */
const TILE_LOOK: 'flat' | 'gradient' = 'gradient'

const spatial = { [SPATIAL_ATTRIBUTE]: '' }

/**
 * Two or three soft circles, lighter than the tile, kept to its top and right
 * where the icon row is (under the ink arrow disc they cost nothing): never
 * under the label, the count or the second line. The rounded corners cut them.
 */
function Bubbles() {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0">
      <span className="tile-bubble-host absolute -right-[18%] -top-[40%] aspect-square h-[95%]">
        <span className="tile-bubble tile-bubble-a inset-0 bg-white/20" />
      </span>
      <span className="tile-bubble-host absolute -top-[24%] left-[30%] aspect-square h-[52%]">
        <span className="tile-bubble tile-bubble-b inset-0 bg-white/[0.14]" />
      </span>
      <span className="tile-bubble-host absolute left-[62%] top-[29%] aspect-square h-[13%]">
        <span className="tile-bubble tile-bubble-a inset-0 bg-white/25" />
      </span>
    </span>
  )
}

/**
 * The four destinations, each filled with the colour that owns its section,
 * ink on top, with one line of what is in it.
 */
export function HomeTiles({ lines }: { lines: Record<SectionKey, TileLine> }) {
  const [element, setElement] = useState<HTMLElement | null>(null)
  const { height } = useElementSize(element)
  // Two rows of tiles and the gap between them.
  const roomy = (height - 20) / 2 >= ROOM_FOR_DETAIL
  const gradient = TILE_LOOK === 'gradient'
  return (
    <nav ref={setElement} aria-label={strings.shell.nav.label} className="grid min-h-0 min-w-0 grid-cols-2 grid-rows-2 gap-5 short:gap-4">
      {SECTIONS.map((section) => {
        const line = lines[section.section]
        const Icon = section.icon
        const tone = section.tone === 'neutral' ? null : section.tone
        return (
          <Link
            key={section.path}
            to={section.path}
            {...spatial}
            aria-busy={line.busy || undefined}
            style={gradient && tone ? { backgroundImage: tileGradient(tone) } : undefined}
            className={`group relative isolate flex min-h-0 min-w-0 flex-col justify-between gap-2 overflow-hidden rounded-tile pb-6 pl-6 pr-6 pt-[22px] text-ink transition-transform hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0 short:pb-4 short:pl-5 short:pr-5 short:pt-4 ${TONE[section.tone].fill}`}
          >
            {gradient && <Bubbles />}
            <div className="relative flex items-start justify-between">
              <Icon size={40} className="short:size-8" />
              <span
                aria-hidden="true"
                className={`flex size-11 items-center justify-center rounded-full bg-ink short:size-9 ${TONE[section.tone].text}`}
              >
                <ArrowRightIcon size={20} />
              </span>
            </div>
            <div className="relative flex min-w-0 flex-col gap-1.5">
              <h2 className="font-title truncate text-[clamp(26px,min(5.5vh,3.4vw),44px)] leading-[1.15]">{section.title}</h2>
              <p className="truncate text-base font-medium">{line.text}</p>
              {/* 85 % ink: 4.5:1 or better on every tile colour and gradient stop (75 % fell to 4.4:1 on coral). */}
              {roomy && line.detail && <p className="-mt-1 truncate text-[15px] opacity-[0.85]">{line.detail}</p>}
            </div>
          </Link>
        )
      })}
    </nav>
  )
}
