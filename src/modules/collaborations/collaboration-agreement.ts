// The Collaboration Programme Agreement — the single source of the words.
//
// It lives in code rather than in a CMS or a Word file on somebody's desktop
// for one reason: when a collaborator disputes what they agreed to, we have to
// show the exact text they saw. `COLLABORATION_AGREEMENT_VERSION` is stored on
// the collaborator row and in `agreement_acceptances` at acceptance, so
// changing this file never rewrites history — it creates a version nobody has
// accepted yet.
//
// CHANGING THE TERMS: bump the version. Do not edit clauses in place.
//
// ---- Why this is v1.0 and not v1.2 ----------------------------------------
//
// This document replaces the Partner Programme Agreement (1.0 and 1.1). It is
// a NEW document, not the next version of that one, because three things
// changed that no previous signer agreed to:
//
//   * THE NAME. In England and Wales a partnership is a legal entity whose
//     members are jointly liable for one another's debts, which is why the old
//     text had to spend a clause denying it was one. "Collaborator" needs no
//     such disclaimer.
//   * THE RATES. One flat rate became two — a coach rate and a club rate — and
//     which applies is resolved per payment rather than fixed at the start.
//   * THE CADENCE. Payouts moved to three fixed dates a year, and the content
//     expectation became a stated number reviewed at each of them.
//
// Anyone on a partner version is asked to accept this before continuing. Their
// earned commission is untouched; only the terms they operate under change.
//
// ---- The numbers in here are INTERPOLATED, never typed ---------------------
//
// The old agreement said 20% while the system paid 15%, because the figure was
// hand-written in one place and stored in another. Every figure below comes
// from the constants the code actually uses, and a test asserts that no other
// percentage or money amount appears in the text.

import {
  DEFAULT_COACH_RATE,
  DEFAULT_CLUB_RATE,
  PAYOUT_THRESHOLD_PENCE,
  CONTENT_PER_CYCLE,
  CONTENT_VIDEO_MINIMUM,
} from './collaboration-terms.js'

export const COLLABORATION_AGREEMENT_VERSION = '1.1'

const pct = (fraction: number) => `${Math.round(fraction * 100)}%`
const pounds = (pence: number) => `£${(pence / 100).toFixed(0)}`

export interface AgreementSection {
  heading: string
  /** Paragraphs. */
  body?: string[]
  /** Bulleted points. */
  points?: string[]
}

export interface CollaborationAgreement {
  version: string
  title: string
  intro: string[]
  sections: AgreementSection[]
  /** The sentence next to the signature. */
  acceptLabel: string
}

export const COLLABORATION_AGREEMENT: CollaborationAgreement = {
  version: COLLABORATION_AGREEMENT_VERSION,
  title: 'TactiCoach Collaboration Programme Agreement',
  intro: [
    'This agreement sets out how the TactiCoach Collaboration Programme works, what you earn, and what we each agree to. It is written to be readable first and legal second — if anything is unclear, ask before you sign it.',
    'You are here because coaches trust what you recommend. In return for telling them about TactiCoach, you earn a share of what every coach and club who joins through you actually pays us.',
    'This is not the Referral Programme. Referrers are customers who earn free months against their own subscription. Collaborators are paid in cash and hold a free account instead. You cannot be on both at once — while this agreement is active, you earn commission rather than credit.',
  ],
  sections: [
    {
      heading: '1. What this is, and what it is not',
      body: [
        'You recommend TactiCoach to coaches and clubs. When somebody joins through your link or code and pays us, you earn a share of what they pay.',
        'This is a commercial arrangement between two independent businesses. It is not employment, it is not agency, and it is not a legal partnership in your business or ours. You decide what you say, where you say it, and when.',
      ],
      points: [
        'It starts when you sign this agreement, not when we invite you.',
        'It is non-exclusive. We work with other collaborators, and you may promote other products.',
        'You are responsible for your own tax and, if you are registered, your own VAT.',
      ],
    },
    {
      heading: '2. What you earn',
      body: [
        `You earn ${pct(DEFAULT_COACH_RATE)} of what an individual coach pays, and ${pct(DEFAULT_CLUB_RATE)} of what a club pays, excluding VAT, on that customer's FIRST payment only.`,
        // The rule the constant states, spelled out so nobody has to infer it.
        'One payment per customer. Renewals, later monthly instalments and upgrades do not earn again: you are paid for the introduction, and the product earns the renewals. A customer who buys a year up front therefore earns you a year’s worth in one line; one who pays monthly earns you their first month.',
        'A club is worth more because it is a harder sale, not simply a bigger one: it goes through a committee and takes months rather than minutes. A percentage already pays you more for a larger customer; the extra is for the work.',
      ],
      points: [
        'Which rate applies is decided by the plan that first payment is FOR: a coach plan pays the coach rate, a club plan the club rate.',
        'It is a share of what they ACTUALLY pay, after any discount they used. A free trial that never converts earns nothing.',
        'The rate in force is recorded on every line of your statement when it is written. If we ever change your rates, past lines are never restated.',
        'We will give you notice in writing before changing your rates, and a change applies only to payments made after it takes effect.',
      ],
    },
    {
      heading: '3. Your free TactiCoach account',
      body: [
        'While this agreement is active we give you a TactiCoach Pro account at no charge. You do not need a subscription to be a collaborator — you cannot recommend a product you have no way to open.',
        'It ends when the collaboration ends. If you were paying for your own subscription before, that subscription is unaffected and is not replaced by this one.',
      ],
    },
    {
      heading: '4. How you get paid',
      body: [
        'We pay three times a year, on 1 February, 1 June and 1 October, covering everything earned up to the end of the previous month.',
        `If your balance is under ${pounds(PAYOUT_THRESHOLD_PENCE)} at a payout date it rolls over to the next one. Whatever the balance, we pay it in full on the last payout of each year and when this agreement ends — so nothing is ever left with us indefinitely.`,
      ],
      points: [
        'Commission earned early in a period waits until that period’s payout date. That can be up to four months. We would rather say so here than have it be a surprise.',
        'You invoice us, or we self-bill by agreement. Either way you are paid in pounds sterling to a UK bank account.',
        'Nothing is owed until the customer’s payment has actually cleared.',
      ],
    },
    {
      heading: '5. What we ask you to post',
      body: [
        `We ask for ${CONTENT_PER_CYCLE} pieces of content in each payout period — roughly one a month — and at least ${CONTENT_VIDEO_MINIMUM} of them should be a video or reel.`,
        'The video matters more than the number. What TactiCoach makes IS video — animated boards, exported reels — and one clip of a board actually moving shows more than four screenshots. You already have the export; it costs you nothing extra.',
      ],
      points: [
        'A piece counts when TactiCoach is visibly the subject or clearly in use, it is tagged @tacticoach or carries your link, it is on your own public channel, and it stays up for at least 30 days.',
        'Stories do not count towards the number. They are welcome, but they disappear and cannot be checked later.',
        'You write it. We do not script it, we do not approve it in advance, and we would rather you said something true than something flattering.',
        'Disclose that it is a paid arrangement — #ad, "paid partnership", or whatever the platform expects. That is a legal requirement in the UK, and undisclosed promotion damages your reputation more than ours.',
      ],
    },
    {
      heading: '6. What happens if you do not post',
      body: [
        'Nothing is withheld. Commission you have earned is yours — you earned it by introducing a paying customer, and it is not held hostage to anything else.',
        'Instead we look at it at each payout. If you have missed a period we will say so and ask what is going on. If you miss two periods running, we will end the collaboration on the notice in section 9.',
        'You keep everything earned up to that point, including trailing commission under section 9.',
      ],
    },
    {
      heading: '7. Being listed on our website',
      body: [
        'If you choose to be listed, we publish your name, role, club or organisation, town or county, a photograph, a short description, and any links you give us. This is optional and it is not a condition of anything else here.',
        'You can ask to be removed at any time and we will take the entry down. You do not have to give a reason.',
      ],
      points: [
        'Nothing about players. No names, photographs or details of any child, and no links to pages that identify them. This is not negotiable and we will remove anything that breaches it without waiting to discuss it.',
        'We review what is published before it goes live, and we may decline or edit an entry.',
        'You confirm you have the right to give us whatever you send, including any photograph of yourself and any logo you ask us to use.',
      ],
    },
    {
      heading: '8. Playing fair',
      body: [
        'Recommend us to people who would genuinely benefit. That is the whole arrangement.',
      ],
      points: [
        'No commission on yourself, your own club, an account you control, or anybody already in discussions with us.',
        'No spam — no unsolicited bulk email, no comment spam, no messaging people who have not asked.',
        'No paid search advertising on "TactiCoach" or anything close to it.',
        'No pretending to be us. Do not use our name in a way that suggests you are TactiCoach, and do not create accounts, pages or profiles that look official.',
        'Attribution is decided once, when the account is created, and is not reassigned. If somebody arrives through more than one collaborator, the link or code they used at signup wins.',
        'If a customer refunds or charges back, that line is reversed. We are not taking back money you were properly owed — the payment itself went back to them.',
      ],
    },
    {
      heading: '9. Ending it',
      body: [
        'Either of us can end this with 30 days’ notice in writing, for any reason or none.',
        'If you end it, or we end it for anything other than a breach of section 8, you are still paid for anyone you introduced before it ended whose first payment lands afterwards. Your free account stops.',
        'If we suspend you for a breach of section 8, commission stops accruing immediately while we look into it. If the breach is made out we may end the agreement and withhold commission not yet paid.',
      ],
    },
    {
      heading: '10. Your data and theirs',
      body: [
        'We show you the first name of each person who joined through you, whether they are paying, and what you earned. Not their email address, not their phone number, and nothing about how they use TactiCoach.',
        'They are our customer and their data is theirs. Introducing somebody does not give you access to their account, and you must not present yourself to them as having any.',
      ],
    },
    {
      heading: '11. The ordinary legal bits',
      body: [
        'Neither of us is liable to the other for indirect or consequential loss. Our total liability under this agreement is limited to the commission owed to you in the 12 months before the claim.',
        'This agreement is governed by the law of England and Wales, and the courts of England and Wales have exclusive jurisdiction.',
        'If any part of this turns out to be unenforceable, the rest still stands.',
        'This is the whole agreement between us about the Collaboration Programme, and it replaces anything said before it.',
      ],
    },
  ],
  acceptLabel: 'I have read and accept the Collaboration Programme Agreement',
}
