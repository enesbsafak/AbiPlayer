import { useEffect, useRef, type RefObject } from 'react'
import Hls from 'hls.js'
import { useStore } from '@/store'

export function usePlayer(videoRef: RefObject<HTMLVideoElement | null>) {
  const hlsRef = useRef<Hls | null>(null)

  const {
    currentChannel, volume, isMuted, currentAudioTrack, currentSubtitleTrack,
    setPlaying, setPaused, setBuffering, setCurrentTime, setDuration,
    setPlayerError, setAudioTracks, setCurrentAudioTrack,
    setSubtitleTracks, setCurrentSubtitleTrack,
    subtitleCues, setActiveSubtitleCues
  } = useStore()

  // HLS lifecycle
  useEffect(() => {
    const video = videoRef.current
    if (!video || !currentChannel) return

    const url = currentChannel.streamUrl
    if (!url) return

    // Cleanup previous
    if (hlsRef.current) {
      hlsRef.current.destroy()
      hlsRef.current = null
    }

    // Detect HLS streams
    const isHLS = url.includes('.m3u8') || url.includes('/live/')
    const isTS = url.match(/\.\d+\.ts(\?|$)/) || url.endsWith('.ts')

    if (isHLS || isTS) {
      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
          backBufferLength: 30,
          maxBufferLength: 15,
          maxMaxBufferLength: 30,
          renderTextTracksNatively: false,
          xhrSetup: (xhr) => {
            xhr.withCredentials = false
          }
        })

        hls.loadSource(url)
        hls.attachMedia(video)

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          video.play().catch(() => {})

          // Audio tracks
          const aTracks = hls.audioTracks || []
          if (aTracks.length > 0) {
            setAudioTracks(
              aTracks.map((t, i) => ({
                id: i,
                name: t.name || t.lang || `Audio ${i + 1}`,
                lang: t.lang
              }))
            )
          }

          // Subtitle tracks from HLS manifest
          const sTracks = hls.subtitleTracks || []
          if (sTracks.length > 0) {
            setSubtitleTracks(
              sTracks.map((t, i) => ({
                id: i,
                name: t.name || t.lang || `Subtitle ${i + 1}`,
                lang: t.lang,
                type: 'embedded' as const
              }))
            )
          }
        })

        // Listen for subtitle track changes to detect new tracks
        hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => {
          const sTracks = hls.subtitleTracks || []
          if (sTracks.length > 0) {
            setSubtitleTracks(
              sTracks.map((t, i) => ({
                id: i,
                name: t.name || t.lang || `Subtitle ${i + 1}`,
                lang: t.lang,
                type: 'embedded' as const
              }))
            )
          }
        })

        // Capture subtitle cues from HLS.js
        hls.on(Hls.Events.SUBTITLE_FRAG_PROCESSED, () => {
          // Cues come through the video's text tracks
          extractTextTrackCues(video)
        })

        let retryCount = 0
        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) {
            if (retryCount >= 3) {
              setPlayerError(`Playback failed: ${data.details}`)
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
                setPlayerError(`Playback error: ${data.details}`)
                break
            }
          }
        })

        hlsRef.current = hls
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = url
        video.play().catch(() => {})
      }
    } else {
      // Direct playback (mp4, mkv, etc)
      video.src = url
      video.play().catch(() => {})

      // For direct playback, check for embedded text tracks after metadata loads
      video.addEventListener('loadedmetadata', () => {
        extractNativeTextTracks(video)
      }, { once: true })
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy()
        hlsRef.current = null
      }
    }
  }, [currentChannel, videoRef, setAudioTracks, setSubtitleTracks, setPlayerError])

  // Extract text tracks from native <video> element
  function extractNativeTextTracks(video: HTMLVideoElement) {
    const tracks = video.textTracks
    if (!tracks || tracks.length === 0) return

    const subTracks = Array.from(tracks)
      .filter(t => t.kind === 'subtitles' || t.kind === 'captions')
      .map((t, i) => ({
        id: i,
        name: t.label || t.language || `Subtitle ${i + 1}`,
        lang: t.language || undefined,
        type: 'embedded' as const
      }))

    if (subTracks.length > 0) {
      setSubtitleTracks(subTracks)
    }
  }

  // Extract cues from video text tracks (for HLS embedded subs)
  function extractTextTrackCues(video: HTMLVideoElement) {
    const tracks = video.textTracks
    if (!tracks) return

    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i]
      if (track.mode === 'hidden' || track.mode === 'showing') {
        track.oncuechange = () => {
          if (!track.activeCues) return
          const cues = Array.from(track.activeCues).map((cue: any) => ({
            startTime: cue.startTime,
            endTime: cue.endTime,
            text: cue.text || ''
          }))
          setActiveSubtitleCues(cues)
        }
      }
    }
  }

  // Volume sync
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.volume = volume
    video.muted = isMuted
  }, [volume, isMuted, videoRef])

  // Audio track switching
  useEffect(() => {
    if (hlsRef.current && currentAudioTrack >= 0) {
      hlsRef.current.audioTrack = currentAudioTrack
    }
  }, [currentAudioTrack])

  // Subtitle track switching via HLS.js
  useEffect(() => {
    if (!hlsRef.current) return
    const video = videoRef.current
    if (!video) return

    if (currentSubtitleTrack === null || currentSubtitleTrack === 'external') {
      // Turn off HLS subtitle track
      hlsRef.current.subtitleTrack = -1
      // Disable all native text tracks
      for (let i = 0; i < video.textTracks.length; i++) {
        video.textTracks[i].mode = 'disabled'
      }
      return
    }

    const trackId = parseInt(currentSubtitleTrack)
    if (!isNaN(trackId)) {
      hlsRef.current.subtitleTrack = trackId
      // Enable the matching text track
      for (let i = 0; i < video.textTracks.length; i++) {
        video.textTracks[i].mode = i === trackId ? 'hidden' : 'disabled'
      }
    }
  }, [currentSubtitleTrack, videoRef])

  // Video events
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const onPlay = () => { setPlaying(true); setPaused(false) }
    const onPause = () => setPaused(true)
    const onWaiting = () => setBuffering(true)
    const onPlaying = () => setBuffering(false)
    const onTimeUpdate = () => setCurrentTime(video.currentTime)
    const onDurationChange = () => setDuration(video.duration)
    const onError = () => setPlayerError(video.error?.message || 'Playback error')

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
  }, [videoRef, setPlaying, setPaused, setBuffering, setCurrentTime, setDuration, setPlayerError])

  // External subtitle cue matching (SRT/VTT/ASS loaded from file)
  useEffect(() => {
    if (currentSubtitleTrack !== 'external' || subtitleCues.length === 0) {
      if (currentSubtitleTrack !== 'external') setActiveSubtitleCues([])
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
  }, [currentSubtitleTrack, subtitleCues, videoRef, setActiveSubtitleCues])
}
