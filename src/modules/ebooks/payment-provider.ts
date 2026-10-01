// The one place a payment gateway plugs into the book shop.
//
// Nothing is connected yet. When Stripe or Paddle is, implement
// `BookCheckoutProvider` for it, return it from `bookCheckoutProvider()`, and
// have its webhook call `markPaid(purchaseId, providerRef)` (purchases.service)
// when the money clears. The rest of the shop — ownership, the reader, the
// library, receipts, author shares — already works and does not change.
//
// Card details never touch our pages or our server: the provider's hosted
// checkout collects them. That keeps us out of PCI scope.

export interface BookCheckoutRequest {
  purchaseId: number
  amountPence: number
  currency: string
  title: string
  customerEmail: string
  /** Where the provider sends the buyer back to. */
  successUrl: string
  cancelUrl: string
}

export interface BookCheckoutProvider {
  /** Stored on the purchase: 'stripe', 'paddle'… */
  name: string
  /** Opens a hosted checkout; the buyer is sent to `url`. `ref` identifies it in the webhook. */
  createCheckout(req: BookCheckoutRequest): Promise<{ url: string; ref: string }>
}

/**
 * The live gateway, or null while there is none. With null the shop shows
 * "Buying opens soon" (plus a notify-me list) to everyone except the owner,
 * who can make test purchases to see the whole flow.
 */
export function bookCheckoutProvider(): BookCheckoutProvider | null {
  return null
}
