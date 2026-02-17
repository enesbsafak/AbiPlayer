import { useEffect, useRef, type RefObject } from 'react'
import Hls from 'hls.js'
import { useStore } from '@/store'
import type { AudioTrack, SubtitleCue, SubtitleTrack } from '@/types/player'
import { extractEmbeddedSubtitle, probeEmbeddedSubtitles } from '@/services/platform'
import { parseSubtitles } from '@/services/subtitle-parser'
import {
  pickPreferredAudioTrackId,
  pickPreferredSubtitleTrackId
} from '@/services/track-preferences'

const HLS_TRACK_PREFIX = 'hls:'
const NATIVE_TRACK_PREFIX = 'native:'
const PROBED_TRACK_PREFIX = 'probe:'
const HLS_AUDIO_TRACK_PREFIX = 'hls-a:'
const NATIVE_AUDIO_TRACK_PREFIX = 'native-a:'

type NativeAudioTrackLike = {
  enabled?: boolean
  label?: string
  language?: string
}

type NativeAudioTrackListLike = {
  length: number
  [index: number]: NativeAudioTrackLike
  addEventListener?: (type: 'addtrack' | 'removetrack' | 'change', listener: () => void) => void
  removeEventListener?: (type: 'addtrack' | 'removetrack' | 'change', listener: () => void) => void
}

function isSubtitleTextTrack(track: TextTrack): boolean {
  return track.kind === 'subtitles' || track.kind === 'captions'
}

function urlIsHlsOrTs(url: string): boolean {
  const normalized = url.toLowerCase()
  return normalized.includes('.m3u8') || normalized.includes('/live/') || !!normalized.match(/\.\d+\.ts(\?|$)/) || normalized.endsWith('.ts')
}

function normalizeTrackMeta(value: string | undefined): string {
  return value?.trim().toLowerCase() || ''
}

function getNativeAudioTracks(video: HTMLVideoElement): NativeAudioTrackListLike | null {
  const maybeTracks = (video as HTMLVideoElement & { audioTracks?: NativeAudioTrackListLike }).audioTracks
  if (!maybeTracks || typeof maybeTracks.length !== 'number') return null
  return maybeTracks
}

export function usePlayer(
  videoRef: RefObject<HTMLVideoElement | null>,
  options?: { disabled?: boolean }
) {
  const disabled = options?.disabled ?? false
  const hlsRef = useRef<Hls | null>(null)
  const directReadErrorRetryCountRef = useRef(0)
  const audioPreferenceAppliedRef = useRef(false)
  const subtitlePreferenceAppliedRef = useRef(false)

  const {
    currentChannel, volume, isMuted, currentAudioTrack, currentSubtitleTrack, settings,
    setPlaying, setPaused, setBuffering, setCurrentTime, setDuration,
    setPlayerError, setAudioTracks, setCurrentAudioTrack,
    setSubtitleTracks, setCurrentSubtitleTrack, setSubtitleCues,
    subtitleCues, setActiveSubtitleCues, setVolume, setMuted
  } = useStore()

  useEffect(() => {
    audioPreferenceAppliedRef.current = false
    subtitlePreferenceAppliedRef.current = false
  }, [currentChannel?.id, currentChannel?.streamUrl])

  function collectNativeSubtitleTracks(video: HTMLVideoElement): SubtitleTrack[] {
    const tracks = video.textTracks
    if (!tracks || tracks.length === 0) return []

    const nativeTracks: SubtitleTrack[] = []
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i]
      if (!isSubtitleTextTrack(track)) continue

      nativeTracks.push({
        id: `${NATIVE_TRACK_PREFIX}${i}`,
        name: track.label || track.language || `Subtitle ${i + 1}`,
        lang: track.language || undefined,
        type: 'embedded'
      })
    }

    return nativeTracks
  }

  function collectHlsSubtitleTracks(hls: Hls): SubtitleTrack[] {
    const tracks = hls.subtitleTracks || []
    return tracks.map((track, index) => ({
      id: `${HLS_TRACK_PREFIX}${index}`,
      name: track.name || track.lang || `Subtitle ${index + 1}`,
      lang: track.lang,
      type: 'embedded'
    }))
  }

  function collectProbedSubtitleTracks(
    tracks: Array<{ index: number; codec: string; language?: string; title?: string }>
  ): SubtitleTrack[] {
    return tracks.map((track, index) => {
      const lang = track.language?.trim()
      const title = track.title?.trim()
      const codec = track.codec?.trim()
      const nameParts = [lang ? lang.toUpperCase() : '', title || '', codec ? `(${codec})` : ''].filter(Boolean)
      return {
        id: `${PROBED_TRACK_PREFIX}${track.index}`,
        name: nameParts.join(' ') || `Subtitle ${index + 1}`,
        lang: lang || undefined,
        type: 'embedded'
      }
    })
  }

  function collectNativeAudioTracks(video: HTMLVideoElement): AudioTrack[] {
    const tracks = getNativeAudioTracks(video)
    if (!tracks || tracks.length === 0) return []

    const nativeTracks: AudioTrack[] = []
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i]
      nativeTracks.push({
        id: `${NATIVE_AUDIO_TRACK_PREFIX}${i}`,
        name: track.label || track.language || `Audio ${i + 1}`,
        lang: track.language || undefined,
        default: !!track.enabled
      })
    }

    return nativeTracks
  }

  function collectHlsAudioTracks(hls: Hls): AudioTrack[] {
    const tracks = hls.audioTracks || []
    return tracks.map((track, index) => ({
      id: `${HLS_AUDIO_TRACK_PREFIX}${index}`,
      name: track.name || track.lang || `Audio ${index + 1}`,
      lang: track.lang,
      default: !!track.default
    }))
  }

  function mergeSubtitleTracks(...trackGroups: SubtitleTrack[][]): SubtitleTrack[] {
    return trackGroups.flat()
  }

  function syncActiveSubtitleCues(video: HTMLVideoElement) {
    const nextCues: SubtitleCue[] = []
    const tracks = video.textTracks

    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i]
      if (!isSubtitleTextTrack(track)) continue
      if (track.mode !== 'hidden' && track.mode !== 'showing') continue
      if (!track.activeCues) continue

      for (let j = 0; j < track.activeCues.length; j++) {
        const cue = track.activeCues[j] as unknown as { startTime?: number; endTime?: number; text?: string }
        if (typeof cue.startTime !== 'number' || typeof cue.endTime !== 'number') continue
        nextCues.push({
          startTime: cue.startTime,
          endTime: cue.endTime,
          text: cue.text || ''
        })
      }
    }

    setActiveSubtitleCues(nextCues)
  }

  function attachCueListeners(video: HTMLVideoElement) {
    const tracks = video.textTracks
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i]
      if (!isSubtitleTextTrack(track)) continue
      track.oncuechange = () => syncActiveSubtitleCues(video)
    }
  }

  function disableAllNativeSubtitleTracks(video: HTMLVideoElement) {
    const tracks = video.textTracks
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i]
      if (!isSubtitleTextTrack(track)) continue
      track.mode = 'disabled'
    }
  }

  function setNativeSubtitleTrack(video: HTMLVideoElement, nativeTrackIndex: number) {
    const tracks = video.textTracks
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i]
      if (!isSubtitleTextTrack(track)) continue
      // Keep selected track hidden and render all subtitles via custom overlay.
      track.mode = i === nativeTrackIndex ? 'hidden' : 'disabled'
    }
  }

  function setNativeAudioTrack(video: HTMLVideoElement, nativeTrackIndex: number) {
    const tracks = getNativeAudioTracks(video)
    if (!tracks) return

    for (let i = 0; i < tracks.length; i++) {
      tracks[i].enabled = i === nativeTrackIndex
    }
  }

  function findNativeSubtitleTrackIndexForHls(
    video: HTMLVideoElement,
    hls: Hls,
    hlsTrackId: number
  ): number {
    const hlsTrack = hls.subtitleTracks?.[hlsTrackId]
    const targetLang = normalizeTrackMeta(hlsTrack?.lang)
    const targetName = normalizeTrackMeta(hlsTrack?.name)
    const subtitleTrackIndices: number[] = []

    for (let i = 0; i < video.textTracks.length; i++) {
      const nativeTrack = video.textTracks[i]
      if (!isSubtitleTextTrack(nativeTrack)) continue

      subtitleTrackIndices.push(i)

      const nativeLang = normalizeTrackMeta(nativeTrack.language)
      const nativeLabel = normalizeTrackMeta(nativeTrack.label)
      if (targetLang && targetName && nativeLang === targetLang && nativeLabel === targetName) {
        return i
      }
    }

    if (targetLang) {
      for (const index of subtitleTrackIndices) {
        const nativeTrack = video.textTracks[index]
        if (normalizeTrackMeta(nativeTrack.language) === targetLang) return index
      }
    }

    if (targetName) {
      for (const index of subtitleTrackIndices) {
        const nativeTrack = video.textTracks[index]
        if (normalizeTrackMeta(nativeTrack.label) === targetName) return index
      }
    }

    if (hlsTrackId >= 0 && hlsTrackId < subtitleTrackIndices.length) {
      return subtitleTrackIndices[hlsTrackId]
    }

    return subtitleTrackIndices[0] ?? -1
  }

  function applyHlsSubtitleTrack(video: HTMLVideoElement, hls: Hls, trackId: number): boolean {
    hls.subtitleTrack = trackId
    hls.subtitleDisplay = true

    const nativeTrackId = findNativeSubtitleTrackIndexForHls(video, hls, trackId)
    if (nativeTrackId >= 0) {
      setNativeSubtitleTrack(video, nativeTrackId)
      syncActiveSubtitleCues(video)
      return true
    }

    disableAllNativeSubtitleTracks(video)
    setActiveSubtitleCues([])
    return false
  }

  // HLS lifecycle
  useEffect(() => {
    if (disabled) return
    const video = videoRef.current
    if (!video || !currentChannel) return
    directReadErrorRetryCountRef.current = 0

    const url = currentChannel.streamUrl
    if (!url) return
    let disposed = false
    let probedTracks: SubtitleTrack[] = []

    // Cleanup previous
    if (hlsRef.current) {
      hlsRef.current.destroy()
      hlsRef.current = null
    }

    // Detect HLS streams
    const isHLS = url.includes('.m3u8') || url.includes('/live/')
    const isTS = url.match(/\.\d+\.ts(\?|$)/) || url.endsWith('.ts')

    const refreshAudioTracks = (hls: Hls | null) => {
      const hlsTracks = hls ? collectHlsAudioTracks(hls) : []
      const nativeTracks = collectNativeAudioTracks(video)
      const nextTracks = hlsTracks.length > 0 ? hlsTracks : nativeTracks

      setAudioTracks(nextTracks)

      const selectedTrack = useStore.getState().currentAudioTrack
      if (nextTracks.length === 0) {
        if (selectedTrack !== null) setCurrentAudioTrack(null)
        return
      }

      if (selectedTrack && nextTracks.some((track) => track.id === selectedTrack)) {
        audioPreferenceAppliedRef.current = true
        return
      }

      if (!audioPreferenceAppliedRef.current) {
        const preferredAudioLanguage = useStore.getState().settings.preferredAudioLanguage
        const preferredTrackId = pickPreferredAudioTrackId(nextTracks, preferredAudioLanguage)
        if (preferredTrackId) setCurrentAudioTrack(preferredTrackId)
        audioPreferenceAppliedRef.current = true
        return
      }

      const fallbackTrack = nextTracks.find((track) => track.default) ?? nextTracks[0]
      if (fallbackTrack && selectedTrack !== fallbackTrack.id) {
        setCurrentAudioTrack(fallbackTrack.id)
      }
    }

    const refreshSubtitleTracks = (hls: Hls | null) => {
      const hlsTracks = hls ? collectHlsSubtitleTracks(hls) : []
      const nativeTracks = collectNativeSubtitleTracks(video)
      const visibleNativeTracks = hlsTracks.length > 0 ? [] : nativeTracks
      const mergedTracks = mergeSubtitleTracks(hlsTracks, visibleNativeTracks, probedTracks)
      setSubtitleTracks(mergedTracks)

      const selectedTrack = useStore.getState().currentSubtitleTrack

      if (mergedTracks.length === 0) {
        if (selectedTrack !== null) {
          setCurrentSubtitleTrack(null)
          setSubtitleCues([])
          setActiveSubtitleCues([])
        }
        return
      }

      if (selectedTrack === 'external') return

      if (selectedTrack && mergedTracks.some((track) => String(track.id) === selectedTrack)) {
        subtitlePreferenceAppliedRef.current = true
        return
      }

      if (!subtitlePreferenceAppliedRef.current) {
        subtitlePreferenceAppliedRef.current = true

        const { defaultSubtitleEnabled, preferredSubtitleLanguage } = useStore.getState().settings
        if (!defaultSubtitleEnabled) {
          if (selectedTrack !== null) {
            setCurrentSubtitleTrack(null)
            setSubtitleCues([])
            setActiveSubtitleCues([])
          }
          return
        }

        const preferredTrackId = pickPreferredSubtitleTrackId(
          mergedTracks,
          preferredSubtitleLanguage
        )
        if (preferredTrackId) {
          setCurrentSubtitleTrack(preferredTrackId)
        } else {
          setCurrentSubtitleTrack(null)
          setSubtitleCues([])
          setActiveSubtitleCues([])
        }
        return
      }

      if (selectedTrack !== null) {
        setCurrentSubtitleTrack(null)
        setSubtitleCues([])
        setActiveSubtitleCues([])
      }
    }

    const syncCurrentHlsSubtitleSelection = () => {
      const selectedTrack = useStore.getState().currentSubtitleTrack
      if (!selectedTrack || !selectedTrack.startsWith(HLS_TRACK_PREFIX)) return

      const hls = hlsRef.current
      if (!hls) return

      const trackId = Number.parseInt(selectedTrack.replace(HLS_TRACK_PREFIX, ''), 10)
      if (Number.isNaN(trackId)) return

      applyHlsSubtitleTrack(video, hls, trackId)
    }

    const textTrackList = video.textTracks
    const handleTextTrackListChange = () => {
      refreshSubtitleTracks(hlsRef.current)
      attachCueListeners(video)
      syncCurrentHlsSubtitleSelection()
      syncActiveSubtitleCues(video)
    }

    const nativeAudioTracks = getNativeAudioTracks(video)
    const handleAudioTrackListChange = () => {
      refreshAudioTracks(hlsRef.current)
    }
    const handleMediaTracksMaybeReady = () => {
      refreshAudioTracks(hlsRef.current)
      refreshSubtitleTracks(hlsRef.current)
    }

    if (typeof textTrackList.addEventListener === 'function') {
      textTrackList.addEventListener('addtrack', handleTextTrackListChange)
      textTrackList.addEventListener('removetrack', handleTextTrackListChange)
      textTrackList.addEventListener('change', handleTextTrackListChange)
    }

    if (nativeAudioTracks && typeof nativeAudioTracks.addEventListener === 'function') {
      nativeAudioTracks.addEventListener('addtrack', handleAudioTrackListChange)
      nativeAudioTracks.addEventListener('removetrack', handleAudioTrackListChange)
      nativeAudioTracks.addEventListener('change', handleAudioTrackListChange)
    }

    video.addEventListener('loadeddata', handleMediaTracksMaybeReady)
    video.addEventListener('canplay', handleMediaTracksMaybeReady)

    if (isHLS || isTS) {
      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
          backBufferLength: 30,
          maxBufferLength: 15,
          maxMaxBufferLength: 30,
          renderTextTracksNatively: true,
          enableWebVTT: true,
          enableCEA708Captions: true,
          xhrSetup: (xhr) => {
            xhr.withCredentials = false
          }
        })

        hls.loadSource(url)
        hls.attachMedia(video)

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          video.play().catch(() => {})
          refreshAudioTracks(hls)
          refreshSubtitleTracks(hls)
          attachCueListeners(video)
          syncCurrentHlsSubtitleSelection()
        })

        hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
          refreshAudioTracks(hls)
        })

        hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, () => {
          refreshAudioTracks(hls)

          const activeTrackId = `${HLS_AUDIO_TRACK_PREFIX}${hls.audioTrack}`
          if (useStore.getState().currentAudioTrack !== activeTrackId) {
            setCurrentAudioTrack(activeTrackId)
          }
        })

        hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => {
          refreshSubtitleTracks(hls)
          attachCueListeners(video)
          syncCurrentHlsSubtitleSelection()
        })

        hls.on(Hls.Events.SUBTITLE_TRACK_SWITCH, () => {
          refreshSubtitleTracks(hls)
          attachCueListeners(video)
          syncCurrentHlsSubtitleSelection()
          syncActiveSubtitleCues(video)
        })

        let retryCount = 0
        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) {
            if (retryCount >= 3) {
              setPlayerError(`Oynatma basarisiz: ${data.details}`)
              return
            }
            retryCount++
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                hls.startLoad()
                break
              case Hls.ErrorTypes.MEDIA_ERROR:
                hls.recoverMediaError()
                break
              default:
                setPlayerError(`Oynatma hatasi: ${data.details}`)
                break
            }
          }
        })

        hlsRef.current = hls
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = url
        video.play().catch(() => {})
        video.addEventListener(
          'loadedmetadata',
          () => {
            refreshAudioTracks(null)
            refreshSubtitleTracks(null)
            attachCueListeners(video)
          },
          { once: true }
        )
      }
    } else {
      const startDirectPlayback = () => {
        // Direct playback (mp4, mkv, etc)
        video.src = url
        video.play().catch(() => {})

        // For direct playback, check for embedded tracks after metadata loads
        video.addEventListener('loadedmetadata', () => {
          refreshAudioTracks(null)
          refreshSubtitleTracks(null)
          attachCueListeners(video)
          syncActiveSubtitleCues(video)
        }, { once: true })
      }

      // Probe direct VOD streams before playback starts to avoid concurrent
      // connections that can exceed provider max-connection limits.
      const shouldProbeBeforePlayback = currentChannel.type !== 'live'
      if (shouldProbeBeforePlayback) {
        void (async () => {
          try {
            const tracks = await probeEmbeddedSubtitles(url)
            if (disposed || tracks.length === 0) {
              if (!disposed) startDirectPlayback()
              return
            }

            probedTracks = collectProbedSubtitleTracks(tracks)
            setSubtitleTracks(mergeSubtitleTracks([], [], probedTracks))
          } catch (error) {
            console.warn('Failed to probe embedded subtitles', error)
          }

          if (!disposed) startDirectPlayback()
        })()
      } else {
        startDirectPlayback()
      }
    }

    return () => {
      disposed = true
      if (typeof textTrackList.removeEventListener === 'function') {
        textTrackList.removeEventListener('addtrack', handleTextTrackListChange)
        textTrackList.removeEventListener('removetrack', handleTextTrackListChange)
        textTrackList.removeEventListener('change', handleTextTrackListChange)
      }

      if (nativeAudioTracks && typeof nativeAudioTracks.removeEventListener === 'function') {
        nativeAudioTracks.removeEventListener('addtrack', handleAudioTrackListChange)
        nativeAudioTracks.removeEventListener('removetrack', handleAudioTrackListChange)
        nativeAudioTracks.removeEventListener('change', handleAudioTrackListChange)
      }

      video.removeEventListener('loadeddata', handleMediaTracksMaybeReady)
      video.removeEventListener('canplay', handleMediaTracksMaybeReady)

      disableAllNativeSubtitleTracks(video)

      if (hlsRef.current) {
        hlsRef.current.destroy()
        hlsRef.current = null
      }
    }
  }, [
    currentChannel,
    videoRef,
    setActiveSubtitleCues,
    setAudioTracks,
    setCurrentAudioTrack,
    setCurrentSubtitleTrack,
    setPlayerError,
    setSubtitleCues,
    setSubtitleTracks,
    disabled
  ])

  // Volume sync
  useEffect(() => {
    if (disabled) return
    const video = videoRef.current
    if (!video) return
    video.volume = volume
    video.muted = isMuted
  }, [volume, isMuted, videoRef, disabled])

  // Apply configured default volume when a new channel starts
  useEffect(() => {
    if (disabled) return
    if (!currentChannel) return
    const nextVolume = Math.min(1, Math.max(0, settings.defaultVolume))
    setVolume(nextVolume)
    setMuted(false)

    const video = videoRef.current
    if (video) {
      video.volume = nextVolume
      video.muted = false
    }
  }, [currentChannel, settings.defaultVolume, setMuted, setVolume, videoRef, disabled])

  // Audio track switching
  useEffect(() => {
    if (disabled) return
    const video = videoRef.current
    if (!video || !currentAudioTrack) return

    const hls = hlsRef.current

    if (currentAudioTrack.startsWith(HLS_AUDIO_TRACK_PREFIX)) {
      const trackId = Number.parseInt(currentAudioTrack.replace(HLS_AUDIO_TRACK_PREFIX, ''), 10)
      if (!Number.isNaN(trackId) && hls) {
        hls.audioTrack = trackId
      }
      return
    }

    if (currentAudioTrack.startsWith(NATIVE_AUDIO_TRACK_PREFIX)) {
      const nativeTrackId = Number.parseInt(currentAudioTrack.replace(NATIVE_AUDIO_TRACK_PREFIX, ''), 10)
      if (!Number.isNaN(nativeTrackId)) {
        setNativeAudioTrack(video, nativeTrackId)
      }
      return
    }

    // Backward compatibility for old persisted numeric IDs
    const legacyTrackId = Number.parseInt(currentAudioTrack, 10)
    if (!Number.isNaN(legacyTrackId)) {
      if (hls) hls.audioTrack = legacyTrackId
      else setNativeAudioTrack(video, legacyTrackId)
    }
  }, [currentAudioTrack, videoRef, disabled])

  // Subtitle track switching via HLS.js/native tracks
  useEffect(() => {
    if (disabled) return
    const video = videoRef.current
    if (!video) return
    const hls = hlsRef.current
    let cancelled = false
    const retryTimers: ReturnType<typeof setTimeout>[] = []

    if (currentSubtitleTrack === null || currentSubtitleTrack === 'external') {
      if (hls) {
        hls.subtitleTrack = -1
        hls.subtitleDisplay = false
      }
      disableAllNativeSubtitleTracks(video)
      if (currentSubtitleTrack === null) {
        setSubtitleCues([])
        setActiveSubtitleCues([])
      }
      return
    }

    if (currentSubtitleTrack.startsWith(PROBED_TRACK_PREFIX)) {
      if (hls) {
        hls.subtitleTrack = -1
        hls.subtitleDisplay = false
      }
      disableAllNativeSubtitleTracks(video)
      setSubtitleCues([])
      setActiveSubtitleCues([])

      const streamIndex = Number.parseInt(currentSubtitleTrack.replace(PROBED_TRACK_PREFIX, ''), 10)
      if (Number.isNaN(streamIndex) || !currentChannel?.streamUrl) return

      void (async () => {
        try {
          const extracted = await extractEmbeddedSubtitle(currentChannel.streamUrl, streamIndex)
          if (cancelled) return
          if (!extracted) {
            setSubtitleCues([])
            return
          }
          const cues = parseSubtitles(extracted.content, `embedded.${extracted.format}`)
          setSubtitleCues(cues)
        } catch (error) {
          if (!cancelled) console.warn('Failed to extract embedded subtitle track', error)
        }
      })()

      return () => {
        cancelled = true
      }
    }

    if (currentSubtitleTrack.startsWith(HLS_TRACK_PREFIX)) {
      setSubtitleCues([])
      setActiveSubtitleCues([])

      const trackId = Number.parseInt(currentSubtitleTrack.replace(HLS_TRACK_PREFIX, ''), 10)
      if (!Number.isNaN(trackId) && hls) {
        const appliedNow = applyHlsSubtitleTrack(video, hls, trackId)

        if (!appliedNow) {
          for (let attempt = 1; attempt <= 8; attempt++) {
            retryTimers.push(
              setTimeout(() => {
                if (cancelled) return
                const applied = applyHlsSubtitleTrack(video, hls, trackId)
                if (applied) {
                  for (const timer of retryTimers) clearTimeout(timer)
                }
              }, attempt * 250)
            )
          }
        }
      }

      return () => {
        cancelled = true
        for (const timer of retryTimers) clearTimeout(timer)
      }
    }

    if (currentSubtitleTrack.startsWith(NATIVE_TRACK_PREFIX)) {
      setSubtitleCues([])
      const nativeTrackId = Number.parseInt(currentSubtitleTrack.replace(NATIVE_TRACK_PREFIX, ''), 10)
      if (!Number.isNaN(nativeTrackId)) {
        if (hls) {
          hls.subtitleTrack = -1
          hls.subtitleDisplay = false
        }
        setNativeSubtitleTrack(video, nativeTrackId)
        syncActiveSubtitleCues(video)
      }
      return
    }

    // Backward compatibility for old persisted numeric IDs
    const legacyTrackId = Number.parseInt(currentSubtitleTrack, 10)
    if (!Number.isNaN(legacyTrackId) && hls) {
      setSubtitleCues([])
      setActiveSubtitleCues([])
      applyHlsSubtitleTrack(video, hls, legacyTrackId)
    }

    return () => {
      cancelled = true
      for (const timer of retryTimers) clearTimeout(timer)
    }
  }, [currentSubtitleTrack, currentChannel, videoRef, setActiveSubtitleCues, setSubtitleCues, disabled])

  // Video events
  useEffect(() => {
    if (disabled) return
    const video = videoRef.current
    if (!video) return

    const onPlay = () => { setPlaying(true); setPaused(false) }
    const onPause = () => setPaused(true)
    const onWaiting = () => setBuffering(true)
    const onPlaying = () => {
      setBuffering(false)
      setPlayerError(null)
    }
    const onTimeUpdate = () => setCurrentTime(video.currentTime)
    const onDurationChange = () => setDuration(video.duration)
    const onError = () => {
      const message = video.error?.message || 'Oynatma hatasi'
      const isDirectStream = !!currentChannel?.streamUrl && !(urlIsHlsOrTs(currentChannel.streamUrl))
      const isReadPipelineError =
        message.includes('PIPELINE_ERROR_READ') || message.includes('FFmpegDemuxer: data source error')

      if (isDirectStream && isReadPipelineError && directReadErrorRetryCountRef.current < 2) {
        const resumeAt = Number.isFinite(video.currentTime) ? video.currentTime : 0
        const src = video.currentSrc || currentChannel!.streamUrl

        if (src) {
          directReadErrorRetryCountRef.current += 1
          setPlayerError(null)
          setBuffering(true)

          video.pause()
          video.src = src
          video.addEventListener(
            'loadedmetadata',
            () => {
              if (resumeAt > 1) {
                try {
                  video.currentTime = Math.max(0, resumeAt - 0.25)
                } catch {}
              }
              video.play().catch(() => {})
            },
            { once: true }
          )
          video.load()
          return
        }
      }

      setPlayerError(message)
    }

    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('waiting', onWaiting)
    video.addEventListener('playing', onPlaying)
    video.addEventListener('timeupdate', onTimeUpdate)
    video.addEventListener('durationchange', onDurationChange)
    video.addEventListener('error', onError)

    return () => {
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('waiting', onWaiting)
      video.removeEventListener('playing', onPlaying)
      video.removeEventListener('timeupdate', onTimeUpdate)
      video.removeEventListener('durationchange', onDurationChange)
      video.removeEventListener('error', onError)
    }
  }, [videoRef, currentChannel, setPlaying, setPaused, setBuffering, setCurrentTime, setDuration, setPlayerError, disabled])

  // Cue matching for parsed subtitle sources (external files + extracted embedded tracks)
  useEffect(() => {
    if (disabled) return
    const isParsedSubtitleSource =
      currentSubtitleTrack === 'external' ||
      (typeof currentSubtitleTrack === 'string' && currentSubtitleTrack.startsWith(PROBED_TRACK_PREFIX))

    if (!isParsedSubtitleSource || subtitleCues.length === 0) {
      if (!isParsedSubtitleSource) setActiveSubtitleCues([])
      return
    }

    const interval = setInterval(() => {
      const video = videoRef.current
      if (!video) return
      const t = video.currentTime
      const active = subtitleCues.filter((c) => t >= c.startTime && t <= c.endTime)
      setActiveSubtitleCues(active)
    }, 100)

    return () => clearInterval(interval)
  }, [currentSubtitleTrack, subtitleCues, videoRef, setActiveSubtitleCues, disabled])
}
