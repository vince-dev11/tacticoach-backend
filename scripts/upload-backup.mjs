// Upload one backup file to the off-server backup bucket.
//
//   node scripts/upload-backup.mjs /home/ubuntu/backups/tacticoach-backup-2026-09-24-0230.sql.gz
//
// Uses the AWS SDK the API already depends on, so the server needs nothing
// installed. Reads its OWN credentials from .env — never the app's:
//
//   BACKUP_S3_BUCKET=tacticoach-backups
//   BACKUP_AWS_REGION=eu-west-1
//   BACKUP_AWS_ACCESS_KEY_ID=…
//   BACKUP_AWS_SECRET_ACCESS_KEY=…
//
// WHY SEPARATE KEYS. The backup user may only PUT into the backup bucket. It
// cannot list, read or delete. If this server is ever compromised, whoever
// holds it can write junk into the bucket but cannot destroy the backups
// that are already there — and with versioning on, not even overwrite them.
// The app's own keys can read and delete user uploads, which is exactly the
// power a backup credential must not have.
//
// Layout in the bucket:
//   daily/YYYY/MM/<file>     every night   — lifecycle deletes after 35 days
//   monthly/YYYY/<file>      the 1st only  — lifecycle deletes after 13 months

import { createReadStream, statSync } from 'node:fs'
import { basename } from 'node:path'
import 'dotenv/config'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

const file = process.argv[2]
if (!file) {
  console.error('usage: node scripts/upload-backup.mjs <file.sql.gz>')
  process.exit(1)
}

const need = ['BACKUP_S3_BUCKET', 'BACKUP_AWS_REGION', 'BACKUP_AWS_ACCESS_KEY_ID', 'BACKUP_AWS_SECRET_ACCESS_KEY']
const missing = need.filter((k) => !process.env[k])
if (missing.length) {
  console.error(`Missing in .env: ${missing.join(', ')} — backup kept locally only.`)
  process.exit(2)
}

const { size } = statSync(file)
const now = new Date()
const yyyy = now.getUTCFullYear()
const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
const name = basename(file)

const keys = [`daily/${yyyy}/${mm}/${name}`]
// First of the month: a second copy under monthly/, which the lifecycle
// rule keeps for a year instead of five weeks.
if (now.getUTCDate() === 1) keys.push(`monthly/${yyyy}/${name}`)

const s3 = new S3Client({
  region: process.env.BACKUP_AWS_REGION,
  credentials: {
    accessKeyId: process.env.BACKUP_AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.BACKUP_AWS_SECRET_ACCESS_KEY,
  },
})

for (const Key of keys) {
  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.BACKUP_S3_BUCKET,
      Key,
      Body: createReadStream(file),
      ContentLength: size,
      ContentType: 'application/gzip',
      ServerSideEncryption: 'AES256',
    }),
  )
  console.log(`uploaded s3://${process.env.BACKUP_S3_BUCKET}/${Key} (${(size / 1024).toFixed(0)} KB)`)
}
