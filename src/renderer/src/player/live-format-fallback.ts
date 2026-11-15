import type { XtreamLiveFormat } from '@/types/xtream'
import { liveFormatLabel } from '@/services/playback'
import type { MpvStateSnapshot } from '@/services/platform'
import { isSnapshotLoaded } from './mpv-snapshot'
import { strings } from '@/strings'

/**
 * One playback's live format with mpv: the format it was opened in, whether
 * it ever opened, and whether the one fallback (plan F2-04) was used.
 */
export interface LiveFormatState {
  format: XtreamLiveFormat | null
  /** A load of this playback reached `file-loaded`; later failures are the reconnect policy's. */
  opened: boolean
  fellBack: boolean
  /** The failed load the fallback replaced; its late snapshots are not acted upon. */
  replacedLoadId: number | null
}

export function initialLiveFormatState(format: XtreamLiveFormat | null): LiveFormatState {
  return { format, opened: false, fellBack: false, replacedLoadId: null }
}

export interface LiveFormatStep {
  state: LiveFormatState
  /** Open the playback again in this format now. */
  fallbackTo: XtreamLiveFormat | null
  /** This snapshot belongs to a load the fallback replaced; ignore it. */
  ignore: boolean
}

/**
 * Applied to every snapshot of the current playback, before the reconnect
 * policy sees it. `alternative` is the format the decision table allows as a
 * fallback (`liveFormatFallback`), or null.
 */
export function stepLiveFormat(
  state: LiveFormatState,
  snapshot: Pick<MpvStateSnapshot, 'phase' | 'loadId'>,
  alternative: XtreamLiveFormat | null
): LiveFormatStep {
  if (state.replacedLoadId !== null && snapshot.loadId === state.replacedLoadId) {
    return { state, fallbackTo: null, ignore: true }
  }
  if (isSnapshotLoaded(snapshot)) {
    return { state: state.opened ? state : { ...state, opened: true }, fallbackTo: null, ignore: false }
  }
  if (
    snapshot.phase !== 'error' ||
    state.opened ||
    state.fellBack ||
    state.format === null ||
    alternative === null ||
    alternative === state.format
  ) {
    return { state, fallbackTo: null, ignore: false }
  }
  return {
    state: { format: alternative, opened: false, fellBack: true, replacedLoadId: snapshot.loadId },
    fallbackTo: alternative,
    ignore: true
  }
}

export function liveFormatFallbackNotice(failed: XtreamLiveFormat, next: XtreamLiveFormat): string {
  return strings.player.errors.liveFormatFallback(liveFormatLabel(failed), liveFormatLabel(next))
}
