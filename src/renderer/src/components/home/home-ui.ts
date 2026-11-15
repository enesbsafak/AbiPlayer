/*
 * Shared pieces of the home screen's look ("Canlı renk", docs/tasarim/ana-sayfa).
 * Class strings, written out in full so Tailwind finds them.
 */

/** The large left tile, whatever it shows. */
export const FEATURE_TILE = 'relative min-h-0 min-w-0 overflow-hidden rounded-tile bg-raised'

/** The sun label at the top of the large tile's text. */
export const FEATURE_BADGE =
  'flex h-10 w-fit shrink-0 items-center rounded-full bg-sun px-[18px] text-base font-bold text-ink short:h-9 short:text-[15px]'

/**
 * The large tile's title: Bricolage 800 at a calm 40–44 px on the designed
 * 1280 × 800, smaller in a smaller window; two lines at most (one in a short
 * window), then an ellipsis. line-clamp clips, so the bottom padding keeps
 * descenders ("Kayıp Şehir") whole.
 */
export const FEATURE_TITLE =
  'font-title line-clamp-2 break-words pb-[0.12em] text-[clamp(28px,min(5.2vh,3.3vw),44px)] leading-[1.05] tracking-[-0.03em] short:line-clamp-1'

/** The one primary action of the screen: a white pill, ink text. */
export const PRIMARY_PILL =
  'flex h-[60px] items-center gap-3 rounded-full bg-white pl-7 pr-[34px] text-xl font-bold text-ink transition-colors hover:bg-surface-300 short:h-[52px] short:text-lg'

/** Its companion: transparent, a 2 px edge of white at 50 %. */
export const SECONDARY_PILL =
  'flex h-[60px] items-center rounded-full border-2 border-white/50 bg-transparent px-[26px] text-[17px] font-medium text-white transition-colors hover:border-white short:h-[52px]'
