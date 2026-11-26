// PADDLE (25 Nov 2026) · plans and books through Paddle (merchant of record).
// Paddle itself is a fake `fetch` here: the tests pin what we ASK Paddle for
// (prices from our plans, a transaction with our ids, one subscription per
// coach) and what we do with what it tells us (signed webhooks, once each).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createHmac } from 'node:crypto'

vi.hoisted(() => {
  process.env.PADDLE_API_KEY = 'pdl_sdbx_apikey_test'
  process.env.PADDLE_ENV = 'sandbox'
  process.env.PADDLE_WEBHOOK_SECRET = 'pdl_ntfset_test_secret'
  process.env.STRIPE_SECRET_KEY = ''
})

import { dbMock } from './setup.js'
import { getApp, accessToken, authHeaders } from './helpers.js'
import { verifyPaddleSignature, billingProvider } from '../src/config/paddle.js'
import { checkoutUrl, netOfTax, priceKey } from '../src/modules/membership/paddle-billing.js'
import { statusFor } from '../src/modules/webhooks/paddle.routes.js'
import { bookCheckoutProvider, bookTaxCategory } from '../src/modules/ebooks/payment-provider.js'

const SECRET = 'pdl_ntfset_test_secret'
const PRO = { id: 3, slug: 'pro', name: 'Pro', description: null, currency: 'GBP', isActive: true, monthlyPrice: '8.99', annualPrice: '79.00' }

type Call = { method: string; path: string; body: Record<string, unknown> | undefined }
let calls: Call[] = []
let responses: Record<string, unknown> = {}

function stubPaddle() {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const u = new URL(url)
    const path = u.pathname + u.search
    const method = init.method ?? 'GET'
    const body = init.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, path, body })
    const key = `${method} ${u.pathname}`
    const data = responses[key] ?? { id: 'x_1' }
    return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } })
  }))
}

function sign(body: string, ts = Math.floor(Date.now() / 1000), secret = SECRET) {
  return `ts=${ts};h1=${createHmac('sha256', secret).update(`${ts}:${body}`).digest('hex')}`
}

let seq = 0
async function webhook(event_type: string, data: Record<string, unknown>, opts: { signature?: string } = {}) {
  const app = await getApp()
  const payload = JSON.stringify({ event_id: `evt_${++seq}`, event_type, occurred_at: new Date().toISOString(), data })
  return app.inject({
    method: 'POST', url: '/api/webhooks/paddle',
    headers: { 'content-type': 'application/json', 'paddle-signature': opts.signature ?? sign(payload) },
    payload,
  })
}

function coach(accountType = 'coach') {
  dbMock.user.findUnique.mockImplementation((args?: unknown) => {
    const a = args as { where?: Record<string, unknown>; select?: Record<string, unknown> } | undefined
    const keys = a?.select ? Object.keys(a.select) : []
    if (keys.length > 0 && keys.every((k) => k === 'role' || k === 'accountType')) return Promise.resolve({ role: 'user', accountType } as never)
    return Promise.resolve({ id: 1, role: 'user', accountType, dateOfBirth: null, email: 'c@test.dev', name: 'C', surname: 'D', paddleCustomerId: 'ctm_1', subscription: null } as never)
  })
  dbMock.user.findUniqueOrThrow.mockResolvedValue({ id: 1, email: 'c@test.dev', name: 'C', surname: 'D', paddleCustomerId: 'ctm_1' } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  responses = {}
  stubPaddle()
  dbMock.paddleEvent.create.mockResolvedValue({} as never)
})

describe('PADDLE · signature (the only proof a delivery is from Paddle)', () => {
  const body = '{"event_id":"evt_1"}'
  it('accepts a fresh signature over ts:rawBody', () => {
    expect(verifyPaddleSignature(body, sign(body), SECRET)).toBe(true)
  })
  it('refuses the wrong secret, a changed body, no header, or a stale timestamp', () => {
    expect(verifyPaddleSignature(body, sign(body, undefined, 'other'), SECRET)).toBe(false)
    expect(verifyPaddleSignature(body + ' ', sign(body), SECRET)).toBe(false)
    expect(verifyPaddleSignature(body, undefined, SECRET)).toBe(false)
    const old = Math.floor(Date.now() / 1000) - 3600
    expect(verifyPaddleSignature(body, sign(body, old), SECRET)).toBe(false)
  })
  it('during a secret rotation any of the h1 values may match', () => {
    const ts = Math.floor(Date.now() / 1000)
    const good = sign(body, ts).split(';h1=')[1]
    expect(verifyPaddleSignature(body, `ts=${ts};h1=deadbeef;h1=${good}`, SECRET)).toBe(true)
  })
})

describe('PADDLE · which gateway takes new payments', () => {
  it('Paddle once its key is set; books follow (behind BOOK_SALES)', () => {
    expect(billingProvider()).toBe('paddle')
    expect(bookCheckoutProvider()?.name).toBe('paddle')
  })
  it('the checkout page link only ever sends people to our own paths', () => {
    expect(checkoutUrl('txn_1', '/billing/success')).toMatch(/\/checkout\?_ptxn=txn_1&to=%2Fbilling%2Fsuccess$/)
    expect(checkoutUrl('txn_1', '//evil.example')).toMatch(/to=%2F$/)
    expect(checkoutUrl('txn_1', 'https://evil.example')).toMatch(/to=%2F$/)
  })
  it('price keys carry plan, cycle, amount and currency', () => {
    expect(priceKey('pro', 'annual', 7900, 'gbp')).toBe('price:pro:annual:7900:GBP:q1')
  })
  it('PADDLE-TAXCAT: the book tax category falls back to standard unless it is a real Paddle category', () => {
    expect(bookTaxCategory('')).toBe('standard')
    expect(bookTaxCategory(undefined)).toBe('standard')
    expect(bookTaxCategory('(leave empty for now)')).toBe('standard')
    expect(bookTaxCategory(' ebooks ')).toBe('ebooks')
  })

  it('tax is never ours: book royalties and commission are on the total less tax', () => {
    expect(netOfTax({ details: { totals: { total: '599', tax: '100' } } })).toBe(499)
  })
})

describe('PADDLE · checkout for a plan', () => {
  it('a coach gets our /checkout page for a server-made transaction at the plan price', async () => {
    coach()
    dbMock.membershipPlan.findUnique.mockResolvedValue(PRO as never)
    dbMock.userSubscription.findUnique.mockResolvedValue(null)
    dbMock.paddleCatalog.findUnique.mockResolvedValue(null)
    dbMock.paddleCatalog.create.mockResolvedValue({} as never)
    responses['POST /products'] = { id: 'pro_1' }
    responses['POST /prices'] = { id: 'pri_1' }
    responses['POST /transactions'] = { id: 'txn_1' }
    const app = await getApp()
    const res = await app.inject({
      method: 'POST', url: '/api/membership/checkout', headers: authHeaders(await accessToken(1)),
      payload: { planSlug: 'pro', cycle: 'monthly' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().url).toMatch(/\/checkout\?_ptxn=txn_1&to=%2Fbilling%2Fsuccess/)
    const price = calls.find((c) => c.path === '/prices')!
    expect(price.body).toMatchObject({ unit_price: { amount: '899', currency_code: 'GBP' }, billing_cycle: { interval: 'month', frequency: 1 } })
    // PADDLE-QTY: one plan per checkout — no quantity stepper in Paddle's checkout.
    expect(price.body).toMatchObject({ quantity: { minimum: 1, maximum: 1 } })
    const txn = calls.find((c) => c.path === '/transactions')!
    expect(txn.body).toMatchObject({ items: [{ price_id: 'pri_1', quantity: 1 }], customer_id: 'ctm_1', custom_data: { kind: 'subscription', userId: '1', planId: '3', cycle: 'monthly' } })
  })

  it('a player or parent never reaches Paddle', async () => {
    coach('player')
    const app = await getApp()
    const res = await app.inject({
      method: 'POST', url: '/api/membership/checkout', headers: authHeaders(await accessToken(1)),
      payload: { planSlug: 'pro', cycle: 'monthly' },
    })
    expect(res.statusCode).toBe(403)
    expect(calls).toHaveLength(0)
  })

  it('a coach already paying through Paddle is moved on the same subscription', async () => {
    coach()
    dbMock.membershipPlan.findUnique.mockResolvedValue({ ...PRO, id: 4, slug: 'club-5', name: 'Club 5', monthlyPrice: '24.99' } as never)
    dbMock.userSubscription.findUnique.mockResolvedValue({ userId: 1, status: 'active', paymentProvider: 'paddle', providerSubscriptionId: 'sub_1', expiresAt: new Date(Date.now() + 86_400_000) } as never)
    dbMock.paddleCatalog.findUnique.mockImplementation((args: unknown) => {
      const key = (args as { where: { key?: string } }).where.key
      return Promise.resolve(key === 'price:club-5:monthly:2499:GBP:q1' ? { key, paddleId: 'pri_club' } : null) as never
    })
    responses['GET /subscriptions/sub_1'] = { id: 'sub_1', status: 'active', customer_id: 'ctm_1', items: [{ price: { id: 'pri_pro' } }], scheduled_change: null }
    const app = await getApp()
    const res = await app.inject({
      method: 'POST', url: '/api/membership/checkout', headers: authHeaders(await accessToken(1)),
      payload: { planSlug: 'club-5', cycle: 'monthly' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().changed).toBe(true)
    const patch = calls.find((c) => c.method === 'PATCH' && c.path === '/subscriptions/sub_1')!
    // P4 (owner, 26 Nov 2026): a plan change is charged now, and refused if the card fails.
    expect(patch.body).toMatchObject({ items: [{ price_id: 'pri_club', quantity: 1 }], proration_billing_mode: 'prorated_immediately', on_payment_failure: 'prevent_change' })
    expect(res.json().chargedNow).toBe(true)
    expect(calls.some((c) => c.path === '/transactions')).toBe(false)
  })
})

describe('PADDLE-CYCLE · monthly ↔ yearly', () => {
  beforeEach(() => { stubPaddle(); responses = {} })

  it('a change of interval is charged now too, and refused if the card fails', async () => {
    coach()
    dbMock.membershipPlan.findUnique.mockResolvedValue({ ...PRO, id: 5, slug: 'club-10', name: 'Club 10', monthlyPrice: '39.99', annualPrice: '400.00' } as never)
    dbMock.userSubscription.findUnique.mockResolvedValue({ userId: 1, status: 'active', billingCycle: 'monthly', paymentProvider: 'paddle', providerSubscriptionId: 'sub_1', expiresAt: new Date(Date.now() + 86_400_000) } as never)
    dbMock.paddleCatalog.findUnique.mockImplementation((args: unknown) => {
      const key = (args as { where: { key?: string } }).where.key
      return Promise.resolve(key === 'price:club-10:annual:40000:GBP:q1' ? { key, paddleId: 'pri_c10y' } : null) as never
    })
    responses['GET /subscriptions/sub_1'] = { id: 'sub_1', status: 'active', customer_id: 'ctm_1', items: [{ price: { id: 'pri_basic' } }], billing_cycle: { interval: 'month', frequency: 1 }, scheduled_change: null }
    const app = await getApp()
    const res = await app.inject({ method: 'POST', url: '/api/membership/checkout', headers: authHeaders(await accessToken(1)), payload: { planSlug: 'club-10', cycle: 'annual' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().chargedNow).toBe(true)
    const patch = calls.find((c) => c.method === 'PATCH' && c.path === '/subscriptions/sub_1')!
    expect(patch.body).toMatchObject({ items: [{ price_id: 'pri_c10y', quantity: 1 }], proration_billing_mode: 'prorated_immediately', on_payment_failure: 'prevent_change' })
  })

  it('Paddle refusing the change gives the coach a clear answer, not a 500', async () => {
    coach()
    dbMock.membershipPlan.findUnique.mockResolvedValue({ ...PRO, id: 5, slug: 'club-10', name: 'Club 10', monthlyPrice: '39.99', annualPrice: '400.00' } as never)
    dbMock.userSubscription.findUnique.mockResolvedValue({ userId: 1, status: 'active', billingCycle: 'monthly', paymentProvider: 'paddle', providerSubscriptionId: 'sub_1', expiresAt: new Date(Date.now() + 86_400_000) } as never)
    dbMock.paddleCatalog.findUnique.mockResolvedValue({ key: 'k', paddleId: 'pri_c10y' } as never)
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      if ((init.method ?? 'GET') === 'PATCH') {
        return new Response(JSON.stringify({ error: { code: 'subscription_payment_declined', detail: 'declined' } }), { status: 400, headers: { 'content-type': 'application/json' } })
      }
      return new Response(JSON.stringify({ data: { id: 'sub_1', status: 'active', customer_id: 'ctm_1', items: [{ price: { id: 'pri_basic' } }], billing_cycle: { interval: 'month', frequency: 1 }, scheduled_change: null } }), { status: 200, headers: { 'content-type': 'application/json' } })
    }))
    const app = await getApp()
    const res = await app.inject({ method: 'POST', url: '/api/membership/checkout', headers: authHeaders(await accessToken(1)), payload: { planSlug: 'club-10', cycle: 'annual' } })
    expect(res.statusCode).toBe(402)
    expect(res.json().error).toBe('payment_failed')
    expect(dbMock.userSubscription.update).not.toHaveBeenCalled()
  })
})

describe('PADDLE-RECEIPT · our emails point to Paddle for the invoice', () => {
  it('the plan confirmation says Paddle sends the receipt and invoice — never Stripe, never our own invoice', async () => {
    const { isMailConfigured, sendMail } = await import('../src/config/mailer.js')
    vi.mocked(isMailConfigured).mockReturnValue(true)
    const { sendPurchaseEmail } = await import('../src/lib/emails.js')
    await sendPurchaseEmail({ name: 'Sam', email: 'sam@test.dev' }, { name: 'Pro' }, 'monthly', new Date('2026-12-26'), 'paddle')
    const mail = vi.mocked(sendMail).mock.calls.at(-1)![0] as { text: string; html: string }
    expect(mail.text).toContain('Your receipt and invoice come separately from Paddle, our reseller.')
    expect(mail.text).not.toContain('Stripe')
    expect(mail.html).toContain('Manage billing')
    vi.mocked(isMailConfigured).mockReturnValue(false)
  })
})

describe('REFUND-PADDLE · Admin refund within the 14 days', () => {
  function owner() {
    dbMock.user.findUnique.mockImplementation((args?: unknown) => {
      const a = args as { select?: Record<string, unknown> } | undefined
      const keys = a?.select ? Object.keys(a.select) : []
      if (keys.length > 0 && keys.every((k) => k === 'role' || k === 'accountType')) return Promise.resolve({ role: 'owner', accountType: 'coach' }) as never
      return Promise.resolve({ id: 1, role: 'owner', accountType: 'coach' }) as never
    })
  }
  const day = 86_400_000
  const txn = (id: string, daysAgo: number, total: string) => ({ id, billed_at: new Date(Date.now() - daysAgo * day).toISOString(), created_at: '', currency_code: 'GBP', details: { totals: { total, tax: '0' } } })

  it('refunds every payment made in the first 14 days (first payment + an upgrade charged at once), skips £0, ends the plan', async () => {
    owner()
    dbMock.userSubscription.findUnique.mockResolvedValue({ userId: 5, status: 'active', paymentProvider: 'paddle', providerSubscriptionId: 'sub_5' } as never)
    responses['GET /transactions'] = [txn('txn_first', 5, '899'), txn('txn_upgrade', 2, '1600'), txn('txn_zero', 1, '0')]
    responses['POST /adjustments'] = { id: 'adj_1', status: 'pending_approval' }
    const app = await getApp()
    const res = await app.inject({ method: 'POST', url: '/api/admin/users/5/refund-subscription', headers: authHeaders(await accessToken()), payload: {} })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ payments: 2, amount: 2499, withinWindow: true })
    const refunded = calls.filter((c) => c.method === 'POST' && c.path === '/adjustments').map((c) => c.body?.transaction_id)
    expect(refunded).toEqual(['txn_first', 'txn_upgrade'])
    expect(calls.some((c) => c.path === '/subscriptions/sub_5/cancel')).toBe(true)
  })
})

describe('PADDLE · webhook', () => {
  it('no secret on the server, or a bad signature → nothing happens', async () => {
    const res = await webhook('subscription.canceled', { id: 'sub_1' }, { signature: 'ts=1;h1=00' })
    expect(res.statusCode).toBe(400)
    expect(dbMock.userSubscription.updateMany).not.toHaveBeenCalled()
  })

  it('the same event twice is handled once', async () => {
    dbMock.paddleEvent.create.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2002' }))
    const res = await webhook('subscription.canceled', { id: 'sub_1' })
    expect(res.json()).toMatchObject({ duplicate: true })
    expect(dbMock.userSubscription.updateMany).not.toHaveBeenCalled()
  })

  it('subscription.created activates the plan for the customer we made — the plan comes from the price', async () => {
    dbMock.user.findUnique.mockImplementation((args: unknown) => {
      const where = (args as { where: Record<string, unknown> }).where
      if (where.paddleCustomerId === 'ctm_1') return Promise.resolve({ id: 1 }) as never
      return Promise.resolve({ id: 1, name: 'C', email: 'c@test.dev', clubName: null }) as never
    })
    dbMock.user.findUniqueOrThrow.mockResolvedValue({ name: 'C', email: 'c@test.dev', clubName: null } as never)
    dbMock.paddleCatalog.findUnique.mockResolvedValue({ key: 'price:pro:monthly:899:GBP', paddleId: 'pri_1' } as never)
    dbMock.membershipPlan.findUnique.mockResolvedValue({ id: 3, name: 'Pro', slug: 'pro' } as never)
    const ends = new Date(Date.now() + 30 * 86_400_000).toISOString()
    await webhook('subscription.created', {
      id: 'sub_1', status: 'active', customer_id: 'ctm_1',
      // A browser can set custom_data; a different plan id here must not matter.
      custom_data: { userId: '1', planId: '99' },
      items: [{ price: { id: 'pri_1' } }], current_billing_period: { starts_at: new Date().toISOString(), ends_at: ends },
    })
    expect(dbMock.userSubscription.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 1 },
      create: expect.objectContaining({ planId: 3, billingCycle: 'monthly', paymentProvider: 'paddle', providerSubscriptionId: 'sub_1', expiresAt: new Date(ends) }),
    }))
  })

  it('PADDLE-QTY: a subscription with quantity above 1 still maps to one plan, and is flagged for a refund', async () => {
    dbMock.user.findUnique.mockImplementation((args: unknown) => {
      const where = (args as { where: Record<string, unknown> }).where
      if (where.paddleCustomerId === 'ctm_1') return Promise.resolve({ id: 1 }) as never
      return Promise.resolve({ id: 1, name: 'C', email: 'c@test.dev', clubName: null }) as never
    })
    dbMock.user.findUniqueOrThrow.mockResolvedValue({ name: 'C', email: 'c@test.dev', clubName: null } as never)
    dbMock.paddleCatalog.findUnique.mockResolvedValue({ key: 'price:pro:monthly:899:GBP:q1', paddleId: 'pri_1' } as never)
    dbMock.membershipPlan.findUnique.mockResolvedValue({ id: 3, name: 'Pro', slug: 'pro' } as never)
    const obs = await import('../src/lib/observability.js')
    const spy = vi.spyOn(obs, 'captureError')
    await webhook('subscription.created', { id: 'sub_q', status: 'active', customer_id: 'ctm_1', items: [{ price: { id: 'pri_1' }, quantity: 2 }] })
    expect(dbMock.userSubscription.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ planId: 3 }) }))
    expect(spy.mock.calls.some(([e]) => String((e as Error).message).includes('quantity 2'))).toBe(true)
  })

  it('a customer we never made activates nothing', async () => {
    dbMock.user.findUnique.mockResolvedValue(null)
    dbMock.paddleCatalog.findUnique.mockResolvedValue({ key: 'price:pro:monthly:899:GBP', paddleId: 'pri_1' } as never)
    await webhook('subscription.created', { id: 'sub_9', status: 'active', customer_id: 'ctm_x', items: [{ price: { id: 'pri_1' } }] })
    expect(dbMock.userSubscription.upsert).not.toHaveBeenCalled()
  })

  it('a scheduled cancel keeps access to the period end; canceled and paused end it; past_due keeps it', () => {
    expect(statusFor({ status: 'active', scheduled_change: { action: 'cancel', effective_at: '2026-12-25T00:00:00Z' } })).toBe('cancelled')
    expect(statusFor({ status: 'past_due', scheduled_change: null })).toBe('active')
    expect(statusFor({ status: 'canceled', scheduled_change: null })).toBe('expired')
    expect(statusFor({ status: 'paused', scheduled_change: null })).toBe('expired')
  })

  it('subscription.updated with a scheduled cancel records the end date', async () => {
    dbMock.paddleCatalog.findUnique.mockResolvedValue(null)
    dbMock.userSubscription.updateMany.mockResolvedValue({ count: 1 } as never)
    await webhook('subscription.updated', {
      id: 'sub_1', status: 'active', customer_id: 'ctm_1', items: [{ price: { id: 'pri_1' } }],
      scheduled_change: { action: 'cancel', effective_at: '2026-12-25T00:00:00.000Z' },
    })
    expect(dbMock.userSubscription.updateMany).toHaveBeenCalledWith({
      where: { providerSubscriptionId: 'sub_1' },
      data: expect.objectContaining({ status: 'cancelled', expiresAt: new Date('2026-12-25T00:00:00.000Z') }),
    })
  })

  it('a book is paid only by the transaction we opened for it, at the amount less tax', async () => {
    dbMock.ebookPurchase.findUnique.mockImplementation((args: unknown) => {
      const a = args as { select?: Record<string, unknown> }
      if (a.select) return Promise.resolve({ id: 7, providerRef: 'txn_7', status: 'pending' }) as never
      return Promise.resolve({ id: 7, status: 'pending', providerRef: 'txn_7', pricePence: 500, currency: 'GBP', ebook: { title: 'B', slug: 'b' }, user: { id: 1, name: 'C', email: 'c@test.dev' } }) as never
    })
    await webhook('transaction.completed', {
      id: 'txn_7', status: 'completed', customer_id: 'ctm_1', subscription_id: null, currency_code: 'GBP',
      custom_data: { kind: 'book', purchaseId: '7' }, details: { totals: { total: '600', tax: '100' } },
    })
    expect(dbMock.ebookPurchase.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: expect.objectContaining({ status: 'paid', providerRef: 'txn_7', pricePence: 500, authorSharePence: 350, platformSharePence: 150 }),
    })
  })

  it('another checkout claiming that purchase (custom_data set by a browser) pays nothing', async () => {
    dbMock.ebookPurchase.findUnique.mockResolvedValue({ id: 7, providerRef: 'txn_7', status: 'pending' } as never)
    await webhook('transaction.completed', {
      id: 'txn_other', status: 'completed', customer_id: 'ctm_1', subscription_id: null, currency_code: 'GBP',
      custom_data: { kind: 'book', purchaseId: '7' }, details: { totals: { total: '499', tax: '0' } },
    })
    expect(dbMock.ebookPurchase.update).not.toHaveBeenCalled()
  })

  it('an approved refund takes the book back; a refund still pending approval does nothing', async () => {
    dbMock.ebookPurchase.findFirst.mockResolvedValue({ id: 7 } as never)
    dbMock.ebookPurchase.findUnique.mockResolvedValue({ id: 7, status: 'paid', provider: 'paddle', providerRef: 'txn_7', ebookId: 2, userId: 1 } as never)
    dbMock.ebookPurchase.update.mockResolvedValue({} as never)
    await webhook('adjustment.created', { id: 'adj_1', action: 'refund', status: 'pending_approval', transaction_id: 'txn_7', customer_id: 'ctm_1' })
    expect(dbMock.ebookPurchase.update).not.toHaveBeenCalled()
    await webhook('adjustment.updated', { id: 'adj_1', action: 'refund', status: 'approved', transaction_id: 'txn_7', customer_id: 'ctm_1' })
    expect(dbMock.ebookPurchase.update).toHaveBeenCalledWith({ where: { id: 7 }, data: expect.objectContaining({ status: 'refunded' }) })
    // Already refunded in Paddle: we don't ask Paddle to refund it again.
    expect(calls.some((c) => c.path === '/adjustments')).toBe(false)
  })

  it('a refunded plan payment reverses partner commission', async () => {
    dbMock.ebookPurchase.findFirst.mockResolvedValue(null)
    dbMock.user.findUnique.mockResolvedValue(null)
    await webhook('adjustment.updated', { id: 'adj_2', action: 'refund', status: 'approved', transaction_id: 'txn_sub', customer_id: 'ctm_1' })
    expect(dbMock.collaboratorCommission.updateMany).toHaveBeenCalledWith({ where: { providerInvoiceId: 'txn_sub', reversedAt: null }, data: { reversedAt: expect.any(Date) } })
  })
})
