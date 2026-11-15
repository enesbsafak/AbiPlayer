import { writeFileSync } from 'fs'
import { app, type BrowserWindow, type LoadFileOptions } from 'electron'
import {
  PERF_ENV_VAR,
  PERF_GLOBAL_KEY,
  PERF_OUT_ENV_VAR,
  PERF_QUERY_PARAM,
  createPerfRecorder,
  isPerfFlag,
  perfOutputPath,
  type PerfDetail,
  type PerfTimeline
} from '../shared/perf'

// Node's performance clock starts at process start, which is exactly the
// origin the startup chain should be measured from.
const recorder = createPerfRecorder({
  process: 'main',
  enabled: isPerfFlag(process.env[PERF_ENV_VAR]),
  now: () => performance.now(),
  timeOrigin: performance.timeOrigin
})

export function perfMark(name: string, detail?: PerfDetail): void {
  recorder.mark(name, detail)
}

export function isPerfEnabled(): boolean {
  return recorder.enabled
}

export function getMainPerfTimeline(): PerfTimeline {
  return recorder.timeline()
}

/** Passes the switch on to the renderer, which cannot read the environment. */
export function perfLoadFileOptions(): LoadFileOptions | undefined {
  return recorder.enabled ? { query: { [PERF_QUERY_PARAM]: '1' } } : undefined
}

export function writeMainPerfTimeline(filePath: string): void {
  writeFileSync(filePath, JSON.stringify(recorder.timeline(), null, 2))
}

function watchWindow(window: BrowserWindow): void {
  const id = window.id
  perfMark('main:window-created', { window: id })
  window.once('ready-to-show', () => perfMark('main:ready-to-show', { window: id }))
  window.once('show', () => perfMark('main:window-shown', { window: id }))
  const contents = window.webContents
  contents.once('did-start-loading', () => perfMark('main:did-start-loading', { window: id }))
  contents.once('dom-ready', () => perfMark('main:dom-ready', { window: id }))
  contents.once('did-finish-load', () => perfMark('main:did-finish-load', { window: id }))
}

if (recorder.enabled) {
  // Imported first by index.ts, so this is effectively "top of index.ts".
  perfMark('main:perf-module-loaded')
  ;(globalThis as Record<string, unknown>)[PERF_GLOBAL_KEY] = { timeline: getMainPerfTimeline }

  app.on('browser-window-created', (_event, window) => watchWindow(window))
  app.once('will-quit', () => {
    const outPath = perfOutputPath(process.env[PERF_OUT_ENV_VAR], app.isPackaged)
    if (outPath) {
      try {
        writeMainPerfTimeline(outPath)
      } catch (error) {
        console.warn('[perf] could not write timeline:', error)
      }
    }
    console.table(recorder.summary())
  })
}
