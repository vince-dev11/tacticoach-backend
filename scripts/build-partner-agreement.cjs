// Builds the Partner Programme Agreement .docx from src/modules/partners/
// partner-agreement.ts — the same data the app serves to a partner before they
// accept. Run it after editing that file:
//
//   node scripts/build-partner-agreement.cjs
//
// A printed copy exists for records and for anyone who prefers paper; the
// in-app acceptance is what actually activates a partner.
const fs = require('fs')
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  BorderStyle, LevelFormat, Table, TableRow, TableCell, WidthType, ShadingType,
} = require('docx')

// The agreement data is read out of the TypeScript source rather than kept in a
// second file, so the .docx and the screen can never say different things.
// Types are stripped so plain node can evaluate it — the alternative is a build
// step for a script that runs twice a year.
const SRC = require('path').join(__dirname, '..', 'src', 'modules', 'partners', 'partner-agreement.ts')
const A = (() => {
  let src = fs.readFileSync(SRC, 'utf8')
  src = src.replace(/export interface[\s\S]*?\n}\n/g, '')
  src = src.replace(/export const PARTNER_AGREEMENT: PartnerAgreement =/, 'const PARTNER_AGREEMENT =')
  src = src.replace(/export const PARTNER_AGREEMENT_VERSION/, 'const PARTNER_AGREEMENT_VERSION')
  const module_ = { exports: {} }
  new Function('module', 'exports', src + '\nmodule.exports = { PARTNER_AGREEMENT }')(module_, module_.exports)
  return module_.exports.PARTNER_AGREEMENT
})()

const GREEN = '00A76F'
const GREY = '6B7280'

const p = (text, opts = {}) =>
  new Paragraph({ spacing: { after: 160, line: 300 }, children: [new TextRun({ text, ...opts })] })

const kids = []

kids.push(new Paragraph({
  spacing: { after: 60 },
  children: [new TextRun({ text: A.title, bold: true, size: 34, color: '111827' })],
}))
kids.push(new Paragraph({
  spacing: { after: 320 },
  children: [new TextRun({ text: `Version ${A.version}`, size: 19, color: GREY })],
}))

for (const para of A.intro) kids.push(p(para, { size: 21 }))

for (const section of A.sections) {
  kids.push(new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 300, after: 140 },
    children: [new TextRun({ text: section.heading, bold: true, size: 24, color: '111827' })],
  }))
  for (const para of section.body ?? []) kids.push(p(para, { size: 21 }))
  for (const point of section.points ?? []) {
    kids.push(new Paragraph({
      numbering: { reference: 'bullets', level: 0 },
      spacing: { after: 90, line: 290 },
      children: [new TextRun({ text: point, size: 21 })],
    }))
  }
}

// ---- Signature block -------------------------------------------------------
kids.push(new Paragraph({
  heading: HeadingLevel.HEADING_2,
  spacing: { before: 420, after: 140 },
  children: [new TextRun({ text: 'Agreed', bold: true, size: 24, color: '111827' })],
}))
kids.push(p(A.acceptLabel, { size: 21 }))
kids.push(p(
  'Most partners accept this agreement in the TactiCoach app, which records the date, the version above and the IP address. This printed copy exists for your records and for anyone who prefers to sign on paper.',
  { size: 19, color: GREY, italics: true },
))

const W = 4600
const cell = (text, opts = {}) => new TableCell({
  width: { size: W, type: WidthType.DXA },
  margins: { top: 120, bottom: 120, left: 140, right: 140 },
  children: [new Paragraph({ children: [new TextRun({ text, size: 20, ...opts })] })],
})

kids.push(new Table({
  columnWidths: [W, W],
  width: { size: W * 2, type: WidthType.DXA },
  rows: [
    new TableRow({
      children: [
        new TableCell({
          width: { size: W, type: WidthType.DXA },
          shading: { type: ShadingType.CLEAR, fill: 'F3F4F6' },
          margins: { top: 120, bottom: 120, left: 140, right: 140 },
          children: [new Paragraph({ children: [new TextRun({ text: 'For TactiCoach', bold: true, size: 20 })] })],
        }),
        new TableCell({
          width: { size: W, type: WidthType.DXA },
          shading: { type: ShadingType.CLEAR, fill: 'F3F4F6' },
          margins: { top: 120, bottom: 120, left: 140, right: 140 },
          children: [new Paragraph({ children: [new TextRun({ text: 'Partner', bold: true, size: 20 })] })],
        }),
      ],
    }),
    ...['Name', 'Signature', 'Date', 'Business / trading name (if any)'].map((label) =>
      new TableRow({ children: [cell(`${label}:`, { color: GREY }), cell(`${label}:`, { color: GREY })] }),
    ),
  ],
}))

kids.push(new Paragraph({
  spacing: { before: 360 },
  alignment: AlignmentType.CENTER,
  children: [new TextRun({
    text: 'TactiCoach is a trading name of [COMPANY LEGAL NAME], [COMPANY NUMBER], [REGISTERED ADDRESS]. Questions: partners@tacticoach.co.uk',
    size: 17, color: GREY,
  })],
}))

const doc = new Document({
  numbering: {
    config: [{
      reference: 'bullets',
      levels: [{
        level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 460, hanging: 240 } } },
      }],
    }],
  },
  styles: { default: { document: { run: { font: 'Calibri', size: 21 } } } },
  sections: [{
    properties: { page: { margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 } } },
    children: kids,
  }],
})

const OUT = process.argv[2] ?? 'TactiCoach_Partner_Programme_Agreement.docx'
Packer.toBuffer(doc).then((b) => {
  fs.writeFileSync(OUT, b)
  console.log(`Partner agreement v${A.version} → ${OUT} (${b.length} bytes)`)
})
