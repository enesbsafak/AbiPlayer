import { execFile } from 'node:child_process'
import { test, expect } from '../support/fixtures.ts'
import { addXtreamSource, expectHomeWithContent } from '../support/flows.ts'

// Plan F1-39, renderer half and the double click on the bar.
//
// Nothing here may really maximize the window: a maximized window leaves its
// off-screen spot and lands on the owner's display. So the window's maximize
// and unmaximize are replaced in main by stand-ins that only flip a flag and
// raise the same events Electron raises, and the window is made
// non-maximizable for Windows itself while the native message is sent.

const WM_NCLBUTTONDBLCLK = 0x00a3
const HTCAPTION = 2
const HTCLIENT = 1

/** Sends a window message to `hwnd` the way Windows would deliver it (SendMessage). */
function sendWindowMessage(hwnd: string, message: number, wParam: number): Promise<void> {
  const script = [
    'Add-Type -Namespace AbiE2e -Name User32 -MemberDefinition \'[DllImport("user32.dll")] public static extern System.IntPtr SendMessage(System.IntPtr hWnd, uint Msg, System.IntPtr wParam, System.IntPtr lParam);\'',
    `[void][AbiE2e.User32]::SendMessage([System.IntPtr]${Number(hwnd)}, ${message}, [System.IntPtr]${wParam}, [System.IntPtr]0)`
  ].join('; ')
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 30_000 }, (error) =>
      error ? reject(error) : resolve()
    )
  })
}

test.describe('başlık çubuğu ve pencere durumu (F1-39)', () => {
  test.skip(process.platform !== 'win32', 'Windows window messages')

  test('büyüt düğmesi pencerenin durumunu gösterir; çubuğa çift tık main sürecinde büyütür ve geri alır', async ({ launch, mock }) => {
    const app = await launch()
    const { page } = app
    await addXtreamSource(page, mock)
    await expectHomeWithContent(page)

    const hwnd = await app.electron.evaluate(({ BrowserWindow }) => {
      const [window] = BrowserWindow.getAllWindows()
      if (!window) throw new Error('the app has no window')
      let maximized = false
      const record = { maximizeCalls: 0, unmaximizeCalls: 0 }
      ;(globalThis as Record<string, unknown>).__abiTitleBarProbe = record
      // Windows itself must not maximize the window either (see above).
      window.setMaximizable(false)
      window.isMaximized = () => maximized
      window.maximize = () => {
        record.maximizeCalls += 1
        maximized = true
        window.emit('maximize')
      }
      window.unmaximize = () => {
        record.unmaximizeCalls += 1
        maximized = false
        window.emit('unmaximize')
      }
      const handle = window.getNativeWindowHandle()
      return (handle.length >= 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0))).toString()
    })
    const probe = () =>
      app.electron.evaluate(() => (globalThis as Record<string, unknown>).__abiTitleBarProbe as { maximizeCalls: number; unmaximizeCalls: number })

    const restored = page.getByRole('button', { name: 'Pencereyi büyüt', exact: true })
    const maximized = page.getByRole('button', { name: 'Pencereyi önceki boyutuna getir', exact: true })
    await expect(restored).toBeVisible()

    // The button: state comes back from main through the window-state event.
    await restored.click()
    await expect(maximized).toBeVisible()
    await expect(maximized).toHaveAttribute('aria-pressed', 'true')
    await maximized.click()
    await expect(restored).toBeVisible()
    await app.shot('after-button')

    // A real non-client double click on the caption, as Windows sends it for
    // the drag region: main toggles the window, the bar follows.
    await sendWindowMessage(hwnd, WM_NCLBUTTONDBLCLK, HTCAPTION)
    await expect(maximized).toBeVisible()
    expect(await probe()).toEqual({ maximizeCalls: 2, unmaximizeCalls: 1 })
    await sendWindowMessage(hwnd, WM_NCLBUTTONDBLCLK, HTCAPTION)
    await expect(restored).toBeVisible()

    // Anywhere else on the frame is not a title bar double click.
    await sendWindowMessage(hwnd, WM_NCLBUTTONDBLCLK, HTCLIENT)
    await page.waitForTimeout(500)
    expect(await probe()).toEqual({ maximizeCalls: 2, unmaximizeCalls: 2 })
    await expect(restored).toBeVisible()

    // Still where test mode put it: off every display.
    expect((await app.windowPlacement()).onAnyDisplay).toBe(false)
  })
})
