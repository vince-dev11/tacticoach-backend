// COACH-COUNTRY (26 Oct 2026): "Country you coach in" — on a coach (their
// own) and on a club (the default its coaches start from; a coach's own
// choice wins). It changes SUGGESTIONS only — the format hint and how age
// groups are named — never the language and never the coach's chosen format.
//
// Codes are ISO 3166-1 alpha-2, except that football in the United Kingdom is
// four associations with four sets of youth rules, so GB is replaced by the
// ISO 3166-2 codes for its nations. The web app keeps an identical list
// (src/lib/countries.ts); tests/coach-country.test.ts keeps the two in step.

const ISO = (
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
  'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR ' +
  'GA GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP ' +
  'KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS ' +
  'MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS ' +
  'RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW ' +
  'TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW'
).split(' ')

/** The four UK football nations, in place of GB. */
export const UK_NATIONS = ['GB-ENG', 'GB-SCT', 'GB-WLS', 'GB-NIR'] as const

export const COUNTRY_CODES: readonly string[] = [...UK_NATIONS, ...ISO]

const SET = new Set(COUNTRY_CODES)
export function isCountryCode(v: unknown): v is string {
  return typeof v === 'string' && SET.has(v)
}
