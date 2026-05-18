import { promises as fs } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

import type { StorageAdapter, PutOpts } from './index'

const KEY_PREFIX = 'local://'
const ROOT = path.resolve(process.cwd(), 'data', 'uploads')

function sanitize(filename: string): string {
  // Strip directory components, replace anything that's not a safe filename char.
  const base = path.basename(filename || 'file')
  return base.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 200) || 'file'
}

function stripPrefix(key: string): string {
  if (!key.startsWith(KEY_PREFIX)) {
    throw new Error(`LocalStorageAdapter cannot read key without prefix: ${key}`)
  }
  return key.slice(KEY_PREFIX.length)
}

function resolveAbsPath(key: string): string {
  const rel = stripPrefix(key)
  const abs = path.resolve(ROOT, rel)
  // Defence against path traversal (e.g. key like `local://../../etc/passwd`).
  if (!abs.startsWith(ROOT + path.sep) && abs !== ROOT) {
    throw new Error(`Invalid storage key (path traversal): ${key}`)
  }
  return abs
}

export class LocalStorageAdapter implements StorageAdapter {
  async put({ paId, filename, bytes }: PutOpts): Promise<string> {
    const id = crypto.randomBytes(8).toString('hex')
    const safeName = sanitize(filename)
    const safePaId = paId.replace(/[^a-zA-Z0-9._-]+/g, '_')
    const rel = `${safePaId}/${id}-${safeName}`
    const abs = path.join(ROOT, rel)

    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, Buffer.from(bytes))

    return `${KEY_PREFIX}${rel}`
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(resolveAbsPath(key))
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(resolveAbsPath(key))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
      throw err
    }
  }

  async pathForOcr(key: string): Promise<string> {
    return resolveAbsPath(key)
  }
}
