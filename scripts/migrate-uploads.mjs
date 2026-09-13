#!/usr/bin/env node
//
// One-off: move uploads out of the repository.
//
// Local-disk storage used to default to ./uploads inside the project, so real
// coach data (board videos, thumbnails, drill-sheet images, club logos) ended
// up in the working tree — where a clean checkout or a deploy deletes it. The
// API now stores outside the repo; this moves what is already there.
//
// Keys are preserved exactly (boards/12/thumb-….webp stays boards/12/thumb-….webp),
// so every existing database row keeps resolving after the move.
//
//   node scripts/migrate-uploads.mjs            # move the files
//   node scripts/migrate-uploads.mjs --dry-run  # just show what would move
//
// Safe to re-run: an existing file at the destination is never overwritten.

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import 'dotenv/config'

const DRY = process.argv.includes('--dry-run')

const SRC = path.resolve(process.cwd(), 'uploads')
const DEST = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.join(os.homedir(), 'tacticoach-storage', 'uploads')

/** Every file under dir, as paths relative to it. */
async function walk(dir, base = dir) {
  const out = []
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...(await walk(full, base)))
    else if (e.isFile()) out.push(path.relative(base, full))
  }
  return out
}

const exists = async (p) => !!(await fs.stat(p).catch(() => null))

async function main() {
  console.log(`Source:      ${SRC}`)
  console.log(`Destination: ${DEST}`)
  if (DRY) console.log('Mode:        dry run (nothing will be moved)\n')
  else console.log('')

  if (path.resolve(SRC) === path.resolve(DEST)) {
    console.log('Source and destination are the same directory — nothing to do.')
    return
  }
  if (!(await exists(SRC))) {
    console.log('No ./uploads directory in the project. Nothing to migrate.')
    return
  }

  const files = await walk(SRC)
  if (files.length === 0) {
    console.log('./uploads is empty. Nothing to migrate.')
    return
  }

  let moved = 0
  let skipped = 0
  let failed = 0

  for (const rel of files) {
    const from = path.join(SRC, rel)
    const to = path.join(DEST, rel)

    if (await exists(to)) {
      console.log(`  skip   ${rel}  (already at destination)`)
      skipped++
      continue
    }
    if (DRY) {
      console.log(`  move   ${rel}`)
      moved++
      continue
    }
    try {
      await fs.mkdir(path.dirname(to), { recursive: true })
      try {
        await fs.rename(from, to)
      } catch (err) {
        // rename fails across filesystems (EXDEV) — fall back to copy + delete.
        if (err?.code !== 'EXDEV') throw err
        await fs.copyFile(from, to)
        await fs.unlink(from)
      }
      console.log(`  moved  ${rel}`)
      moved++
    } catch (err) {
      console.error(`  FAILED ${rel}: ${err.message}`)
      failed++
    }
  }

  console.log(`\n${DRY ? 'Would move' : 'Moved'}: ${moved}   Skipped: ${skipped}   Failed: ${failed}`)

  if (!DRY && failed === 0) {
    // Clear out the now-empty directory tree, but never delete anything that
    // still has files in it.
    const left = await walk(SRC)
    if (left.length === 0) {
      await fs.rm(SRC, { recursive: true, force: true })
      console.log(`\nRemoved the empty ${SRC}`)
    } else {
      console.log(`\n${left.length} file(s) still in ${SRC} — left in place.`)
    }
    console.log('Restart the API; it will log the storage path at boot.')
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
