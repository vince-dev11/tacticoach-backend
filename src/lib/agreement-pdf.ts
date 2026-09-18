// The signed agreement, as a PDF.
//
// Rendered ON DEMAND from the stored acceptance rather than written to a file
// when somebody signs. A contract you can only download in the ten seconds
// after signing is not much of a contract — this one can be produced again in
// two years, from the same row that proves it happened, and it will say the
// same thing because the clause text lives in code and is never edited in
// place (see partner-agreement.ts and referral-agreement.ts).
//
// pdfkit rather than headless Chrome: no browser to install on the server, no
// page to screenshot, and text that stays selectable and searchable in the
// finished document.

import PDFDocument from 'pdfkit'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import type { SignedRecord } from './agreements.js'

interface AgreementSection {
  heading: string
  body?: string[]
  points?: string[]
}
interface AgreementDoc {
  version: string
  title: string
  intro: string[]
  sections: AgreementSection[]
  acceptLabel: string
}

// ---- Fonts ------------------------------------------------------------------
// Liberation Sans, bundled in the repo. pdfkit's built-in Helvetica is
// WinAnsi-encoded and cannot draw ş, ğ, ı or ł — and the signer's name is
// validated as "any Latin script", for a product sold first in Turkey. A
// document that mangles the name on the signature line is worse than no PDF.

const HERE = path.dirname(fileURLToPath(import.meta.url))
// dist/lib at runtime, src/lib in tests — assets sits beside both.
const FONT_DIR = path.resolve(HERE, '../../assets/fonts')
const REGULAR = path.join(FONT_DIR, 'LiberationSans-Regular.ttf')
const BOLD = path.join(FONT_DIR, 'LiberationSans-Bold.ttf')

// ---- Palette ----------------------------------------------------------------
// The app's own colours. A signed agreement that looks like a generic legal
// template is a missed chance to look like the thing it came from.
const INK = '#16202f'
const MUTED = '#5b6577'
const HAIRLINE = '#dfe4ec'
const BRAND = '#00875a'
const BRAND_SOFT = '#e8f6f0'

const PAGE = { size: 'A4' as const, margin: 56 }

export async function renderSignedAgreement(
  doc: AgreementDoc,
  record: SignedRecord,
): Promise<Buffer> {
  const pdf = new PDFDocument({
    ...PAGE,
    info: {
      Title: `${doc.title} — signed`,
      Author: 'TactiCoach',
      Subject: `Version ${record.version}`,
      CreationDate: record.signedAt,
    },
    // Page numbering is added per page below, so let pdfkit not add pages
    // implicitly behind our back while we are measuring.
    bufferPages: true,
  })
  pdf.registerFont('body', REGULAR)
  pdf.registerFont('bold', BOLD)

  const chunks: Buffer[] = []
  pdf.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<Buffer>((resolve) => {
    pdf.on('end', () => resolve(Buffer.concat(chunks)))
  })

  const left = PAGE.margin
  const width = pdf.page.width - PAGE.margin * 2

  // ---- Masthead -------------------------------------------------------------
  pdf.font('bold').fontSize(9).fillColor(BRAND)
     .text('T A C T I C O A C H', left, PAGE.margin, { characterSpacing: 1.2 })

  pdf.moveDown(1.6)
  pdf.font('bold').fontSize(23).fillColor(INK).text(doc.title, { width, lineGap: 2 })

  // A "signed" chip rather than a line of small print: the first thing anyone
  // opening this file wants to know is whether it is executed.
  pdf.moveDown(0.8)
  const chipY = pdf.y
  const chipText = `Signed ${formatStamp(record.signedAt)}`
  const chipW = pdf.font('bold').fontSize(9).widthOfString(chipText) + 20
  pdf.roundedRect(left, chipY, chipW, 20, 10).fill(BRAND_SOFT)
  pdf.fillColor(BRAND).text(chipText, left + 10, chipY + 6)

  const versionText = `Version ${record.version}`
  pdf.font('body').fontSize(9).fillColor(MUTED)
     .text(versionText, left + chipW + 12, chipY + 6)

  pdf.y = chipY + 20
  pdf.moveDown(1.2)
  rule(pdf, left, width)
  pdf.moveDown(1.2)

  // ---- Intro ----------------------------------------------------------------
  for (const para of doc.intro) {
    pdf.font('body').fontSize(10.5).fillColor(INK)
       .text(para, left, pdf.y, { width, align: 'left', lineGap: 3.4 })
    pdf.moveDown(0.7)
  }

  // ---- Clauses --------------------------------------------------------------
  for (const section of doc.sections) {
    // Keep a heading with at least a couple of lines of its clause rather than
    // stranding it alone at the foot of a page.
    if (pdf.y > pdf.page.height - PAGE.margin - 90) pdf.addPage()

    pdf.moveDown(0.6)
    pdf.font('bold').fontSize(12).fillColor(INK)
       .text(section.heading, left, pdf.y, { width })
    pdf.moveDown(0.45)

    for (const para of section.body ?? []) {
      pdf.font('body').fontSize(10.5).fillColor(INK)
         .text(para, left, pdf.y, { width, lineGap: 3.4 })
      pdf.moveDown(0.5)
    }

    for (const point of section.points ?? []) {
      const dotX = left + 3
      const textX = left + 16
      const y = pdf.y
      pdf.font('body').fontSize(10).fillColor(MUTED)
      // The dot is drawn on the first line's baseline, so a point that wraps
      // to three lines still has its marker beside the first of them.
      pdf.circle(dotX + 2, y + 5.5, 2).fill(BRAND)
      pdf.fillColor(MUTED)
         .text(point, textX, y, { width: width - (textX - left), lineGap: 3 })
      pdf.moveDown(0.35)
    }
  }

  // ---- Signature block ------------------------------------------------------
  // The part everybody turns to. Given its own space rather than tucked under
  // the last clause: if it does not fit, it gets a page.
  const BLOCK_H = 210
  if (pdf.y > pdf.page.height - PAGE.margin - BLOCK_H) pdf.addPage()

  pdf.moveDown(1.6)
  const boxY = pdf.y
  pdf.roundedRect(left, boxY, width, BLOCK_H - 20, 8)
     .lineWidth(1).strokeColor(HAIRLINE).stroke()

  const padX = left + 22
  const innerW = width - 44

  pdf.font('bold').fontSize(8.5).fillColor(MUTED)
     .text('ACCEPTED AND AGREED', padX, boxY + 18, { characterSpacing: 1 })

  pdf.font('body').fontSize(10).fillColor(INK)
     .text(doc.acceptLabel, padX, boxY + 34, { width: innerW, lineGap: 2.5 })

  // The drawn signature, sized to fit its slot without distortion. Failing to
  // decode must not lose the rest of the document — the printed name, the
  // timestamp and the version are the parts that carry the legal weight.
  const sigTop = boxY + 74
  let drew = false
  if (record.signature) {
    try {
      const base64 = record.signature.split(',')[1] ?? ''
      // `fit` preserves the aspect ratio inside the box, which is what stops a
      // wide signature being squashed into a tall slot. No `align` — pdfkit
      // only accepts centre/right there, and left is the default anyway.
      pdf.image(Buffer.from(base64, 'base64'), padX, sigTop, {
        fit: [220, 62],
        valign: 'bottom',
      })
      drew = true
    } catch {
      /* unreadable image — the block below still stands on its own */
    }
  }
  if (!drew) {
    pdf.font('body').fontSize(9).fillColor(MUTED)
       .text('(signature image unavailable)', padX, sigTop + 40)
  }

  // Signature rule, then the printed name under it — the convention everybody
  // recognises from paper.
  const ruleY = sigTop + 68
  pdf.moveTo(padX, ruleY).lineTo(padX + 240, ruleY)
     .lineWidth(1).strokeColor(INK).stroke()

  pdf.font('bold').fontSize(11).fillColor(INK)
     .text(record.signerName ?? '—', padX, ruleY + 8, { width: 240 })
  pdf.font('body').fontSize(8.5).fillColor(MUTED)
     .text('Name of signatory', padX, ruleY + 24)

  // Facts of execution, in a column beside the signature.
  const metaX = padX + 270
  const metaW = innerW - 270
  let metaY = sigTop + 4
  for (const [label, value] of [
    ['Date and time', formatStamp(record.signedAt)],
    ['Agreement version', record.version],
    ['Recorded IP', record.ip ?? 'not recorded'],
  ] as const) {
    pdf.font('body').fontSize(8).fillColor(MUTED).text(label.toUpperCase(), metaX, metaY, { width: metaW, characterSpacing: 0.6 })
    pdf.font('bold').fontSize(10).fillColor(INK).text(value, metaX, metaY + 11, { width: metaW })
    metaY += 32
  }

  // ---- Footers --------------------------------------------------------------
  // Added last, over every page, so the count is known.
  const range = pdf.bufferedPageRange()
  for (let i = 0; i < range.count; i++) {
    pdf.switchToPage(range.start + i)

    // The bottom margin has to come off first.
    //
    // A footer sits BELOW the bottom margin by definition, and pdfkit treats
    // any text written past that boundary as content that did not fit — so it
    // helpfully adds a page, which then needs its own footer, and so on. The
    // first render of this document came out six pages long with "Page 2 of 2"
    // printed on the last one, which is exactly what that looks like.
    const bottom = pdf.page.margins.bottom
    pdf.page.margins.bottom = 0

    const y = pdf.page.height - PAGE.margin + 16
    pdf.font('body').fontSize(8).fillColor(MUTED)
    pdf.text('TactiCoach · app.tacticoach.co.uk', left, y, { width: width / 2, lineBreak: false })
    pdf.text(`Page ${i + 1} of ${range.count}`, left + width / 2, y, {
      width: width / 2,
      align: 'right',
      lineBreak: false,
    })

    pdf.page.margins.bottom = bottom
  }

  pdf.end()
  return done
}

function rule(pdf: PDFKit.PDFDocument, x: number, w: number) {
  pdf.moveTo(x, pdf.y).lineTo(x + w, pdf.y).lineWidth(1).strokeColor(HAIRLINE).stroke()
}

/**
 * "18 September 2026 at 14:32 UTC".
 *
 * UTC, and labelled as such. A timestamp on a contract that silently renders
 * in whatever timezone the server happens to be in is a timestamp two parties
 * can read differently.
 */
function formatStamp(at: Date): string {
  const date = at.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  })
  const time = at.toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  })
  return `${date} at ${time} UTC`
}
