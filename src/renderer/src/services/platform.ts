export function isElectron(): boolean {
  return typeof window !== 'undefined' && !!window.electron
}

export async function openFileDialog(
  filters?: { name: string; extensions: string[] }[]
): Promise<string | null> {
  if (!isElectron()) return null
  return window.electron!.openFileDialog(filters)
}

export async function readLocalFile(filePath: string): Promise<string | null> {
  if (!isElectron()) return null
  return window.electron!.readFile(filePath)
}

export async function pickAndReadFile(
  filters?: { name: string; extensions: string[] }[]
): Promise<{ path: string; content: string } | null> {
  const path = await openFileDialog(filters)
  if (!path) return null
  const content = await readLocalFile(path)
  if (!content) return null
  return { path, content }
}

export function windowMinimize(): void {
  if (isElectron()) window.electron!.windowMinimize()
}

export function windowMaximize(): void {
  if (isElectron()) window.electron!.windowMaximize()
}

export function windowClose(): void {
  if (isElectron()) window.electron!.windowClose()
}
