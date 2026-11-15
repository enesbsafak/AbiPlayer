import { afterEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { LazyImage } from '@/components/ui/LazyImage'
import { normalizeImageSrc } from './image-url'
import { findScrollRoot } from './scroll-root'

describe('normalizeImageSrc', () => {
  it('does not double-encode an already percent-encoded URL', () => {
    // encodeURI used to turn %20 into %2520, which 404s.
    expect(normalizeImageSrc('https://img.example/posters/Film%20Adi.jpg')).toBe(
      'https://img.example/posters/Film%20Adi.jpg'
    )
    expect(normalizeImageSrc('https://img.example/a%2Fb.jpg?x=%C3%A7')).toBe('https://img.example/a%2Fb.jpg?x=%C3%A7')
  })

  it('repairs raw spaces and Turkish letters', () => {
    expect(normalizeImageSrc('https://img.example/posters/Film Adı.jpg')).toBe(
      'https://img.example/posters/Film%20Ad%C4%B1.jpg'
    )
  })

  it('adds a protocol to protocol-relative URLs and fixes backslashes', () => {
    expect(normalizeImageSrc('//img.example/a.jpg')).toBe('https://img.example/a.jpg')
    expect(normalizeImageSrc('http://img.example\\posters\\a.jpg')).toBe('http://img.example/posters/a.jpg')
  })

  it('encodes only text that does not parse as a URL', () => {
    expect(normalizeImageSrc('posters/Film Adı.jpg')).toBe('posters/Film%20Ad%C4%B1.jpg')
  })

  it('returns undefined for empty input', () => {
    expect(normalizeImageSrc('')).toBeUndefined()
    expect(normalizeImageSrc('   ')).toBeUndefined()
    expect(normalizeImageSrc(undefined)).toBeUndefined()
    expect(normalizeImageSrc(null)).toBeUndefined()
  })
})

describe('findScrollRoot', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('finds the nearest scrolling ancestor and reuses it for siblings', () => {
    document.body.innerHTML = `
      <div id="scroller" style="overflow-y: auto">
        <div id="grid">
          <div id="card-a"><span id="a"></span></div>
          <div id="card-b"><span id="b"></span></div>
        </div>
      </div>`
    const scroller = document.getElementById('scroller')

    expect(findScrollRoot(document.getElementById('a'))).toBe(scroller)
    expect(findScrollRoot(document.getElementById('b'))).toBe(scroller)
  })

  it('returns null when nothing above scrolls', () => {
    document.body.innerHTML = '<div><div><span id="x"></span></div></div>'
    expect(findScrollRoot(document.getElementById('x'))).toBeNull()
    expect(findScrollRoot(null)).toBeNull()
  })
})

describe('LazyImage retries', () => {
  afterEach(() => {
    cleanup()
  })

  it('retries with the same URL instead of a cache-busting one', () => {
    const src = 'https://img.example/retry%20poster.jpg'
    const { container } = render(createElement(LazyImage, { src, alt: 'Afiş', eager: true }))

    const first = container.querySelector('img')
    expect(first?.getAttribute('src')).toBe(src)
    fireEvent.error(first!)

    const second = container.querySelector('img')
    expect(second).not.toBe(first)
    expect(second?.getAttribute('src')).toBe(src)
  })
})
