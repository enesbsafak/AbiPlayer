/**
 * Index access whose result the caller knows is there (`noUncheckedIndexedAccess`).
 *
 * Use these only where the invariant is real (a regex group that always
 * participates, an index bounded by the length just checked); where the value
 * can be missing, handle `undefined` instead. A broken invariant throws here
 * rather than letting `undefined` travel on as a `T`.
 */

export function defined<T>(value: T | undefined, what = 'value'): T {
  if (value === undefined) throw new Error(`Expected ${what} to be defined`)
  return value
}

/** `array[index]`, which must exist. */
export function itemAt<T>(array: ArrayLike<T>, index: number): T {
  if (!Number.isInteger(index) || index < 0 || index >= array.length) {
    throw new RangeError(`Index ${index} out of range (length ${array.length})`)
  }
  return array[index] as T
}
