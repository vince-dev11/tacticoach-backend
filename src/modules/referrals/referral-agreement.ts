// The Referral Programme Terms — the single source of the words.
//
// Same reasoning as the collaboration agreement: it lives in code so that when
// somebody asks what they agreed to, we can show the exact text they saw.
// `REFERRAL_AGREEMENT_VERSION` is stored against the acceptance, so editing
// this file never rewrites history — it creates a version nobody has accepted
// yet.
//
// CHANGING THE TERMS: bump the version. Do not edit clauses in place.
//
// ---- Why there are almost no numbers in here ------------------------------
//
// DELIBERATELY NO RATES. How many referrals earn how many months is computed
// from prices, per pair of plans — twenty-five combinations at the last count,
// and every one of them moves when a price does. Copying any of them into this
// text would be twenty-five more figures to keep in step, and that is exactly
// the failure we spent an afternoon fixing in the collaboration agreement
// (then called the partner agreement), where the document promised one
// commission rate while the system paid another.
//
// So this document states the RULES, which are stable, and points at the
// Referrals page for the numbers, which are not. The page renders them from
// lib/referral-ladder, which is the thing that actually decides them.
//
// THE ONE EXCEPTION is the cap. `REWARD_CAP_PERCENT` is a single constant that
// every rate is derived FROM rather than a figure derived from anything else,
// and it is interpolated here rather than typed, so it cannot drift. It earns
// its place because it is the most reassuring thing we can say: there is one
// rule, it applies to everybody, and here it is.

import { REWARD_CAP_PERCENT } from '../../lib/referral-ladder.js'

/**
 * Bumped from 1.0 on 22 September 2026.
 *
 * Not a tidy-up. Three rules changed in ways somebody who accepted 1.0 has not
 * agreed to: what decides the reward (both plans, not two tiers), when a
 * monthly customer's referral counts (their second payment, not their first),
 * and that cancelling does not claw a reward back. Anyone on 1.0 is asked to
 * accept 2.0 before referring again — which is what the version column is for.
 */
export const REFERRAL_AGREEMENT_VERSION = '2.1'

export interface AgreementSection {
  heading: string
  body?: string[]
  points?: string[]
}

export interface Agreement {
  version: string
  title: string
  intro: string[]
  sections: AgreementSection[]
  acceptLabel: string
}

export const REFERRAL_AGREEMENT: Agreement = {
  version: REFERRAL_AGREEMENT_VERSION,
  title: 'TactiCoach Referral Programme Terms',
  intro: [
    'These are the terms for the TactiCoach Referral Programme, where you earn free months on your own subscription by introducing other coaches and clubs. They are short on purpose, and written to be read.',
    'This is not the Collaboration Programme. Referrers earn credit against their own subscription; Collaborators are paid commission in cash and are invited individually. If you have an audience and would rather be paid, ask us about becoming a Collaborator instead.',
  ],
  sections: [
    {
      heading: '1. What this is',
      body: [
        'You get a personal invite code and link. When someone joins TactiCoach through it and starts paying, you earn free months on your own subscription.',
        'It begins when you accept these terms and continues until you stop using the programme or we end it.',
      ],
    },
    {
      heading: '2. What you earn',
      body: [
        'Free months of TactiCoach, added to your own subscription. How many depends on two things: the plan you are on, and the plan the person you introduced bought. Your Referrals page shows the current figures for every combination, and those are the ones that apply.',
        `There is one rule behind all of them: a referral never earns you more than ${REWARD_CAP_PERCENT}% of what that customer pays us in their first year. Every figure on the Referrals page is worked out from that, which is why they differ — and why they change when prices change.`,
        'Free months are credit, not money. They have no cash value, cannot be exchanged for a refund, and cannot be transferred to another account or another person.',
      ],
      points: [
        'The plan YOU are on matters because a free month is worth far more on a large club plan than on Basic. A bigger plan therefore earns fewer months for the same introduction — the reward is the same size, it simply buys less of a dearer month.',
        'The plan THEY bought matters because it is what the cap is measured against. Introducing a club is worth considerably more than introducing an individual coach.',
        'Months are added to your renewal date. If you are mid-term they extend it rather than refunding anything, and if you pay by card the credit comes off your next invoice instead.',
        'Earned months do not expire, and they stay yours if you change plan or if we end the programme.',
      ],
    },
    {
      heading: '3. When a referral counts',
      body: [
        'A referral counts when the person you introduced actually pays — not when they sign up, and not when they start a trial. Creating accounts costs nothing, so nothing is earned for creating them.',
        'If they bought an annual subscription, their first payment is the one that counts: the year is paid up front. If they pay monthly, it is their second payment that counts, because one monthly instalment can be less than the reward itself. That is the only reason for the wait, and your Referrals page says when someone is between the two.',
        'Each person can be referred once, and earns you one reward. Their renewals and later payments do not earn again.',
        'Whoever their account is attributed to at signup is the referrer, and that is decided then and not reassigned.',
      ],
      points: [
        'Both plans are recorded when the referral counts, and neither is revisited. If you change plan afterwards, everything already earned stays as it was earned, and the new rate applies from then on.',
        'The same is true of them: someone who upgrades later already earned you the reward for what they actually bought.',
        'If you are on the free tier your referrals are held rather than lost. They settle in full the moment you start paying.',
        'You cannot refer yourself, anyone else on your own club account, or an account you control.',
      ],
    },
    {
      heading: '4. When a reward is taken back',
      body: [
        'Only when the money comes back to them. If a referred customer refunds, charges back, or is found to have subscribed fraudulently, that referral stops counting and any reward for it that you have not yet used is withdrawn.',
        'A reward you have already spent is left alone. We would rather absorb the occasional refund than take back a free month you have already had.',
      ],
      points: [
        'Cancelling is not a refund. If somebody you introduced pays for a while and then leaves, they still paid, and what you earned is yours. We do not claw rewards back for customers who simply stop.',
        'Breaking section 5 is the other way a reward can be withdrawn, and we will tell you why.',
      ],
    },
    {
      heading: '5. Playing fair',
      body: [
        'Recommend us to people who would genuinely benefit. That is the whole programme.',
      ],
      points: [
        'No spam — no unsolicited bulk email, no comment spam, no messaging people who have not asked.',
        'No paid search advertising on "TactiCoach" or anything close to it.',
        'No pretending to be us. Do not use our name in a way that suggests you are TactiCoach, and do not create accounts, pages or profiles that look official.',
        'No fake accounts, no self-referrals, no trading codes for money.',
        'If you break these, we may withdraw unclaimed rewards and remove you from the programme.',
      ],
    },
    {
      heading: '6. What you can see about the people you refer',
      body: [
        'Your Referrals page shows their first name, which plan they took, whether they have started paying, and when they joined. Not their email address, not their phone number, and nothing about how they use TactiCoach.',
        'They are our customer and their data is theirs. Referring somebody does not give you access to their account or their information, and you must not present yourself to them as having any.',
      ],
    },
    {
      heading: '7. Tax',
      body: [
        'What you earn is a discount on your own subscription, not a payment to you. We do not pay you anything and we do not report anything to a tax authority on your behalf.',
        'If you are in business and your own tax position is affected by receiving a discount, that is a matter for you and your accountant. We cannot advise on it.',
      ],
    },
    {
      heading: '8. Changing or ending the programme',
      body: [
        'We may change what referrals earn, or these terms. A change to the figures follows from the rule in section 2 and takes effect for referrals made after it applies — never for ones that have already counted.',
        'A change to these terms creates a new version, and you will be asked to accept it before referring again. It does not alter what you agreed to before.',
      ],
      points: [
        'Free months you have already earned stay yours, even if the programme ends.',
        'Referrals already made and still waiting to count continue to count on the terms in force when you made them.',
        'You can stop at any time by simply not using your link. There is nothing to cancel.',
      ],
    },
    {
      heading: '9. The ordinary legal bits',
      body: [
        'This is not employment, agency or a legal partnership. You are recommending a product you use, and we are thanking you for it.',
        'These terms sit alongside our Terms of Service, which govern your subscription itself. Where the two genuinely conflict about the referral programme, this document applies.',
        'These terms are governed by the law of England and Wales, and the courts of England and Wales have exclusive jurisdiction.',
        'If any part of this turns out to be unenforceable, the rest still stands.',
      ],
    },
  ],
  acceptLabel: 'I have read and accept the Referral Programme Terms',
}
