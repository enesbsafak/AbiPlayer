import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/services/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/platform')>()
  return {
    ...actual,
    probeEmbeddedSubtitles: vi.fn(),
    extractEmbeddedSubtitle: vi.fn(),
    cancelMediaJob: vi.fn(() => Promise.resolve(true))
  }
})

import { cancelMediaJob, extractEmbeddedSubtitle, probeEmbeddedSubtitles } from '@/services/platform'
import { MEDIA_JOB_CANCELLED_MESSAGE } from '../../../shared/ipc/contract'
import {
  EXTRACT_JOB_TIMEOUT_MS,
  PROBE_JOB_TIMEOUT_MS,
  createMediaJobId,
  createMediaJobScope,
  isMediaJobCancelledError
} from './media-jobs'

describe('createMediaJobId', () => {
  it('makes distinct ids main accepts', () => {
    const ids = [createMediaJobId('probe'), createMediaJobId('extract'), createMediaJobId('probe')]
    expect(new Set(ids).size).toBe(3)
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{1,128}$/)
  })
})

describe('createMediaJobScope', () => {
  beforeEach(() => {
    vi.mocked(probeEmbeddedSubtitles).mockReset()
    vi.mocked(extractEmbeddedSubtitle).mockReset()
  })

  it('passes a job id and a timeout to each job', async () => {
    vi.mocked(probeEmbeddedSubtitles).mockResolvedValue([])
    vi.mocked(extractEmbeddedSubtitle).mockResolvedValue(null)
    const scope = createMediaJobScope()

    await scope.probe('https://e.com/f.mkv')
    await scope.extract('https://e.com/f.mkv', 2)

    expect(vi.mocked(probeEmbeddedSubtitles)).toHaveBeenCalledWith('https://e.com/f.mkv', {
      jobId: expect.stringMatching(/^probe-/),
      timeoutMs: PROBE_JOB_TIMEOUT_MS
    })
    expect(vi.mocked(extractEmbeddedSubtitle)).toHaveBeenCalledWith('https://e.com/f.mkv', 2, {
      jobId: expect.stringMatching(/^extract-/),
      timeoutMs: EXTRACT_JOB_TIMEOUT_MS
    })
  })

  it('cancels the jobs still running, by id, and starts nothing afterwards', async () => {
    vi.mocked(probeEmbeddedSubtitles).mockReturnValue(new Promise(() => undefined))
    const scope = createMediaJobScope()
    void scope.probe('https://e.com/f.mkv')
    const jobId = vi.mocked(probeEmbeddedSubtitles).mock.calls[0][1]?.jobId

    scope.cancel()
    expect(vi.mocked(cancelMediaJob)).toHaveBeenCalledWith(jobId)

    const late = scope.extract('https://e.com/f.mkv', 1)
    await expect(late).rejects.toThrow(MEDIA_JOB_CANCELLED_MESSAGE)
    await late.catch((error: unknown) => expect(isMediaJobCancelledError(error)).toBe(true))
    expect(vi.mocked(extractEmbeddedSubtitle)).not.toHaveBeenCalled()
  })

  it('does not cancel a job that already finished', async () => {
    vi.mocked(probeEmbeddedSubtitles).mockResolvedValue([])
    const scope = createMediaJobScope()
    await scope.probe('https://e.com/f.mkv')
    scope.cancel()
    expect(vi.mocked(cancelMediaJob)).not.toHaveBeenCalled()
  })
})
