// Phase 6 docs-writer gate 14 — markdown link tripwire.
// Scope: relative-path links in repo-root + tasks/ + docs/ .md files.
// Skips http(s)/#/mailto:/~// schemes and anchor fragments. No new deps.
import * as fs from 'fs'
import * as path from 'path'

const ROOT = path.resolve(__dirname, '..')
const DIRS = ['', 'tasks', 'docs']
const LINK_RE = /\]\(([^)]+)\)/g

const broken: string[] = []
for (const sub of DIRS) {
  const dir = path.join(ROOT, sub)
  if (!fs.existsSync(dir)) continue
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.md')) continue
    const fp = path.join(dir, f)
    const lines = fs.readFileSync(fp, 'utf8').split('\n')
    for (let i = 0; i < lines.length; i++) {
      for (const m of lines[i].matchAll(LINK_RE)) {
        let t = m[1].trim().split(/\s+/)[0].split('#')[0]
        if (!t || /^(https?:|mailto:|#|~|\/)/.test(t)) continue
        const resolved = path.resolve(path.dirname(fp), t)
        if (!fs.existsSync(resolved)) broken.push(`${fp}:${i + 1} -> ${t}`)
      }
    }
  }
}

if (broken.length) {
  console.error('Broken relative markdown links:')
  for (const b of broken) console.error('  ' + b)
  process.exit(1)
}
console.log('check-doc-links: all relative links resolve.')
