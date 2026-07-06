import type { FastifyInstance } from 'fastify'
import { authGuard } from '../../middleware/auth-guard.js'
import { UpdateProfileSchema, ALLOWED_LOGO_TYPES, MAX_LOGO_SIZE } from './users.schema.js'
import { getUserProfile, updateUserProfile, uploadClubLogo, deleteClubLogo } from './users.service.js'

export async function usersRoutes(app: FastifyInstance) {
  // All routes require auth
  app.addHook('preHandler', authGuard)

  // GET /users/me
  app.get('/me', async (request, reply) => {
    const userId = (request.user as any).sub as number
    const user = await getUserProfile(userId)
    if (!user) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'User not found' })
    return reply.send(user)
  })

  // PATCH /users/me
  app.patch('/me', async (request, reply) => {
    const userId = (request.user as any).sub as number
    const input = UpdateProfileSchema.parse(request.body)
    const user = await updateUserProfile(userId, input)
    return reply.send(user)
  })

  // POST /users/me/logo — multipart upload
  app.post('/me/logo', async (request, reply) => {
    const userId = (request.user as any).sub as number
    const data = await request.file()
    if (!data) {
      return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'No file uploaded' })
    }
    if (!ALLOWED_LOGO_TYPES.includes(data.mimetype)) {
      return reply.status(422).send({ statusCode: 422, error: 'Unprocessable Entity', message: `Allowed types: ${ALLOWED_LOGO_TYPES.join(', ')}` })
    }

    const chunks: Buffer[] = []
    for await (const chunk of data.file) {
      chunks.push(chunk)
    }
    const buffer = Buffer.concat(chunks)

    if (buffer.length > MAX_LOGO_SIZE) {
      return reply.status(422).send({ statusCode: 422, error: 'Unprocessable Entity', message: 'File too large (max 5 MB)' })
    }

    const ext = data.filename.split('.').pop() ?? 'png'
    const logoUrl = await uploadClubLogo(userId, buffer, data.mimetype, ext)
    return reply.send({ clubLogoUrl: logoUrl })
  })

  // DELETE /users/me/logo
  app.delete('/me/logo', async (request, reply) => {
    const userId = (request.user as any).sub as number
    await deleteClubLogo(userId)
    return reply.send({ message: 'Logo removed' })
  })
}
