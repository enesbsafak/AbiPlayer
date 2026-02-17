declare global {
  interface Window {
    electron?: {
      openFileDialog: (filters?: { name: string; extensions: string[] }[]) => Promise<string | null>
      readFile: (filePath: string) => Promise<string | null>
      windowMinimize: () => Promise<void>
      windowMaximize: () => Promise<void>
      windowClose: () => Promise<void>
      windowIsMaximized: () => Promise<boolean>
    }
  }
}

export {}
