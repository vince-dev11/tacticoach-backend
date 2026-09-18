// The Referral Programme Terms — the single source of the words.
//
// Same reasoning as the partner agreement: it lives in code so that when
// somebody asks what they agreed to, we can show the exact text they saw.
// `REFERRAL_AGREEMENT_VERSION` is stored against the acceptance, so editing
// this file never rewrites history — it creates a version nobody has accepted
// yet.
//
// CHANGING THE TERMS: bump the version. Do not edit clauses in place.
//
// DELIBERATELY NO NUMBERS FOR THE LADDER. How many referrals earn how many
// months varies by what the referrer is on (coach or club) and what they
// brought in (coach, club or player) — six different ladders. Copying any of
// them into this text would be six more figures to keep in step, and we have
// just spent an afternoon fixing exactly that failure in the partner
// agreement, where the document promised 20% while the system paid 15%.
//
// So this document states the RULES, which are stable, and points at the
// Referrals page for the numbers, which are not. The page renders them from
// lib/referral-ladder, which is the thing that actually decides them.

export const REFERRAL_AGREEMENT_VERSION = '1.0'

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
    'This is not the Partner Programme. Referrers earn credit against their own subscription; Partners are paid commission in cash and are invited individually. If you have an audience and would rather be paid, ask us about becoming a Partner instead.',
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
        'Free months of TactiCoach, added to your own subscription. How many depends on how many people you refer and what they subscribe to — the current ladder is shown on your Referrals page, and it is the one that applies.',
        'Free months are credit, not money. They have no cash value, cannot be exchanged for a refund, and cannot be transferred to another account.',
      ],
      points: [
        'A club subscription is worth about eight coach subscriptions, so it sits far further up the ladder.',
        'If you are on the Club plan yourself, your rungs are longer — a free Club month is worth more than a free Pro month.',
        'Months are added to your renewal date. If you are mid-term, they extend it rather than refunding anything.',
      ],
    },
    {
      heading: '3. When a referral counts',
      body: [
        'A referral counts when the person you referred makes their first payment — not when they sign up, and not when they start a trial. Creating accounts costs nothing, so nothing is earned for creating them.',
        'Each person can be referred once. Whoever their account is attributed to at signup is the referrer, and that is decided once and not reassigned.',
      ],
      points: [
        'If they refund, charge back, or are found to have subscribed fraudulently, that referral is reversed.',
        'If a reversal takes you below a rung you had already been paid for, the free months for that rung are withdrawn.',
        'You cannot refer yourself, anyone else in your own club, or an account you control.',
      ],
    },
    {
      heading: '4. Playing fair',
      body: [
        'Recommend us to people who would genuinely benefit. That is the whole programme.',
      ],
      points: [
        'No spam — no unsolicited bulk email, no comment spam, no messaging people who have not asked.',
        'No paid search advertising on "TactiCoach" or anything close to it.',
        'No pretending to be us. Do not use our name in a way that suggests you are TactiCoach, and do not create accounts, pages or profiles that look official.',
        'No fake accounts, no self-referrals, no trading codes for money.',
        'If you break these, we may withdraw unclaimed rewards and remove you from the programme. We will tell you why.',
      ],
    },
    {
      heading: '5. What you can see about the people you refer',
      body: [
        'Your Referrals page shows their first name, whether they have converted, and when they joined. Not their email address, not their phone number, and nothing about how they use TactiCoach.',
        'They are our customer and their data is theirs. Referring somebody does not give you access to their account or their information.',
      ],
    },
    {
      heading: '6. Changing or ending the programme',
      body: [
        'We may change the ladder or these terms. Any change applies to referrals made after it takes effect — never to ones you have already made.',
      ],
      points: [
        'Free months you have already earned stay yours, even if the programme ends.',
        'Referrals already made and still within their qualifying window continue to count.',
        'You can stop at any time by simply not using your link. There is nothing to cancel.',
      ],
    },
    {
      heading: '7. The ordinary legal bits',
      body: [
        'This is not employment, agency or a legal partnership. You are recommending a product you use, and we are thanking you for it.',
        'These terms are governed by the law of England and Wales.',
        'If any part of this turns out to be unenforceable, the rest still stands.',
      ],
    },
  ],
  acceptLabel: 'I have read and accept the Referral Programme Terms',
}
