import { useEffect, useMemo, useRef, useState } from 'react'
import { ImageOff } from 'lucide-react'

interface LazyImageProps {
  src?: string
  alt: string
  className?: string
  fallbackClassName?: string
  fit?: 'cover' | 'contain'
  eager?: boolean
}

type ImageStatus = 'idle' | 'loading' | 'loaded' | 'error'

type CachedImageStatus = {
  status: Exclude<ImageStatus, 'idle' | 'loading'>
  expiresAt: number | null
}

const imageStatusCache = new Map<string, CachedImageStatus>()
const IMAGE_LOAD_TIMEOUT_MS = 10000
const IMAGE_ERROR_CACHE_TTL_MS = 45_000
const MAX_RETRY_COUNT = 2

function getCachedImageStatus(src?: string): Exclude<ImageStatus, 'idle' | 'loading'> | undefined {
  if (!src) return undefined

  const cached = imageStatusCache.get(src)
  if (!cached) return undefined

  if (cached.expiresAt !== null && cached.expiresAt <= Date.now()) {
    imageStatusCache.delete(src)
    return undefined
  }

  return cached.status
}

function setCachedImageStatus(
  src: string,
  status: Exclude<ImageStatus, 'idle' | 'loading'>
): void {
  imageStatusCache.set(src, {
    status,
    expiresAt: status === 'loaded' ? null : Date.now() + IMAGE_ERROR_CACHE_TTL_MS
  })
}

function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let current = el?.parentElement ?? null
  while (current) {
    const style = window.getComputedStyle(current)
    const overflowY = style.overflowY || style.overflow
    if (overflowY.includes('auto') || overflowY.includes('scroll')) return current
    current = current.parentElement
  }
  return null
}

function withCacheBust(src: string, attempt: number): string {
  const separator = src.includes('?') ? '&' : '?'
  return `${src}${separator}cb=${Date.now()}_${attempt}`
}

function normalizeImageSrc(src?: string): string | undefined {
  const trimmed = src?.trim()
  if (!trimmed) return undefined

  const normalized = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed
  const fixedSlashes = normalized.replace(/\\/g, '/')

  try {
    return encodeURI(fixedSlashes)
  } catch {
    return fixedSlashes
  }
}

export function LazyImage({
  src,
  alt,
  className = '',
  fallbackClassName = '',
  fit = 'cover',
  eager = false
}: LazyImageProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const normalizedSrc = useMemo(() => normalizeImageSrc(src), [src])
  const cachedStatus = getCachedImageStatus(normalizedSrc)
  const [isVisible, setIsVisible] = useState(() => eager || Boolean(cachedStatus))
  const [retryAttempt, setRetryAttempt] = useState(0)
  const [status, setStatus] = useState<ImageStatus>(() => {
    if (!normalizedSrc) return 'error'
    if (cachedStatus === 'loaded') return 'loaded'
    if (cachedStatus === 'error') return 'error'
    return 'idle'
  })

  useEffect(() => {
    const cached = getCachedImageStatus(normalizedSrc)
    if (!normalizedSrc) {
      setStatus('error')
      setIsVisible(false)
      return
    }

    if (cached === 'loaded') {
      setStatus('loaded')
      setIsVisible(true)
      return
    }

    if (cached === 'error') {
      setStatus('error')
      setIsVisible(true)
      return
    }

    setStatus('idle')
    setRetryAttempt(0)
    setIsVisible(eager)
  }, [normalizedSrc, eager])

  useEffect(() => {
    if (!normalizedSrc || eager || isVisible || typeof IntersectionObserver === 'undefined') {
      if (!isVisible && normalizedSrc) setIsVisible(true)
      return
    }

    const element = wrapperRef.current
    if (!element) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setIsVisible(true)
          observer.disconnect()
        }
      },
      {
        root: findScrollParent(element),
        rootMargin: '720px 0px',
        threshold: 0.01
      }
    )

    observer.observe(element)
    return () => observer.disconnect()
  }, [normalizedSrc, eager, isVisible])

  useEffect(() => {
    if (!normalizedSrc || !isVisible || status !== 'idle') return
    setStatus('loading')
  }, [normalizedSrc, isVisible, status])

  useEffect(() => {
    if (!normalizedSrc || status !== 'loading') return
    const timer = window.setTimeout(() => {
      if (retryAttempt < MAX_RETRY_COUNT) {
        setRetryAttempt((current) => current + 1)
        return
      }

      setCachedImageStatus(normalizedSrc, 'error')
      setStatus('error')
    }, IMAGE_LOAD_TIMEOUT_MS)

    return () => window.clearTimeout(timer)
  }, [normalizedSrc, status, retryAttempt])

  const imageSrc = useMemo(() => {
    if (!normalizedSrc) return ''
    if (retryAttempt === 0) return normalizedSrc
    return withCacheBust(normalizedSrc, retryAttempt)
  }, [normalizedSrc, retryAttempt])

  const handleLoad = () => {
    if (!normalizedSrc) return
    setCachedImageStatus(normalizedSrc, 'loaded')
    setStatus('loaded')
  }

  const handleError = () => {
    if (!normalizedSrc) return
    if (retryAttempt < MAX_RETRY_COUNT) {
      setRetryAttempt((current) => current + 1)
      return
    }

    setCachedImageStatus(normalizedSrc, 'error')
    setStatus('error')
  }

  if (!normalizedSrc || status === 'error') {
    return (
      <div className={`flex items-center justify-center bg-surface-800 ${fallbackClassName || className}`}>
        <ImageOff size={24} className="text-surface-500" />
      </div>
    )
  }

  return (
    <div ref={wrapperRef} className={`relative overflow-hidden ${className}`}>
      {status !== 'loaded' && (
        <div className="poster-shimmer absolute inset-0 bg-surface-800" />
      )}
      {isVisible && (
        <img
          key={imageSrc}
          src={imageSrc}
          alt={alt}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          fetchPriority={eager ? 'high' : 'auto'}
          draggable={false}
          onLoad={handleLoad}
          onError={handleError}
          className={`h-full w-full transition-all duration-500 ${
            fit === 'contain' ? 'object-contain' : 'object-cover'
          } ${status === 'loaded' ? 'scale-100 opacity-100' : 'scale-[1.02] opacity-0'}`}
        />
      )}
    </div>
  )
}
