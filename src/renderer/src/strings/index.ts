import { catalog } from './catalog'
import { common } from './common'
import { epg } from './epg'
import { errors } from './errors'
import { player } from './player'
import { requests } from './requests'
import { security } from './security'
import { settings } from './settings'
import { shell } from './shell'
import { sources } from './sources'

/*
 * Every piece of interface text in the renderer's components and pages, in
 * Turkish. Plain typed objects: a use jumps to its definition in the editor,
 * and a missing or misspelt entry does not compile. Text with numbers or
 * names in it is a function. A second language would be another object of
 * type `Strings` and a way to choose between the two.
 *
 * Code that runs in the catalog worker imports the area it needs
 * (`@/strings/requests`) instead of this file, so the worker bundle does not
 * carry the whole dictionary.
 */
const tr = {
  common,
  errors,
  requests,
  shell,
  catalog,
  epg,
  player,
  sources,
  security,
  settings
}

export type Strings = typeof tr

export const strings: Strings = tr

export { formatCount, formatDateTime, LOCALE } from './common'
export { settingsPath, type SettingsTabKey } from './settings'
