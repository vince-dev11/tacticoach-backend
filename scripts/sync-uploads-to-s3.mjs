#!/usr/bin/env node
// S3 (16 Oct 2026): copy the uploads already on the server's disk into the
// bucket, keys preserved exactly (boards/12/thumb-….webp stays
// boards/12/thumb-….webp), so every database row keeps resolving once the
// API reads from S3. Safe to run again: a file already in the bucket with
// the same size is skipped. Nothing is deleted from disk — remove the
// folder yourself once the site has run on S3 for a while.
//
//   cd /var/www/html/tacticoach-backend
//   node scripts/sync-uploads-to-s3.mjs --dry-run   # list what would go
//   node scripts/sync-uploads-to-s3.mjs             # copy
//
// Reads AWS_REGION / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / S3_BUCKET
// and UPLOADS_DIR from .env, the same as the API.

import 'dotenv/config'
import { readdir, stat, readFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'

const dry = process.argv.includes('--dry-run')
const { AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_BUCKET, UPLOADS_DIR } = process.env
if (!AWS_REGION || !AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY || !S3_BUCKET) {
  console.error('S3 is not configured in .env (AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_BUCKET).')
  process.exit(1)
}
const root = UPLOADS_DIR ? path.resolve(UPLOADS_DIR) : path.join(os.homedir(), 'tacticoach-storage', 'uploads')

// The same types the API serves (config/s3.ts); anything else goes up as a download.
const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.pdf': 'application/pdf',
}
const CACHE = 'private, max-age=31536000, immutable'

async function* walk(dir) {
  for (const name of await readdir(dir)) {
    const p = path.join(dir, name)
    const s = await stat(p)
    if (s.isDirectory()) yield* walk(p)
    else if (s.isFile() && !name.startsWith('.')) yield { p, size: s.size }
  }
}

const s3 = new S3Client({ region: AWS_REGION, credentials: { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY } })
let copied = 0, skipped = 0, bytes = 0
try {
  await stat(root)
} catch {
  console.error(`No uploads folder at ${root} — nothing to copy.`)
  process.exit(0)
}
console.log(`${dry ? 'Would copy' : 'Copying'} ${root} → s3://${S3_BUCKET}`)
for await (const { p, size } of walk(root)) {
  const key = path.relative(root, p).split(path.sep).join('/')
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }))
    if (head.ContentLength === size) { skipped++; continue }
  } catch { /* not there yet */ }
  console.log(`  ${key} (${(size / 1024).toFixed(0)} KB)`)
  if (!dry) {
    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET, Key: key, Body: await readFile(p),
      ContentType: MIME[path.extname(p).toLowerCase()] ?? 'application/octet-stream', CacheControl: CACHE,
    }))
  }
  copied++
  bytes += size
}
console.log(`${dry ? 'Would copy' : 'Copied'} ${copied} files (${(bytes / 1048576).toFixed(1)} MB); ${skipped} already in the bucket.`)
