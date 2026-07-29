/**
 * electron-builder pulls executables out of app.asar so they can actually run,
 * but the packages that own them keep reporting their original in-asar path.
 * An asar archive is not a real directory, so spawning that path fails with
 * ENOENT.
 *
 * Only bites in packaged builds; in dev the path is a plain directory and this
 * is a no-op.
 */
export function resolveUnpackedBinary(binaryPath: string | null | undefined): string | null {
  if (!binaryPath) return null
  // The trailing separator matters: without it a sibling directory such as
  // `app.asar.backup` would be rewritten into a path that does not exist.
  return binaryPath.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
}
