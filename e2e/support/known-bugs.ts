import { test } from '@playwright/test'

/**
 * Marks the running test as an expected failure for a bug the plan lists.
 *
 * The test still runs: while the bug exists its final assertion fails and the
 * suite stays green. The day a package fixes the bug, Playwright reports
 * "expected to fail, but passed" and the suite goes red, which is the signal to
 * delete this one line and turn the test into a regression test.
 *
 * Use `test.fixme` instead (same plan-item message) for bugs that only show up
 * under a timing race, where an occasional pass would make the suite flaky.
 */
export function knownBug(planItem: string, summary: string): void {
  test.fail(true, `${planItem}: ${summary}`)
}

/** Records what the app did, for the report, without asserting on it. */
export function observe(description: string): void {
  test.info().annotations.push({ type: 'observation', description })
}
