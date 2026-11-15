const MASK = '***'

// Xtream stream URLs carry the account in the path:
//   http://host/live/<user>/<pass>/123.ts, /movie/…, /series/…, /timeshift/…
const XTREAM_PATH_PATTERN = /\/(live|movie|series|timeshift)\/([^/\s?#"']+)\/([^/\s?#"']+)\//gi
// M3U exports of Xtream panels (get.php) list live streams without the type:
//   http://host:8080/<user>/<pass>/12345[.ts|.m3u8]
// A URL counts only when those three segments are its whole path and the last
// is a numeric stream id with no extension or a stream one, so ordinary URLs
// with two segments and a number inside a longer path, or with a page
// extension, are left alone. The optional dot before the end allows a URL that
// ends a sentence, as in ffmpeg's "Error opening input file <url>.".
const XTREAM_BARE_PATH_PATTERN =
  /(\bhttps?:\/\/[^/\s?#"'<>]+)\/[^/\s?#"'<>]+\/[^/\s?#"'<>]+\/(\d+(?:\.(?:ts|m3u8))?)(?=\.?(?:[\s?#:'"<>),;\]]|$))/gi
// player_api.php, get.php and xmltv.php take them as query parameters.
const QUERY_PATTERN = /([?&](?:username|password)=)[^&#\s"']*/gi
// http://user:pass@host/…
const USERINFO_PATTERN = /(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s@"']+@/gi

// Where a known secret may sit inside a URL: a path segment, a query value or
// userinfo. Bounding the match keeps a short account name from masking words.
const SECRET_BEFORE = '(?<=[/=:@])'
const SECRET_AFTER = `(?=[/?&#:@\\s"'<>),;]|$)`

/**
 * Replaces account names and passwords embedded in stream and API URLs with
 * `***`. Used on every error message and log line that leaves the main
 * process: ffmpeg/ffprobe print the full input URL in their errors, and those
 * end up in renderer consoles and bug reports.
 *
 * `knownSecrets` are values the caller knows to be credentials (see
 * `credentialsInUrl`); they are masked wherever they appear as a URL part,
 * whatever the URL looks like — a redirect target, a segment URL, an unknown
 * panel layout.
 */
export function maskCredentials(text: string, knownSecrets: readonly string[] = []): string {
  if (!text) return text
  let masked = text
    .replace(XTREAM_PATH_PATTERN, `/$1/${MASK}/${MASK}/`)
    .replace(XTREAM_BARE_PATH_PATTERN, `$1/${MASK}/${MASK}/$2`)
    .replace(QUERY_PATTERN, `$1${MASK}`)
    .replace(USERINFO_PATTERN, `$1${MASK}@`)
  for (const secret of knownSecrets) {
    if (!secret || secret === MASK) continue
    masked = masked.replace(new RegExp(`${SECRET_BEFORE}${escapeRegExp(secret)}${SECRET_AFTER}`, 'g'), MASK)
  }
  return masked
}

const TYPED_PATH_SECRETS = /^\/(?:live|movie|series|timeshift)\/([^/]+)\/([^/]+)\//i
const BARE_PATH_SECRETS = /^\/([^/]+)\/([^/]+)\/\d+(?:\.[A-Za-z0-9]+)?$/
const QUERY_SECRETS = /[?&](?:username|password)=([^&#]*)/gi
const USERINFO_SECRETS = /^[a-z][a-z0-9+.-]*:\/\/([^/?#@]+)@/i

/**
 * The account name and password carried by a stream or API URL, exactly as
 * they are written in it (still percent-encoded), for `maskCredentials`.
 * The caller knows `url` is a stream it is about to open, so a bare
 * `/<a>/<b>/<id>.<ext>` path counts with any extension.
 */
export function credentialsInUrl(url: string): string[] {
  const secrets = new Set<string>()
  const add = (value: string | undefined): void => {
    if (value && value !== MASK) secrets.add(value)
  }

  const userinfo = url.match(USERINFO_SECRETS)?.[1]
  if (userinfo) {
    const colon = userinfo.indexOf(':')
    add(colon < 0 ? userinfo : userinfo.slice(0, colon))
    if (colon >= 0) add(userinfo.slice(colon + 1))
  }

  for (const match of url.matchAll(QUERY_SECRETS)) add(match[1])

  const path = url.match(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*(\/[^?#]*)/i)?.[1]
  if (path) {
    const parts = path.match(TYPED_PATH_SECRETS) ?? path.match(BARE_PATH_SECRETS)
    if (parts) {
      add(parts[1])
      add(parts[2])
    }
  }

  return [...secrets]
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
