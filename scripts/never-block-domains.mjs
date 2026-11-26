// DISPOSABLE-EMAIL: never treated as throwaway, whatever a list says — real
// mail providers, and privacy relays that forward to a real inbox (Apple Hide
// My Email, Firefox Relay, DuckDuckGo, SimpleLogin, addy.io). Shared by the
// update script and the API (src/lib/email-checks.ts imports a copy).
export const NEVER_BLOCK = [
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'hotmail.co.uk', 'live.com', 'msn.com',
  'yahoo.com', 'yahoo.co.uk', 'ymail.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com',
  'proton.me', 'protonmail.com', 'pm.me', 'gmx.com', 'gmx.de', 'web.de', 'zoho.com', 'yandex.com', 'mail.com',
  'privaterelay.appleid.com', 'mozmail.com', 'duck.com', 'simplelogin.com', 'simplelogin.co', 'slmail.me',
  'aleeas.com', 'addy.io', 'anonaddy.com', 'anonaddy.me', 'passmail.net', 'passinbox.com',
  'tacticoach.co.uk', 'tacticoach.test',
]
