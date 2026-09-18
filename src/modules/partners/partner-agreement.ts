// The Partner Programme Agreement — the single source of the words.
//
// It lives in code rather than in a CMS or a Word file on someone's desktop for
// one reason: when a partner disputes what they agreed to, we have to be able to
// show the exact text they saw. `PARTNER_AGREEMENT_VERSION` is stored on the
// partner row at acceptance, so changing this file never rewrites history — it
// creates a new version that existing partners have not accepted.
//
// CHANGING THE TERMS: bump the version. Do not edit clauses in place. Partners
// on an older version keep their terms until they accept the new one.

// 1.1 (2026-09-18) — commission rate 20% → 15%, with every worked figure
// recalculated. 1.0 was never sent to anyone; the bump is still correct,
// because the version is what proves which text a partner accepted, and an
// edit in place would make that proof a lie if even one person had signed.
//
// Anyone on 1.0 keeps 20%. §7 commits us to 30 days' notice before changing an
// existing partner's rate, and to the change applying only to referrals made
// after it — so a 1.0 partner is not moved to 1.1 by this file changing.
export const PARTNER_AGREEMENT_VERSION = '1.1'

export interface AgreementSection {
  heading: string
  /** Paragraphs. */
  body?: string[]
  /** Bulleted points. */
  points?: string[]
}

export interface PartnerAgreement {
  version: string
  title: string
  intro: string[]
  sections: AgreementSection[]
  /** The sentence next to the tick box. */
  acceptLabel: string
}

export const PARTNER_AGREEMENT: PartnerAgreement = {
  version: PARTNER_AGREEMENT_VERSION,
  title: 'TactiCoach Partner Programme Agreement',
  intro: [
    'This agreement sets out how the TactiCoach Partner Programme works, what you earn, and what we each agree to. It is written to be readable first and legal second — if anything is unclear, ask before you accept.',
    'You have been invited to become a TactiCoach Partner because you have an audience of coaches who trust your recommendations. As a Partner you earn a share of the subscription revenue from every coach and club who joins TactiCoach through you.',
  ],
  sections: [
    {
      heading: '1. What this is',
      body: [
        'This is a commercial referral arrangement. It is not employment, and it is not a legal partnership in your business or ours. The title "Partner" describes the relationship and nothing more.',
        'It begins on the date you accept this agreement in the TactiCoach app, and continues until either of us ends it.',
      ],
    },
    {
      heading: '2. What you earn',
      body: [
        'You earn 15% of the subscription fee paid by every customer you refer, for 12 months from that customer\'s first payment.',
        'The 15% applies to what the customer actually pays, excluding VAT. If they use a discount, your share is 15% of the discounted amount — we pay you a share of money we received, not of a list price.',
      ],
      points: [
        'Pro, monthly — £2.99/mo — you earn £0.45/mo, up to £5.38 over 12 months',
        'Pro, annual — £29.99/yr — you earn £4.50',
        'Club, monthly — £24.99/mo — you earn £3.75/mo, up to £44.98 over 12 months',
        'Club, annual — £249/yr — you earn £37.35',
        'Prices are current at the date of this agreement and may change. Your percentage does not change with them.',
      ],
    },
    {
      heading: '3. Clubs are worth about eight coaches',
      body: [
        'It is worth being deliberate about where your time goes. Twenty coaches on Pro monthly, all staying a full year, earn you about £108. Three clubs on the annual plan earn you about £112 — from three conversations instead of twenty.',
        'If you have contacts at clubs, academies or county associations, that is where your effort is best spent.',
      ],
    },
    {
      heading: '4. Your TactiCoach account',
      body: [
        'While this agreement is active we give you a TactiCoach Pro account at no charge. You do not need a subscription to be a Partner.',
        'This is so you can actually use and demonstrate what you are recommending. The account is for your own coaching and demonstration use; it is not transferable, and it ends when this agreement ends.',
      ],
    },
    {
      heading: '5. Posting about TactiCoach',
      body: [
        'We expect you to post about TactiCoach at least twice a month — two feed posts on your main channel, in whatever form suits your audience: a drill you built, a session you planned, a board you animated.',
        'This is an expectation held in good faith, not a quota we will police. We are not going to count your posts or withhold commission over a quiet month. It is here so that both of us are clear about what this arrangement is for: you are not simply holding a discount code, you are recommending something you use.',
        'What you post is yours. We will never write it for you or ask you to say something you do not believe.',
      ],
    },
    {
      heading: '6. How referrals are tracked',
      points: [
        'You get a unique referral link and code. Either one credits the sale to you.',
        'A referral is credited to you if the customer subscribes within 60 days of first using your link or code.',
        'Attribution is decided once, when the account is created, and is not reassigned afterwards. If someone arrives through more than one partner, the link or code they used at signup wins.',
        'Customers who already have a TactiCoach account do not count as new referrals.',
        'Nothing is earned until that customer\'s first payment actually clears. Signing up earns nothing.',
      ],
    },
    {
      heading: '7. Getting paid',
      points: [
        'Commission is calculated monthly, in arrears, on payments that have actually cleared.',
        'We pay once your balance reaches £50. Below that it rolls over to the following month.',
        'You invoice us for the amount shown in your partner statement in the app; we pay within 30 days of a correct invoice.',
        'You are responsible for your own tax, and for VAT if you are registered. Commission figures are stated excluding VAT.',
        'If a customer refunds, charges back, or is found to have subscribed fraudulently, the commission for that sale is reversed and deducted from your next statement.',
      ],
    },
    {
      heading: '8. What we ask of you',
      body: [
        'These are the rules that protect both of us. Breaking them can end this agreement immediately.',
      ],
      points: [
        'Be honest about the product. Do not promise features that do not exist or results we have not claimed.',
        'Disclose that your promotion is paid. Use #ad, "paid partnership", or the equivalent on the platform you are posting on. This is a legal requirement in the UK, not a courtesy — and undisclosed promotion damages your reputation as much as ours.',
        'No spam. No unsolicited bulk email, no automated posting, no posting your code into communities that have not invited it.',
        'No paid search advertising on the TactiCoach brand name or close variations of it.',
        'Do not present yourself as an employee of TactiCoach, or make commitments on our behalf.',
        'Do not refer yourself, your own accounts, or accounts you control.',
      ],
    },
    {
      heading: '9. What we agree to',
      points: [
        'Give you a working link, code and a statement you can check in the app at any time.',
        'Give you a TactiCoach Pro account at no charge for as long as this agreement is active.',
        'Tell you at least 30 days before we change your commission rate. Any change applies only to referrals made after it takes effect.',
        'Give you reasonable use of the TactiCoach name and logo for the purpose of promoting us, on the terms above. That permission ends when this agreement ends.',
        'Honour commission on referrals you have already made, even if the programme itself ends.',
      ],
    },
    {
      heading: '10. Ending it',
      body: [
        'Either side may end this agreement at any time with 30 days\' written notice. We may end it immediately if the rules in section 8 are broken.',
        'If it ends, your free Pro account ends with it, but you keep earning commission on customers you referred before it ended, until each of their 12-month windows closes.',
        'This arrangement is non-exclusive. We may work with other partners, and you may promote other products.',
      ],
    },
    {
      heading: '11. Legal',
      points: [
        'Nothing here creates an employment relationship, a legal partnership, a joint venture, or an agency.',
        'Neither side is liable to the other for indirect or consequential losses. Nothing limits liability that cannot lawfully be limited.',
        'This agreement is governed by the laws of England and Wales and subject to the courts of that jurisdiction.',
        'This document is the whole agreement between us and replaces any earlier discussion about commission.',
      ],
    },
  ],
  acceptLabel:
    'I have read this agreement and I accept it. I understand that accepting it here has the same effect as signing it.',
}
