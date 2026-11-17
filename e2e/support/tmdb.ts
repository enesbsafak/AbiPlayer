// The fake TMDB (mock-provider/tmdb.ts) put in front of the renderer: every
// request to TMDB's API and image hosts is answered by Playwright's request
// routing, so a scenario never reaches the real TMDB. Nothing in the app
// changes for it; outside these scenarios there is no route.

import type { Page } from '@playwright/test'
import { answerTmdb, answerTmdbImage, type TmdbAnswer } from '../mock-provider/tmdb.ts'

export interface MockTmdbRequest {
  /** The path without `/3`, e.g. `/movie/popular`. */
  path: string
  query: Record<string, string>
  status: number
}

export interface MockTmdb {
  requests(): MockTmdbRequest[]
  /** Pages asked of a list path, in order. */
  pagesAsked(path: string): number[]
}

function fulfil(answer: TmdbAnswer) {
  return {
    status: answer.status,
    contentType: answer.contentType,
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: answer.body
  }
}

export async function routeMockTmdb(page: Page): Promise<MockTmdb> {
  const log: MockTmdbRequest[] = []
  await page.route('https://api.themoviedb.org/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'OPTIONS') {
      await route.fulfill({
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS'
        }
      })
      return
    }
    const answer = answerTmdb(url, (await request.allHeaders())['authorization'] ?? null)
    const query = Object.fromEntries(url.searchParams)
    // The key is not kept in the log.
    delete query['api_key']
    log.push({ path: url.pathname.replace(/^\/3/, ''), query, status: answer.status })
    await route.fulfill(fulfil(answer))
  })
  await page.route('https://image.tmdb.org/**', async (route) => {
    await route.fulfill(fulfil(answerTmdbImage(new URL(route.request().url()))))
  })
  return {
    requests: () => [...log],
    pagesAsked: (path) => log.filter((entry) => entry.path === path).map((entry) => Number(entry.query['page'] ?? '1'))
  }
}
