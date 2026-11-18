export interface AsarEntry {
  path: string
  unpacked: boolean
  size: number
}

export interface PackageCheckResult {
  violations: string[]
  /** Bytes on disk under Contents/ (asar archive counted as one file). */
  bytes: number
  /** Bytes on disk under Contents/Resources. */
  resourceBytes: number
}

export function readAsarEntries(archive: string): AsarEntry[]
export function checkPackageContents(appBundle: string, options?: { crossPackage?: boolean }): PackageCheckResult
export function main(argv: string[]): number
