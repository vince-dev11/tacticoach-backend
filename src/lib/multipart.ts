import type { FastifyRequest } from 'fastify'

export interface UploadedFile {
  buffer: Buffer
  mimetype: string
  filename: string
}

/**
 * Read the request's multipart file into memory, enforcing a size cap and an
 * allowed-MIME whitelist. Throws { statusCode } errors the global error
 * handler can surface.
 */
export async function readUpload(
  request: FastifyRequest,
  { maxBytes, allowedTypes }: { maxBytes: number; allowedTypes: string[] },
): Promise<UploadedFile> {
  const data = await request.file({ limits: { fileSize: maxBytes } })
  if (!data) {
    const err = new Error('No file uploaded') as Error & { statusCode: number }
    err.statusCode = 400
    throw err
  }
  if (!allowedTypes.includes(data.mimetype)) {
    const err = new Error(`Allowed types: ${allowedTypes.join(', ')}`) as Error & { statusCode: number }
    err.statusCode = 422
    throw err
  }
  const chunks: Buffer[] = []
  for await (const chunk of data.file) chunks.push(chunk)
  if (data.file.truncated) {
    const err = new Error(`File too large (max ${Math.round(maxBytes / 1024 / 1024)} MB)`) as Error & {
      statusCode: number
    }
    err.statusCode = 422
    throw err
  }
  return { buffer: Buffer.concat(chunks), mimetype: data.mimetype, filename: data.filename }
}
