const MASK = '***'

// Xtream stream URLs carry the account in the path:
//   http://host/live/<user>/<pass>/123.ts, /movie/…, /series/…, /timeshift/…
const XTREAM_PATH_PATTERN = /\/(live|movie|series|timeshift)\/([^/\s?#"']+)\/([^/\s?#"']+)\//gi
// player_api.php, get.php and xmltv.php take them as query parameters.
const QUERY_PATTERN = /([?&](?:username|password)=)[^&#\s"']*/gi
// http://user:pass@host/…
const USERINFO_PATTERN = /(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s@"']+@/gi

/**
 * Replaces account names and passwords embedded in stream and API URLs with
 * `***`. Used on every error message and log line that leaves the main
 * process: ffmpeg/ffprobe print the full input URL in their errors, and those
 * end up in renderer consoles and bug reports.
 */
export function maskCredentials(text: string): string {
  if (!text) return text
  return text
    .replace(XTREAM_PATH_PATTERN, `/$1/${MASK}/${MASK}/`)
    .replace(QUERY_PATTERN, `$1${MASK}`)
    .replace(USERINFO_PATTERN, `$1${MASK}@`)
}
