import type { IpcRegistrar } from './register'
import { isValidMediaJobId, parseMediaJobOptions, type MediaService } from './media-jobs'
import { isValidStreamIndex, isValidStreamUrl } from './validators'
import { mainStrings } from '../../shared/main-strings'

/** Jobs are owned per renderer so one window cannot cancel another's. */
export function mediaJobOwner(sender: { id: number }): string {
  return `webContents:${sender.id}`
}

export function registerMediaHandlers(registrar: IpcRegistrar, media: MediaService): void {
  registrar.handle('embedded-subtitles-probe', async (event, streamUrl, options) => {
    if (!isValidStreamUrl(streamUrl)) throw new Error(mainStrings.invalid.streamUrl)
    return media.probe(mediaJobOwner(event.sender), streamUrl, parseMediaJobOptions(options))
  })

  registrar.handle('embedded-subtitles-extract', async (event, streamUrl, streamIndex, options) => {
    if (!isValidStreamUrl(streamUrl)) throw new Error(mainStrings.invalid.streamUrl)
    if (!isValidStreamIndex(streamIndex)) throw new Error(mainStrings.invalid.subtitleStreamIndex)
    return media.extract(mediaJobOwner(event.sender), streamUrl, streamIndex, parseMediaJobOptions(options))
  })

  registrar.handle('media-job-cancel', (event, jobId) => {
    if (jobId !== undefined && jobId !== null && !isValidMediaJobId(jobId)) {
      throw new Error(mainStrings.invalid.mediaJobId)
    }
    return media.cancel(mediaJobOwner(event.sender), typeof jobId === 'string' ? jobId : undefined)
  })
}
