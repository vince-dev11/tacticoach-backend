import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { env } from './env.js'

let s3: S3Client | null = null

export function s3Configured(): boolean {
  return !!(env.AWS_REGION && env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY && env.S3_BUCKET)
}

function unavailableError() {
  const err = new Error('S3 storage is not configured on this server') as Error & { statusCode: number }
  err.statusCode = 503
  return err
}

function getS3Client(): S3Client {
  if (!s3Configured()) throw unavailableError()
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
  if (!s3Configured()) return
  await getS3Client().send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET!, Key: key }))
}

/** Returns a 15-minute presigned URL so private S3 objects can be served to clients. */
export async function presignUrl(key: string): Promise<string | null> {
  if (!s3Configured()) return null
  return getSignedUrl(getS3Client(), new GetObjectCommand({ Bucket: env.S3_BUCKET!, Key: key }), {
    expiresIn: 900,
  })
}
