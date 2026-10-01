import { z } from 'zod'
import { latinOnly } from '../../lib/latin-only.js'

export const RegisterSchema = z.object({
  // Trimmed before the length check: "   " is not a name.
  name: latinOnly(z.string().trim().min(1).max(100)),
  surname: latinOnly(z.string().trim().min(1).max(100)),
  /// What they say they are. Routes onboarding and segments reporting; grants
  /// nothing — see User.accountType in the schema.
  accountType: z.enum(['coach', 'club', 'player']).default('coach'),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  phone: z.string().max(30).optional(),
  /** The invite code from ?ref= on the signup link. Optional and never trusted:
      an unknown or self-referring code is ignored, not rejected — a broken
      referral link must never be the reason someone cannot create an account. */
  referralCode: z.string().max(24).optional(),
  /** The single-use token from an approved collaboration application
      (/signup?collab=). Redeemed after the account exists; a bad or expired
      one is ignored, never a reason to refuse the signup. */
  collabToken: z.string().max(100).optional(),
  /** The second password box. Optional (API clients may omit it) but when
      sent it must match — it was accepted unchecked for months. */
  password_confirmation: z.string().max(128).optional(),
}).refine((v) => v.password_confirmation === undefined || v.password_confirmation === v.password, {
  path: ['password_confirmation'],
  message: 'Passwords do not match',
})

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export const RefreshSchema = z.object({
  refreshToken: z.string().min(1),
})

export const ForgotPasswordSchema = z.object({
  email: z.string().email(),
})

export const ResetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(128),
})

export const VerifyEmailSchema = z.object({
  token: z.string().min(1),
})

export type RegisterInput = z.infer<typeof RegisterSchema>
export type LoginInput = z.infer<typeof LoginSchema>
export type RefreshInput = z.infer<typeof RefreshSchema>
