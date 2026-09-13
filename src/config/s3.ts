import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import fs from 'node:fs/promises'
import { createReadStream, mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { env } from './env.js'

let s3: S3Client | null = null

export function s3Configured(): boolean {
  return !!(env.AWS_REGION && env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY && env.S3_BUCKET)
}

// ---- Local-disk fallback ----------------------------------------------------
// Without S3 credentials, uploads are written to disk and served straight from
// the API at /uploads/<key>. Same call sites, same keys — deployments with S3
// configured never touch this path.
//
// The storage directory deliberately lives OUTSIDE the repository. Coaches'
// videos, thumbnails and club logos are user data, not source: keeping them in
// the working tree means they show up in `git status`, can be committed by
// accident, and are wiped by a clean checkout or a fresh deploy. The default
// sits in the user's home directory so it survives moving, re-cloning or
// deleting the project folder.
//
// Set UPLOADS_DIR to point somewhere else — on a server that should be a
// mounted volume that outlives the container.
export const LOCAL_DIR = env.UPLOADS_DIR
  ? path.resolve(env.UPLOADS_DIR)
  : path.join(os.homedir(), 'tacticoach-storage', 'uploads')

const publicBase = () => (env.PUBLIC_API_URL ?? `http://localhost:${env.PORT}`).replace(/\/$/, '')

/**
 * Where uploads are going, resolved once at boot.
 *
 * Called from the server entrypoint so the answer is printed in the log rather
 * than discovered later by a coach whose video "did not save". Also creates the
 * directory up front: failing at boot with a clear path is far better than
 * failing on a coach's first upload.
 */
export function describeStorage(): { backend: 's3' | 'local'; location: string; warning?: string } {
  if (s3Configured()) {
    return { backend: 's3', location: `s3://${env.S3_BUCKET} (${env.AWS_REGION})` }
  }
  mkdirSync(LOCAL_DIR, { recursive: true })
  return {
    backend: 'local',
    location: LOCAL_DIR,
    warning:
      env.NODE_ENV === 'production'
        ? 'S3 is not configured, so uploads are being written to local disk. On a container or ' +
          'ephemeral host every video, thumbnail and logo is lost on the next deploy. Configure ' +
          'AWS_REGION / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / S3_BUCKET, or point UPLOADS_DIR ' +
          'at a persistent mounted volume.'
        : undefined,
  }
}

// Uploads are user content served from the API's own origin, so the only
// types listed here are ones a browser cannot execute. SVG is deliberately
// absent: it is a script-bearing document, and serving a stored one as
// image/svg+xml would run its payload on our origin. Logo uploads no longer
// accept SVG (users.schema.ts), and anything already on disk from before
// falls through to the octet-stream default below and downloads instead.
const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.pdf': 'application/pdf',
}

/** Serve locally stored uploads (no-op path when S3 is configured — the route
 *  still exists but nothing is ever written locally). */
export function registerLocalUploads(app: FastifyInstance) {
  app.get('/uploads/*', async (request, reply) => {
    const rel = (request.params as { '*': string })['*'] ?? ''
    const file = path.resolve(LOCAL_DIR, rel)
    // Path-traversal guard: the resolved file must stay inside LOCAL_DIR.
    if (!file.startsWith(LOCAL_DIR + path.sep)) {
      return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'No such file' })
    }
    try {
      await fs.access(file)
    } catch {
      return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'No such file' })
    }
    reply.header('Cache-Control', 'public, max-age=3600')
    reply.type(MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream')
    return reply.send(createReadStream(file))
  })
}

function getS3Client(): S3Client {
  if (!s3Configured()) {
    const err = new Error('S3 storage is not configured on this server') as Error & { statusCode: number }
    err.statusCode = 503
    throw err
  }
  if (!s3) {
    const region = env.AWS_REGION!
    const accessKeyId = env.AWS_ACCESS_KEY_ID!
    const secretAccessKey = env.AWS_SECRET_ACCESS_KEY!
    s3 = new S3Client({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    })
  }
  return s3
}

export async function uploadToS3(key: string, body: Buffer, contentType: string): Promise<void> {
  if (!s3Configured()) {
    const file = path.resolve(LOCAL_DIR, key)
    if (!file.startsWith(LOCAL_DIR + path.sep)) throw new Error('Invalid storage key')
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, body)
    return
  }
  const client = getS3Client()
  const bucket = env.S3_BUCKET!
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  )
}

export async function deleteFromS3(key: string): Promise<void> {
  if (!s3Configured()) {
    const file = path.resolve(LOCAL_DIR, key)
    if (!file.startsWith(LOCAL_DIR + path.sep)) return
    await fs.rm(file, { force: true })
    return
  }
  await getS3Client().send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET!, Key: key }))
}

/** Presigned S3 URL — or the API's own /uploads URL when running on local disk. */
export async function presignUrl(key: string): Promise<string | null> {
  if (!s3Configured()) {
    const file = path.resolve(LOCAL_DIR, key)
    if (!file.startsWith(LOCAL_DIR + path.sep)) return null
    try {
      await fs.access(file)
    } catch {
      return null
    }
    return `${publicBase()}/uploads/${key}`
  }
  return getSignedUrl(getS3Client(), new GetObjectCommand({ Bucket: env.S3_BUCKET!, Key: key }), {
    expiresIn: 900,
  })
}
