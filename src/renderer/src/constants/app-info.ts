import { strings } from '@/strings'

export const APP_NAME = 'Abi Player'
export const APP_VERSION = __APP_VERSION__
export const APP_STAGE = strings.shell.app.stage
export const APP_VERSION_LABEL = `v${APP_VERSION} (${APP_STAGE})`

export const GITHUB_REPO = 'enesbsafak/AbiPlayer'
export const GITHUB_REPO_URL = `https://github.com/${GITHUB_REPO}`
export const GITHUB_RELEASES_URL = `${GITHUB_REPO_URL}/releases`

// Prefills the version so a report never arrives without it.
export const GITHUB_NEW_ISSUE_URL = `${GITHUB_REPO_URL}/issues/new?body=${encodeURIComponent(
  `\n\n---\n${strings.shell.app.versionLine(APP_VERSION)}`
)}`
