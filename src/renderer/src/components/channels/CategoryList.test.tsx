import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useStore } from '@/store'
import { catalog, categoryToRecord } from '@/catalog'
import { settingsTabLabel } from '@/components/settings/SettingsPage'
import { CategoryList } from './CategoryList'

afterEach(() => {
  cleanup()
  catalog.reset()
  useStore.setState({ hiddenCategoryIds: new Set() })
})

describe('CategoryList', () => {
  it('sends the user to the settings tab that really lists hidden categories (K9)', () => {
    catalog.commit({
      token: catalog.beginGeneration('s1', 'live'),
      mode: 'partial',
      categories: [
        categoryToRecord({ id: 's1_live_1', name: 'Haber', sourceId: 's1', type: 'live' }),
        categoryToRecord({ id: 's1_live_2', name: 'Spor', sourceId: 's1', type: 'live' })
      ]
    })
    useStore.setState({ hiddenCategoryIds: new Set(['s1_live_2']) })

    render(<CategoryList type="live" sourceId="s1" selectedCategoryId={null} onSelect={() => undefined} allLabel="Tüm Kanallar" />)

    expect(screen.getByText(`1 kategori gizli. Ayarlar → ${settingsTabLabel('catalog')} bölümünden geri getirebilirsin.`)).toBeTruthy()
  })
})
