import type { IpcRegistrar } from './register'
import { isValidMediaJobId, parseMediaJobOptions, type MediaService } from './media-jobs'
import { isValidStreamIndex, isValidStreamUrl } from './validators'

/** Jobs are owned per renderer so one window cannot cancel another's. */
export function mediaJobOwner(sender: { id: number }): string {
  return `webContents:${sender.id}`
}

export function registerMediaHandlers(registrar: IpcRegistrar, media: MediaService): void {
  registrar.handle('embedded-subtitles-probe', async (event, streamUrl, options) => {
    if (!isValidStreamUrl(streamUrl)) throw new Error('Geçersiz yayın URL')
    return media.probe(mediaJobOwner(event.sender), streamUrl, parseMediaJobOptions(options))
  })

  registrar.handle('embedded-subtitles-extract', async (event, streamUrl, streamIndex, options) => {
    if (!isValidStreamUrl(streamUrl)) throw new Error('Geçersiz yayın URL')
    if (!isValidStreamIndex(streamIndex)) throw new Error('Geçersiz altyazı akış indeksi')
    return media.extract(mediaJobOwner(event.sender), streamUrl, streamIndex, parseMediaJobOptions(options))
  })

  registrar.handle('media-job-cancel', (event, jobId) => {
    if (jobId !== undefined && jobId !== null && !isValidMediaJobId(jobId)) {
      throw new Error('Geçersiz medya işi kimliği')
    }
    return media.cancel(mediaJobOwner(event.sender), typeof jobId === 'string' ? jobId : undefined)
  })
}
