// Prints the last e2e run from e2e/.output/results.json: status of every test,
// where each expected failure actually failed (so a known-bug test that broke
// for an unrelated reason is easy to spot), and the recorded observations.
//
//   node e2e/summary.ts

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { E2E_OUTPUT_DIR } from './support/paths.ts'

interface Annotation { type: string; description?: string }
interface Result { status: string; duration: number; errors?: { message?: string; location?: { file: string; line: number } }[] }
interface TestEntry { expectedStatus: string; status: string; annotations: Annotation[]; results: Result[] }
interface Spec { title: string; file: string; line: number; tests: TestEntry[] }
interface Suite { title: string; specs?: Spec[]; suites?: Suite[] }

const report = JSON.parse(readFileSync(join(E2E_OUTPUT_DIR, 'results.json'), 'utf8')) as { suites: Suite[] }

function* specs(suites: Suite[]): Generator<Spec> {
  for (const suite of suites) {
    yield* suite.specs ?? []
    yield* specs(suite.suites ?? [])
  }
}


for (const spec of specs(report.suites)) {
  for (const entry of spec.tests) {
    const result = entry.results.at(-1)
    const label = entry.expectedStatus === 'failed' ? 'expected failure' : entry.status
    console.log(`${label.padEnd(17)} ${spec.file}:${spec.line} ${spec.title} (${Math.round((result?.duration ?? 0) / 1000)} s)`)
    for (const annotation of entry.annotations) {
      if (annotation.type === 'fail' || annotation.type === 'observation' || annotation.type === 'stray-processes') {
        console.log(`    ${annotation.type}: ${annotation.description ?? ''}`)
      }
    }
    if (entry.expectedStatus === 'failed' || entry.status !== 'expected') {
      const error = result?.errors?.[0]
      if (error) {
        const where = error.location ? `${error.location.file.split(/[\\/]/).pop()}:${error.location.line}` : '?'
        console.log(`    failed at ${where}: ${(stripVTControlCharacters(error.message ?? '').split('\n')[0] ?? '').slice(0, 200)}`)
      }
    }
  }
}
