import { useState } from 'react'
import { ListVideo, Puzzle, Server, type LucideIcon } from 'lucide-react'
import { SettingsGroup } from '@/components/settings/controls'
import { PendingSourceCapture } from '@/components/security/PendingSourceCapture'
import { useStore } from '@/store'
import { strings } from '@/strings'
import { ADDON_URL_FIELD_ID, AddonForm } from './AddonForm'
import { LoginForm } from './LoginForm'
import { PlaylistImport } from './PlaylistImport'

const text = strings.sources.add

type Kind = 'xtream' | 'm3u' | 'addon'

interface ChoiceTileProps {
  title: string
  hint: string
  icon: LucideIcon
  selected: boolean
  onSelect: () => void
}

/** A large choice: filled with sky and ink text when chosen. */
function ChoiceTile({ title, hint, icon: Icon, selected, onSelect }: ChoiceTileProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`flex min-h-[84px] min-w-0 items-center gap-4 rounded-card py-4 pl-4 pr-5 text-left transition-colors ${
        selected ? 'bg-sky text-ink' : 'bg-ground text-white hover:bg-surface-800'
      }`}
    >
      <span
        aria-hidden="true"
        className={`flex size-12 shrink-0 items-center justify-center rounded-[14px] ${selected ? 'bg-ink text-sky' : 'bg-raised text-white'}`}
      >
        <Icon size={24} aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="font-title block text-[22px] leading-[1.15]">{title}</span>
        <span className={`mt-1 block text-[15px] ${selected ? 'font-medium text-ink/80' : 'text-surface-400'}`}>{hint}</span>
      </span>
    </button>
  )
}

/**
 * Adding a source as one guided step: say which kind of account you have,
 * then fill in only what that kind needs. The first source of a new user is
 * added here too (the home welcome sends them to this tab). An add-on is a
 * third choice while the experimental setting is on.
 */
export function AddSource({ first, subdued = false }: { first: boolean; subdued?: boolean }) {
  const [chosen, setKind] = useState<Kind>('xtream')
  const addonsEnabled = useStore((s) => s.settings.addonSourcesEnabled)
  // Turning the setting off while the add-on form is open goes back to the first choice.
  const kind: Kind = chosen === 'addon' && !addonsEnabled ? 'xtream' : chosen

  return (
    <SettingsGroup title={first ? text.firstTitle : text.title}>
      <div className="flex min-w-0 flex-col gap-6 rounded-tile bg-raised p-6 short:gap-5 short:p-5">
        {first && <p className="max-w-[60ch] text-base text-surface-300">{text.firstIntro}</p>}
        <div className="flex flex-col gap-3">
          <p className="text-[15px] font-bold text-white">{text.choiceLabel}</p>
          <div
            className={`grid gap-3 ${addonsEnabled ? 'sm:grid-cols-[repeat(auto-fit,minmax(240px,1fr))]' : 'sm:grid-cols-2'}`}
          >
            <ChoiceTile
              title={text.xtreamChoice}
              hint={text.xtreamChoiceHint}
              icon={Server}
              selected={kind === 'xtream'}
              onSelect={() => setKind('xtream')}
            />
            <ChoiceTile
              title={text.m3uChoice}
              hint={text.m3uChoiceHint}
              icon={ListVideo}
              selected={kind === 'm3u'}
              onSelect={() => setKind('m3u')}
            />
            {addonsEnabled && (
              <ChoiceTile
                title={text.addonChoice}
                hint={text.addonChoiceHint}
                icon={Puzzle}
                selected={kind === 'addon'}
                onSelect={() => setKind('addon')}
              />
            )}
          </div>
        </div>

        {kind === 'xtream' && (
          <PendingSourceCapture urlFieldId="xtream-url">
            <LoginForm subdued={subdued} />
          </PendingSourceCapture>
        )}
        {kind === 'm3u' && (
          <PendingSourceCapture urlFieldId="m3u-url">
            <PlaylistImport subdued={subdued} />
          </PendingSourceCapture>
        )}
        {kind === 'addon' && (
          <PendingSourceCapture urlFieldId={ADDON_URL_FIELD_ID}>
            <AddonForm subdued={subdued} />
          </PendingSourceCapture>
        )}
      </div>
    </SettingsGroup>
  )
}
