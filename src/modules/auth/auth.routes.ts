import type { FastifyInstance } from 'fastify'
import { ZodError } from 'zod'
import {
  RegisterSchema,
  LoginSchema,
  RefreshSchema,
} from './auth.schema.js'
import {
  registerUser,
  validateCredentials,
  saveRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  findRefreshToken,
} from './auth.service.js'

export async function authRoutes(app: FastifyInstance) {
  // POST /auth/register
  app.post('/register', async (request, reply) => {
    const input = RegisterSchema.parse(request.body)
    const user = await registerUser(input)
    const accessToken = app.jwt.sign({ sub: user.id, email: user.email }, { expiresIn: '15m' })
    const refreshToken = app.jwt.sign({ sub: user.id, type: 'refresh' }, { expiresIn: '30d' })
    await saveRefreshToken(user.id, refreshToken)
    return reply.status(201).send({ user, accessToken, refreshToken })
  })

  // POST /auth/login
  app.post('/login', async (request, reply) => {
    const input = LoginSchema.parse(request.body)
    const user = await validateCredentials(input)
    if (!user) {
      return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Invalid email or password' })
    }
    const accessToken = app.jwt.sign({ sub: user.id, email: user.email }, { expiresIn: '15m' })
    const refreshToken = app.jwt.sign({ sub: user.id, type: 'refresh' }, { expiresIn: '30d' })
    await saveRefreshToken(user.id, refreshToken)
    return reply.send({ user: { id: user.id, name: user.name, surname: user.surname, email: user.email }, accessToken, refreshToken })
  })

  // POST /auth/refresh
  app.post('/refresh', async (request, reply) => {
    const { refreshToken } = RefreshSchema.parse(request.body)
    let payload: any
    try {
      payload = app.jwt.verify(refreshToken)
    } catch {
      return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Invalid refresh token' })
    }
    const stored = await findRefreshToken(refreshToken)
    if (!stored || stored.expiresAt < new Date()) {
      return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Refresh token expired or not found' })
    }
    const newAccess = app.jwt.sign({ sub: stored.userId, email: stored.user.email }, { expiresIn: '15m' })
    const newRefresh = app.jwt.sign({ sub: stored.userId, type: 'refresh' }, { expiresIn: '30d' })
    await rotateRefreshToken(refreshToken, stored.userId, newRefresh)
    return reply.send({ accessToken: newAccess, refreshToken: newRefresh })
  })

  // POST /auth/logout
  app.post('/logout', async (request, reply) => {
    const { refreshToken } = RefreshSchema.parse(request.body)
    await revokeRefreshToken(refreshToken)
    return reply.send({ message: 'Logged out' })
  })
}
