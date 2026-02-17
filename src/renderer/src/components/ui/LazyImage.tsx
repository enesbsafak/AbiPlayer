import { useState, useRef, useEffect } from 'react'
import { ImageOff } from 'lucide-react'

interface LazyImageProps {
  src?: string
  alt: string
  className?: string
  fallbackClassName?: string
}

export function LazyImage({ src, alt, className = '', fallbackClassName = '' }: LazyImageProps) {
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    setLoaded(false)
    setError(false)
  }, [src])

  if (!src || error) {
    return (
      <div className={`flex items-center justify-center bg-surface-800 ${fallbackClassName || className}`}>
        <ImageOff size={24} className="text-surface-600" />
      </div>
    )
  }

  return (
    <>
      {!loaded && (
        <div className={`animate-pulse bg-surface-800 ${className}`} />
      )}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
        className={`${className} ${loaded ? '' : 'hidden'}`}
      />
    </>
  )
}
