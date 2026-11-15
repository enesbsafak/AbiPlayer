declare const __APP_VERSION__: string

/** Vite asset import that is always emitted as a file, never inlined. */
declare module '*.svg?no-inline' {
  const url: string
  export default url
}
