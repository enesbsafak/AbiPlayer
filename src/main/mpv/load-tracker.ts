/**
 * Decides which load an mpv lifecycle event belongs to.
 *
 * mpv tags `start-file` and `end-file` with the playlist entry id of the file
 * they concern (documented in the pinned build's manual). `loadfile` returns
 * that id as `playlist_entry_id` in its reply on the builds we ship, but the
 * manual does not promise it, so it is optional here: without it the first
 * `start-file` after the reply is taken as ours (mpv writes a command's reply
 * before any event the command causes). Being the newest load requested is
 * never enough: property values are not tagged with a file, so until our
 * entry's `start-file` has been seen nothing is attributed to it. `file-loaded` and
 * `playback-restart` carry no id and belong to the entry most recently
 * started.
 *
 * Events that arrive while the `loadfile` reply is still outstanding are held
 * and replayed once the reply says which entry is ours, so an early failure is
 * attributed rather than dropped.
 */

export type MpvLoadEvent =
  | { kind: 'start'; entryId: number | null }
  | {
      kind: 'end'
      entryId: number | null
      reason: string | null
      fileError: string | null
      insertId: number | null
    }
  | { kind: 'loaded' }
  | { kind: 'restart' }

export type MpvLoadVerdict = MpvLoadEvent & { token: number }

interface TrackedLoad {
  token: number
  replied: boolean
  /** The playlist entry that is ours, once known. */
  entryId: number | null
  /** Our entry has started and has not ended. */
  live: boolean
}

export class MpvLoadTracker {
  private current: TrackedLoad | null = null
  private held: MpvLoadEvent[] = []

  /** A new `loadfile` is about to be sent for `token`. */
  begin(token: number): void {
    this.current = { token, replied: false, entryId: null, live: false }
    this.held = []
  }

  /** Nothing is loaded any more (stop). */
  clear(): void {
    this.current = null
    this.held = []
  }

  get token(): number | null {
    return this.current?.token ?? null
  }

  /** Whether property changes describe our file right now. */
  get accepting(): boolean {
    return this.current?.live ?? false
  }

  /** The `loadfile` reply for `token` arrived; `entryId` when mpv returned one. */
  replied(token: number, entryId: number | null): MpvLoadVerdict[] {
    const load = this.current
    if (!load || load.token !== token || load.replied) return []
    load.replied = true

    const held = this.held
    this.held = []

    if (entryId === null) {
      // Without an id, anything seen before the reply belongs to an earlier
      // command's file.
      return []
    }
    load.entryId = entryId
    return held.flatMap((event) => this.handle(event))
  }

  handle(event: MpvLoadEvent): MpvLoadVerdict[] {
    const load = this.current
    if (!load) return []

    if (!load.replied) {
      this.held.push(event)
      return []
    }

    switch (event.kind) {
      case 'start':
        return this.onStart(load, event.entryId)
      case 'end':
        return this.onEnd(load, event)
      case 'loaded':
      case 'restart':
        return load.live ? [{ ...event, token: load.token }] : []
    }
  }

  private onStart(load: TrackedLoad, entryId: number | null): MpvLoadVerdict[] {
    if (load.entryId === null) {
      // No id from the reply (or a redirect without one): the first file
      // started after it is ours.
      load.entryId = entryId
    } else if (entryId !== null && entryId !== load.entryId) {
      return []
    }
    load.live = true
    return [{ kind: 'start', entryId, token: load.token }]
  }

  private onEnd(load: TrackedLoad, event: Extract<MpvLoadEvent, { kind: 'end' }>): MpvLoadVerdict[] {
    const ours =
      event.entryId === null ? load.live : load.entryId !== null && event.entryId === load.entryId
    if (!ours) return []

    load.live = false
    if (event.reason === 'redirect') {
      // A playlist URL expanded into new entries; the first of them carries
      // this load on. Without the id, the next start-file is taken as ours.
      load.entryId = event.insertId
    }
    return [{ ...event, token: load.token }]
  }
}
