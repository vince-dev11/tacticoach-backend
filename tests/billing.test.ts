// BILLING (20 Oct 2026) · Stripe end to end, so going live is "paste the keys".
// Stripe itself is a fake here: the tests pin what we ASK Stripe for (prices
// by lookup key, one subscription per coach, the portal, refunds) and what we
// do with what it tells us (webhooks, once each).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'

vi.hoisted(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_123'
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
})

const fake = vi.hoisted(() => ({
  prices: { list: vi.fn(), create: vi.fn() },
  products: { search: vi.fn(), create: vi.fn() },
  customers: { create: vi.fn() },
  checkout: { sessions: { create: vi.fn(), expire: vi.fn() } },
  subscriptions: { retrieve: vi.fn(), update: vi.fn(), cancel: vi.fn() },
  billingPortal: { configurations: { list: vi.fn(), create: vi.fn() }, sessions: { create: vi.fn() } },
  invoices: { list: vi.fn() },
  refunds: { create: vi.fn() },
  webhooks: { constructEvent: vi.fn((body: Buffer) => JSON.parse(body.toString())) },
}))
vi.mock('../src/config/stripe.js', () => ({ stripe: () => fake, stripeConfigured: () => true }))

import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders } from './helpers.js'
import { subIsActive } from '../src/lib/entitlements.js'
import { lookupKeyFor, stripeMode, _resetPortalCache } from '../src/modules/membership/stripe-catalog.js'
import { bookCheckoutProvider } from '../src/modules/ebooks/payment-provider.js'

const PRO = { id: 3, slug: 'pro', name: 'Pro', description: null, currency: 'GBP', isActive: true, monthlyPrice: '8.99', annualPrice: '79.00' }

function callerIs(accountType = 'coach', role = 'user') {
  dbMock.user.findUnique.mockImplementation((args?: unknown) => {
    const select = (args as { select?: Record<string, unknown> } | undefined)?.select
    const keys = select ? Object.keys(select) : []
    if (keys.length > 0 && keys.every((k) => k === 'role' || k === 'accountType')) return Promise.resolve({ role, accountType } as never)
    return Promise.resolve({ id: 1, role, accountType, dateOfBirth: null, email: 'c@test.dev', name: 'C', surname: 'D', stripeCustomerId: 'cus_1' } as never)
  })
  dbMock.user.findUniqueOrThrow.mockResolvedValue({ id: 1, email: 'c@test.dev', name: 'C', surname: 'D', stripeCustomerId: 'cus_1' } as never)
}

const webhook = async (event: Record<string, unknown>) => {
  const app = await getApp()
  return app.inject({ method: 'POST', url: '/api/webhooks/stripe', headers: { 'content-type': 'application/json', 'stripe-signature': 'sig' }, payload: JSON.stringify(event) })
}

beforeEach(() => {
  vi.clearAllMocks()
  _resetPortalCache()
  fake.webhooks.constructEvent.mockImplementation((body: Buffer) => JSON.parse(body.toString()))
})

describe('BILLING · the catalogue is made from our plans (no dashboard set-up)', () => {
  it('lookup keys carry the plan, cycle, amount and currency; the mode comes from the key', () => {
    expect(lookupKeyFor('pro', 'annual', 7900, 'GBP')).toBe('tacticoach_pro_annual_7900_gbp')
    expect(stripeMode('sk_live_x')).toBe('live')
    expect(stripeMode('sk_test_x')).toBe('test')
    expect(stripeMode('')).toBeNull()
  })

  it('first checkout creates the product and the price, then a Checkout session with that price', async () => {
    const app = await getApp()
    callerIs()
    dbMock.membershipPlan.findUnique.mockResolvedValue(PRO as never)
    dbMock.userSubscription.findUnique.mockResolvedValue(null)
    fake.prices.list.mockResolvedValue({ data: [] })
    fake.products.search.mockResolvedValue({ data: [] })
    fake.products.create.mockResolvedValue({ id: 'prod_1' })
    fake.prices.create.mockResolvedValue({ id: 'price_new' })
    fake.checkout.sessions.create.mockResolvedValue({ url: 'https://checkout.stripe.test/s' })
    const res = await app.inject({ method: 'POST', url: '/api/membership/checkout', headers: authHeaders(await accessToken()), payload: { planSlug: 'pro', cycle: 'monthly' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().url).toBe('https://checkout.stripe.test/s')
    expect(fake.prices.create).toHaveBeenCalledWith(expect.objectContaining({ unit_amount: 899, lookup_key: 'tacticoach_pro_monthly_899_gbp', recurring: { interval: 'month' } }))
    const session = fake.checkout.sessions.create.mock.calls[0][0]
    expect(session.line_items).toEqual([{ quantity: 1, price: 'price_new' }])
    expect(session.mode).toBe('subscription')
    expect(session.metadata).toMatchObject({ kind: 'subscription', planId: '3', cycle: 'monthly' })
  })

  it('an existing price is reused, never duplicated', async () => {
    const app = await getApp()
    callerIs()
    dbMock.membershipPlan.findUnique.mockResolvedValue(PRO as never)
    dbMock.userSubscription.findUnique.mockResolvedValue(null)
    fake.prices.list.mockResolvedValue({ data: [{ id: 'price_old' }] })
    fake.checkout.sessions.create.mockResolvedValue({ url: 'u' })
    await app.inject({ method: 'POST', url: '/api/membership/checkout', headers: authHeaders(await accessToken()), payload: { planSlug: 'pro', cycle: 'annual' } })
    expect(fake.prices.create).not.toHaveBeenCalled()
    expect(fake.checkout.sessions.create.mock.calls[0][0].line_items[0].price).toBe('price_old')
  })
})

describe('BILLING · one subscription per coach', () => {
  it('a coach already paying by card is moved to the new plan in place (prorated), not sent to a second checkout', async () => {
    const app = await getApp()
    callerIs()
    dbMock.membershipPlan.findUnique.mockResolvedValue(PRO as never)
    dbMock.userSubscription.findUnique.mockResolvedValue({ userId: 1, status: 'active', expiresAt: new Date(Date.now() + 86_400_000), paymentProvider: 'stripe', providerSubscriptionId: 'sub_1' } as never)
    fake.prices.list.mockResolvedValue({ data: [{ id: 'price_pro' }] })
    fake.subscriptions.retrieve.mockResolvedValue({ id: 'sub_1', status: 'active', items: { data: [{ id: 'si_1', price: { id: 'price_basic' } }] } })
    fake.subscriptions.update.mockResolvedValue({})
    const res = await app.inject({ method: 'POST', url: '/api/membership/checkout', headers: authHeaders(await accessToken()), payload: { planSlug: 'pro', cycle: 'monthly' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().changed).toBe(true)
    expect(fake.checkout.sessions.create).not.toHaveBeenCalled()
    expect(fake.subscriptions.update).toHaveBeenCalledWith('sub_1', expect.objectContaining({ items: [{ id: 'si_1', price: 'price_pro' }], proration_behavior: 'create_prorations' }))
    expect(dbMock.userSubscription.update.mock.calls[0][0].data).toMatchObject({ planId: 3, billingCycle: 'monthly', status: 'active' })
  })

  it('the same plan again is a 409; players and parents cannot buy plans', async () => {
    const app = await getApp()
    callerIs()
    dbMock.membershipPlan.findUnique.mockResolvedValue(PRO as never)
    dbMock.userSubscription.findUnique.mockResolvedValue({ userId: 1, status: 'active', expiresAt: null, paymentProvider: 'stripe', providerSubscriptionId: 'sub_1' } as never)
    fake.prices.list.mockResolvedValue({ data: [{ id: 'price_pro' }] })
    fake.subscriptions.retrieve.mockResolvedValue({ id: 'sub_1', status: 'active', items: { data: [{ id: 'si_1', price: { id: 'price_pro' } }] } })
    const same = await app.inject({ method: 'POST', url: '/api/membership/checkout', headers: authHeaders(await accessToken()), payload: { planSlug: 'pro', cycle: 'monthly' } })
    expect(same.statusCode).toBe(409)

    callerIs('parent')
    const parent = await app.inject({ method: 'POST', url: '/api/membership/checkout', headers: authHeaders(await accessToken()), payload: { planSlug: 'pro', cycle: 'monthly' } })
    expect([403]).toContain(parent.statusCode)
  })
})

describe('BILLING · manage billing (Stripe Customer Portal)', () => {
  it('creates the portal configuration once (found by metadata after) and returns the portal URL', async () => {
    const app = await getApp()
    callerIs()
    fake.billingPortal.configurations.list.mockResolvedValue({ data: [] })
    fake.billingPortal.configurations.create.mockResolvedValue({ id: 'bpc_1' })
    fake.billingPortal.sessions.create.mockResolvedValue({ url: 'https://billing.stripe.test/p' })
    const res = await app.inject({ method: 'POST', url: '/api/membership/portal', headers: authHeaders(await accessToken()) })
    expect(res.statusCode).toBe(200)
    expect(res.json().url).toBe('https://billing.stripe.test/p')
    const cfg = fake.billingPortal.configurations.create.mock.calls[0][0]
    expect(cfg.features.subscription_cancel).toMatchObject({ enabled: true, mode: 'at_period_end' })
    expect(cfg.metadata).toEqual({ app: 'tacticoach' })
    expect(fake.billingPortal.sessions.create.mock.calls[0][0]).toMatchObject({ customer: 'cus_1', configuration: 'bpc_1' })
  })
})

describe('BILLING · cancelling keeps the paid period', () => {
  it('a cancelled plan is active until its end date; undated or past is over', () => {
    expect(subIsActive({ status: 'cancelled', expiresAt: new Date(Date.now() + 86_400_000) })).toBe(true)
    expect(subIsActive({ status: 'cancelled', expiresAt: new Date(Date.now() - 1000) })).toBe(false)
    expect(subIsActive({ status: 'cancelled', expiresAt: null })).toBe(false)
    expect(subIsActive({ status: 'expired', expiresAt: new Date(Date.now() + 86_400_000) })).toBe(false)
  })

  it('PATCH /membership/cancel cancels at period end in Stripe and records the end date', async () => {
    const app = await getApp()
    callerIs()
    dbMock.userSubscription.findUnique.mockResolvedValue({ userId: 1, status: 'active', expiresAt: null, paymentProvider: 'stripe', providerSubscriptionId: 'sub_1' } as never)
    const end = Math.floor(Date.now() / 1000) + 20 * 86400
    fake.subscriptions.update.mockResolvedValue({ items: { data: [{ current_period_end: end }] } })
    dbMock.userSubscription.update.mockResolvedValue({ status: 'cancelled' } as never)
    const res = await app.inject({ method: 'PATCH', url: '/api/membership/cancel', headers: authHeaders(await accessToken()) })
    expect(res.statusCode).toBe(200)
    expect(fake.subscriptions.update).toHaveBeenCalledWith('sub_1', { cancel_at_period_end: true })
    expect(dbMock.userSubscription.update.mock.calls[0][0].data.expiresAt).toEqual(new Date(end * 1000))
  })
})

describe('BILLING · webhooks', () => {
  it('each event is handled once: a re-delivery is acknowledged and skipped', async () => {
    dbMock.stripeEvent.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }))
    const res = await webhook({ id: 'evt_1', type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', items: { data: [] } } } })
    expect(res.statusCode).toBe(200)
    expect(res.json().duplicate).toBe(true)
    expect(dbMock.userSubscription.updateMany).not.toHaveBeenCalled()
  })

  it('a book bought on Stripe checkout is marked paid with its payment intent', async () => {
    dbMock.stripeEvent.create.mockResolvedValue({} as never)
    dbMock.ebookPurchase.findUnique.mockResolvedValue({ id: 9, status: 'pending', pricePence: 1000, currency: 'GBP', ebook: { title: 'B', slug: 'b' }, user: { id: 1, name: 'C', email: 'c@test.dev' } } as never)
    dbMock.ebookPurchase.update.mockResolvedValue({} as never)
    const res = await webhook({ id: 'evt_2', type: 'checkout.session.completed', data: { object: { id: 'cs_1', metadata: { kind: 'book', purchaseId: '9' }, payment_status: 'paid', payment_intent: 'pi_9', amount_total: 1000, currency: 'gbp' } } })
    expect(res.statusCode).toBe(200)
    expect(dbMock.ebookPurchase.update.mock.calls[0][0]).toMatchObject({ where: { id: 9 }, data: { status: 'paid', providerRef: 'pi_9', authorSharePence: 700, platformSharePence: 300 } })
    expect(dbMock.userSubscription.upsert).not.toHaveBeenCalled()
  })

  it('past due keeps access while Stripe retries the card; unpaid expires', async () => {
    dbMock.stripeEvent.create.mockResolvedValue({} as never)
    await webhook({ id: 'evt_3', type: 'customer.subscription.updated', data: { object: { id: 'sub_1', status: 'past_due', cancel_at_period_end: false, items: { data: [] } } } })
    expect(dbMock.userSubscription.updateMany.mock.calls[0][0].data.status).toBe('active')
    await webhook({ id: 'evt_4', type: 'customer.subscription.updated', data: { object: { id: 'sub_1', status: 'unpaid', cancel_at_period_end: false, items: { data: [] } } } })
    expect(dbMock.userSubscription.updateMany.mock.calls[1][0].data.status).toBe('expired')
  })

  it('a failure forgets the event so Stripe’s retry runs it again', async () => {
    dbMock.stripeEvent.create.mockResolvedValue({} as never)
    dbMock.userSubscription.updateMany.mockRejectedValue(new Error('db down'))
    const res = await webhook({ id: 'evt_5', type: 'customer.subscription.deleted', data: { object: { id: 'sub_1', items: { data: [] } } } })
    expect(res.statusCode).toBe(500)
    expect(dbMock.stripeEvent.delete).toHaveBeenCalledWith({ where: { id: 'evt_5' } })
  })
})

// SECURITY SCAN (23 Oct 2026) — book payments are recorded at what was paid.
describe('PAY-AMOUNT / PAY-TWICE / PAY-STALE · book money adds up', () => {
  const bookEvent = (id: string, o: Record<string, unknown>) =>
    webhook({ id, type: 'checkout.session.completed', data: { object: { id: 'cs_old', metadata: { kind: 'book', purchaseId: '9' }, payment_status: 'paid', ...o } } })
  const row = (o: Record<string, unknown> = {}) => ({ id: 9, status: 'pending', pricePence: 2000, currency: 'GBP', providerRef: 'cs_new', ebook: { title: 'B', slug: 'b' }, user: { id: 1, name: 'C', email: 'c@test.dev' }, ...o })

  it('an older, cheaper checkout page that gets paid is recorded at what was paid — the author is credited 70% of that, not of today’s price', async () => {
    dbMock.stripeEvent.create.mockResolvedValue({} as never)
    dbMock.ebookPurchase.findUnique.mockResolvedValue(row() as never)
    dbMock.ebookPurchase.update.mockResolvedValue({} as never)
    await bookEvent('evt_p1', { payment_intent: 'pi_old', amount_total: 50, currency: 'gbp' })
    expect(dbMock.ebookPurchase.update.mock.calls[0][0].data).toMatchObject({ status: 'paid', pricePence: 50, authorSharePence: 35, platformSharePence: 15 })
  })

  it('a payment in another currency, or of nothing, is never recorded as a sale', async () => {
    dbMock.stripeEvent.create.mockResolvedValue({} as never)
    dbMock.ebookPurchase.findUnique.mockResolvedValue(row() as never)
    await bookEvent('evt_p2', { payment_intent: 'pi_x', amount_total: 2000, currency: 'usd' })
    await bookEvent('evt_p3', { payment_intent: 'pi_y', amount_total: 0, currency: 'gbp' })
    expect(dbMock.ebookPurchase.update).not.toHaveBeenCalled()
  })

  it('a second, different payment for a book already owned (two tabs) is refunded', async () => {
    dbMock.stripeEvent.create.mockResolvedValue({} as never)
    dbMock.ebookPurchase.findUnique.mockResolvedValue(row({ status: 'paid', providerRef: 'pi_first' }) as never)
    fake.refunds.create.mockResolvedValue({ id: 're_1' })
    await bookEvent('evt_p4', { payment_intent: 'pi_second', amount_total: 2000, currency: 'gbp' })
    expect(fake.refunds.create).toHaveBeenCalledWith(expect.objectContaining({ payment_intent: 'pi_second' }))
    expect(dbMock.ebookPurchase.update).not.toHaveBeenCalled()
    // …but the same payment delivered again refunds nothing.
    fake.refunds.create.mockClear()
    await bookEvent('evt_p5', { payment_intent: 'pi_first', amount_total: 2000, currency: 'gbp' })
    expect(fake.refunds.create).not.toHaveBeenCalled()
  })

  it('starting a new checkout closes the old, unpaid checkout page', () => {
    const svc = readFileSync('src/modules/ebooks/purchases.service.ts', 'utf8')
    expect(svc).toMatch(/existing\?\.status === 'pending' && existing\.providerRef\?\.startsWith\('cs_'\)\) \{\s*await expireBookCheckout\(existing\.providerRef\)/)
  })

  it('PAY-PERIOD: the end of the paid period is read on either API version', async () => {
    const { periodEnd } = await import('../src/modules/webhooks/stripe.routes.js')
    const t = 1_800_000_000
    expect(periodEnd({ items: { data: [{ current_period_end: t }] } } as never)).toEqual(new Date(t * 1000))
    expect(periodEnd({ items: { data: [{}] }, current_period_end: t } as never)).toEqual(new Date(t * 1000))
  })
})

describe('BILLING · books go live with the keys', () => {
  it('the book provider is Stripe hosted checkout, one-off payment, traced by purchase id', async () => {
    const p = bookCheckoutProvider()!
    expect(p.name).toBe('stripe')
    fake.checkout.sessions.create.mockResolvedValue({ id: 'cs_b', url: 'https://checkout.stripe.test/b' })
    const out = await p.createCheckout({ purchaseId: 9, amountPence: 1200, currency: 'GBP', title: 'Pressing', customerEmail: 'c@test.dev', successUrl: 's', cancelUrl: 'c' })
    expect(out).toEqual({ url: 'https://checkout.stripe.test/b', ref: 'cs_b' })
    const args = fake.checkout.sessions.create.mock.calls[0][0]
    expect(args.mode).toBe('payment')
    expect(args.metadata).toEqual({ kind: 'book', purchaseId: '9' })
    expect(args.line_items[0].price_data.unit_amount).toBe(1200)
  })
})

describe('BILLING · the 14-day refund rule (Admin)', () => {
  const sub = { userId: 5, status: 'active', expiresAt: null, paymentProvider: 'stripe', providerSubscriptionId: 'sub_5' }
  it('outside 14 days of the first payment it refuses unless forced', async () => {
    const app = await getApp()
    callerIs('coach', 'owner')
    dbMock.userSubscription.findUnique.mockResolvedValue(sub as never)
    const old = Math.floor(Date.now() / 1000) - 30 * 86400
    fake.invoices.list.mockResolvedValue({ data: [{ created: old, payments: { data: [{ payment: { payment_intent: 'pi_1' } }] } }] })
    const res = await app.inject({ method: 'POST', url: '/api/admin/users/5/refund-subscription', headers: authHeaders(await accessToken()), payload: {} })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toBe('outside_window')
    expect(fake.refunds.create).not.toHaveBeenCalled()
  })

  it('inside 14 days: refunds the latest payment, cancels now, expires access', async () => {
    const app = await getApp()
    callerIs('coach', 'owner')
    dbMock.userSubscription.findUnique.mockResolvedValue(sub as never)
    const recent = Math.floor(Date.now() / 1000) - 3 * 86400
    fake.invoices.list.mockResolvedValue({ data: [{ created: recent, payments: { data: [{ payment: { payment_intent: 'pi_2' } }] } }] })
    fake.refunds.create.mockResolvedValue({ id: 're_1', amount: 899, currency: 'gbp' })
    fake.subscriptions.cancel.mockResolvedValue({})
    const res = await app.inject({ method: 'POST', url: '/api/admin/users/5/refund-subscription', headers: authHeaders(await accessToken()), payload: {} })
    expect(res.statusCode).toBe(200)
    expect(fake.refunds.create).toHaveBeenCalledWith(expect.objectContaining({ payment_intent: 'pi_2' }))
    expect(fake.subscriptions.cancel).toHaveBeenCalledWith('sub_5')
    expect(dbMock.userSubscription.update.mock.calls[0][0].data.status).toBe('expired')
  })

  it('the owner can see whether Stripe is connected, in which mode, and where the webhook goes', async () => {
    const app = await getApp()
    callerIs('coach', 'owner')
    const res = await app.inject({ method: 'GET', url: '/api/admin/billing/status', headers: authHeaders(await accessToken()) })
    expect(res.statusCode).toBe(200)
    expect(res.json().stripe).toMatchObject({ configured: true, mode: 'test', webhookSecret: true })
    expect(res.json().stripe.webhookUrl).toMatch(/\/api\/webhooks\/stripe$/)
    expect(res.json().books.live).toBe(true)
  })
})

describe('BILLING · migration', () => {
  it('56 adds stripe_events, locale, setup reminders and the provider message id', () => {
    const sql = readFileSync('prisma/migrations/56_billing_and_onboarding_email/migration.sql', 'utf8')
    for (const s of ['CREATE TABLE `stripe_events`', '`locale` VARCHAR(8)', '`setup_invited_at`', '`setup_reminders_sent`', '`welcomed_at`', '`provider_message_id`']) expect(sql).toContain(s)
  })
})
