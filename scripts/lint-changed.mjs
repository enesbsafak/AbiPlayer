#!/usr/bin/env node

// Dokunulan dosyada sıfır ihlal (F0-02): verilen tabana göre değişen dosyaları
// uyarı dahil hiçbir ihlale izin vermeden denetler.
//
//   npm run lint:changed               # taban: origin/main
//   npm run lint:changed -- <ref>      # başka bir taban

import { spawnSync } from 'child_process'
import { existsSync } from 'fs'

const LINTABLE = /^(src|scripts|e2e)\/.+\.(ts|tsx|mjs)$/

const base = process.argv[2] || 'origin/main'

const diff = spawnSync('git', ['diff', '--name-only', '--diff-filter=ACMR', `${base}...HEAD`], {
  encoding: 'utf8'
})
if (diff.status !== 0) {
  console.error(`[lint-changed] git diff başarısız: ${diff.stderr.trim()}`)
  process.exit(1)
}

const files = diff.stdout
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((file) => LINTABLE.test(file) && !file.endsWith('.d.ts') && existsSync(file))

if (files.length === 0) {
  console.log(`[lint-changed] ${base} tabanına göre denetlenecek dosya yok.`)
  process.exit(0)
}

console.log(`[lint-changed] ${files.length} dosya denetleniyor (taban: ${base}).`)
const eslint = spawnSync('npx', ['eslint', '--max-warnings', '0', ...files], {
  stdio: 'inherit',
  shell: process.platform === 'win32'
})
process.exit(eslint.status ?? 1)
