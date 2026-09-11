// @fastify/jwt registered with `namespace: 'refresh'` decorates the instance
// with `fastify.jwt.refresh` at runtime (index.js: `fastify.jwt[namespace] =
// jwtDecorator`), but its published types don't model the namespace on the
// JWT interface. Declare it so the refresh-token signer/verifier is typed
// rather than reached for with a cast.

import '@fastify/jwt'

declare module '@fastify/jwt' {
  interface JWT {
    /** Signer/verifier bound to JWT_REFRESH_SECRET (see src/app.ts). */
    refresh: Omit<JWT, 'refresh'>
  }
}
