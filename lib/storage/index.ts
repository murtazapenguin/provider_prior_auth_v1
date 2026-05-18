// Storage abstraction. The default `local` adapter writes to ./data/uploads/.
// Future engineer adds a Vercel Blob / S3 adapter and selects via STORAGE_BACKEND env var.
//
// The storage `key` returned by put() is what gets saved into Attachment.storageUrl.
// It is prefixed with the backend (e.g. local://...) so a future migration can
// route reads to the right adapter even if the DB has mixed-origin rows.

import type { Buffer } from 'node:buffer'

export interface PutOpts {
  /** PA id used as a top-level grouping in the storage backend. */
  paId: string
  /** Original filename. The adapter sanitises and uniquifies before persisting. */
  filename: string
  /** File bytes to store. */
  bytes: Buffer | Uint8Array
}

export interface StorageAdapter {
  /** Persist bytes and return the storage key (the value to save in DB). */
  put(opts: PutOpts): Promise<string>
  /** Read bytes by key. Throws if the object does not exist. */
  get(key: string): Promise<Buffer>
  /** Remove an object. Idempotent — does not throw if absent. */
  delete(key: string): Promise<void>
  /**
   * Return a filesystem path the AI sidecar can read from. For local, this is
   * the absolute path. For cloud adapters, the impl may download to /tmp and
   * return that path.
   */
  pathForOcr(key: string): Promise<string>
}

let _adapter: StorageAdapter | undefined

export function getStorage(): StorageAdapter {
  if (_adapter) return _adapter
  const backend = process.env.STORAGE_BACKEND ?? 'local'
  switch (backend) {
    case 'local': {
      // Lazy import keeps node:fs out of bundles that don't need it.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('./local') as typeof import('./local')
      _adapter = new mod.LocalStorageAdapter()
      return _adapter
    }
    default:
      throw new Error(`Unknown STORAGE_BACKEND: ${backend}`)
  }
}

/** Test-only override. */
export function _setStorageForTesting(adapter: StorageAdapter | undefined): void {
  _adapter = adapter
}
