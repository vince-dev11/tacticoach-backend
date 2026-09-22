// Builds BOTH agreements as .docx, from the same TypeScript the app serves.
//
//   node scripts/build-agreements.cjs [output-directory]
//
// One script for both, because they are the same document shape and two
// scripts means one of them gets fixed and the other does not. It reads the
// source rather than a second copy of the words, so a printed agreement and
// the screen can never say different things — which is the whole failure mode
// this exists to prevent.
//
// The in-app acceptance, with a drawn signature, is what actually starts
// anything. These files are for records, for anybody who prefers paper, and
// for sending to an accountant.

const fs = require('fs')
const path = require('path')
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  LevelFormat, Table, TableRow, TableCell, WidthType, ShadingType,
} = require('docx')

const SRC = path.join(__dirname, '..', 'src', 'modules')

/**
 * Evaluate a TypeScript agreement module in plain node.
 *
 * Types are stripped and imports are inlined rather than resolved — the
 * alternative is a build step for a script that runs twice a year. `deps` is
 * the list of sibling modules whose exported constants the agreement
 * interpolates; the collaboration agreement reads its rates from
 * collaboration-terms.ts, and evaluating it without them produces a document
 * full of `undefined%`.
 */
function loadAgreement({ file, exportName, deps = [] }) {
  // Dependencies are MINED for their numeric constants rather than evaluated.
  //
  // Evaluating them meant stripping every TypeScript-ism they happen to use —
  // `as const`, generics, return types — and the first one that did broke the
  // script with "Unexpected identifier 'as'". The agreements only ever
  // interpolate plain numbers, so pull exactly those out and leave the rest of
  // the module alone.
  const inlined = deps
    .flatMap((dep) => {
      const source = fs.readFileSync(dep, 'utf8')
      const found = [...source.matchAll(/export const ([A-Z][A-Z0-9_]*) = ([\d.]+)\b/g)]
      return found.map(([, name, value]) => `const ${name} = ${value}`)
    })
    .join('\n')

  let src = fs.readFileSync(file, 'utf8')
  src = src.replace(/^import[\s\S]*?from\s+'[^']+'\n/gm, '')
  src = src.replace(/export interface[\s\S]*?\n}\n/g, '')
  src = src.replace(/export type[^\n]*\n/g, '')
  src = src.replace(/export const/g, 'const')
  src = src.replace(/\s+as const/g, '')
  // Type annotations on the declarations we keep. Narrow on purpose: a blanket
  // `: Type =` strip would also eat object properties like `version: A.version`.
  src = src.replace(/const (\w+): (Agreement|CollaborationAgreement) =/g, 'const $1 =')
  // Parameter types on the little formatting helpers the agreements define —
  // `const pct = (fraction: number) => …`. Matched on the arrow-function shape
  // so nothing inside a string or an object literal is touched.
  src = src.replace(
    /const (\w+) = \(([^)]*)\)(:\s*\w+)? =>/g,
    (_m, name, args) => `const ${name} = (${args.replace(/:\s*[\w<>[\]|]+/g, '')}) =>`,
  )

  const module_ = { exports: {} }
  new Function('module', 'exports', `${inlined}\n${src}\nmodule.exports = { doc: ${exportName} }`)(
    module_,
    module_.exports,
  )
  const doc = module_.exports.doc

  // A document that evaluated but lost its numbers is worse than one that
  // threw: it looks finished and promises nothing. Catch it here.
  const text = JSON.stringify(doc)
  if (/undefined/.test(text) || /NaN/.test(text)) {
    throw new Error(
      `${path.basename(file)} rendered "undefined" or "NaN" — an interpolated constant did not resolve. ` +
        `Add its module to \`deps\`.`,
    )
  }
  return doc
}

const GREEN = '00A76F'
const GREY = '6B7280'

const p = (text, opts = {}) =>
  new Paragraph({ spacing: { after: 160, line: 300 }, children: [new TextRun({ text, ...opts })] })

function render(A, counterpartyLabel, contactEmail) {
  const kids = []

  kids.push(
    new Paragraph({
      spacing: { after: 60 },
      children: [new TextRun({ text: A.title, bold: true, size: 34, color: '111827' })],
    }),
  )
  kids.push(
    new Paragraph({
      spacing: { after: 320 },
      children: [new TextRun({ text: `Version ${A.version}`, size: 19, color: GREY })],
    }),
  )

  for (const para of A.intro) kids.push(p(para, { size: 21 }))

  for (const section of A.sections) {
    kids.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 300, after: 140 },
        children: [new TextRun({ text: section.heading, bold: true, size: 24, color: '111827' })],
      }),
    )
    for (const para of section.body ?? []) kids.push(p(para, { size: 21 }))
    for (const point of section.points ?? []) {
      kids.push(
        new Paragraph({
          numbering: { reference: 'bullets', level: 0 },
          spacing: { after: 90, line: 290 },
          children: [new TextRun({ text: point, size: 21 })],
        }),
      )
    }
  }

  // ---- Signature block -----------------------------------------------------
  kids.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 420, after: 140 },
      children: [new TextRun({ text: 'Agreed', bold: true, size: 24, color: GREEN })],
    }),
  )
  kids.push(p(A.acceptLabel, { size: 21 }))
  kids.push(
    p(
      `Most people accept this in the TactiCoach app, which records the date, the version above and the IP address. This printed copy exists for your records and for anyone who prefers to sign on paper.`,
      { size: 19, color: GREY, italics: true },
    ),
  )

  const W = 4600
  const cell = (text, opts = {}) =>
    new TableCell({
      width: { size: W, type: WidthType.DXA },
      margins: { top: 120, bottom: 120, left: 140, right: 140 },
      children: [new Paragraph({ children: [new TextRun({ text, size: 20, ...opts })] })],
    })
  const headCell = (text) =>
    new TableCell({
      width: { size: W, type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill: 'F3F4F6' },
      margins: { top: 120, bottom: 120, left: 140, right: 140 },
      children: [new Paragraph({ children: [new TextRun({ text, bold: true, size: 20 })] })],
    })

  kids.push(
    new Table({
      columnWidths: [W, W],
      width: { size: W * 2, type: WidthType.DXA },
      rows: [
        new TableRow({ children: [headCell('For TactiCoach'), headCell(counterpartyLabel)] }),
        ...['Name', 'Signature', 'Date', 'Business / trading name (if any)'].map(
          (label) =>
            new TableRow({
              children: [cell(`${label}:`, { color: GREY }), cell(`${label}:`, { color: GREY })],
            }),
        ),
      ],
    }),
  )

  kids.push(
    new Paragraph({
      spacing: { before: 360 },
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: `TactiCoach is a trading name of [COMPANY LEGAL NAME], [COMPANY NUMBER], [REGISTERED ADDRESS]. Questions: ${contactEmail}`,
          size: 17,
          color: GREY,
        }),
      ],
    }),
  )

  return new Document({
    numbering: {
      config: [
        {
          reference: 'bullets',
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: '•',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 460, hanging: 240 } } },
            },
          ],
        },
      ],
    },
    styles: { default: { document: { run: { font: 'Calibri', size: 21 } } } },
    sections: [
      {
        properties: { page: { margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 } } },
        children: kids,
      },
    ],
  })
}

const BUILDS = [
  {
    label: 'Collaboration Programme Agreement',
    counterparty: 'Collaborator',
    contact: 'collaborate@tacticoach.co.uk',
    out: 'TactiCoach_Collaboration_Programme_Agreement.docx',
    load: {
      file: path.join(SRC, 'collaborations', 'collaboration-agreement.ts'),
      exportName: 'COLLABORATION_AGREEMENT',
      deps: [path.join(SRC, 'collaborations', 'collaboration-terms.ts')],
    },
  },
  {
    label: 'Referral Programme Terms',
    counterparty: 'Referrer',
    contact: 'hello@tacticoach.co.uk',
    out: 'TactiCoach_Referral_Programme_Terms.docx',
    load: {
      file: path.join(SRC, 'referrals', 'referral-agreement.ts'),
      exportName: 'REFERRAL_AGREEMENT',
      // The referral terms interpolate the reward cap from the rate engine.
      deps: [path.join(__dirname, '..', 'src', 'lib', 'referral-ladder.ts')],
    },
  },
]

const outDir = process.argv[2] ?? '.'
fs.mkdirSync(outDir, { recursive: true })

Promise.all(
  BUILDS.map(async (build) => {
    const agreement = loadAgreement(build.load)
    const doc = render(agreement, build.counterparty, build.contact)
    const buffer = await Packer.toBuffer(doc)
    const target = path.join(outDir, build.out)
    fs.writeFileSync(target, buffer)
    console.log(`${build.label} v${agreement.version} → ${target} (${buffer.length} bytes)`)
  }),
).catch((err) => {
  console.error(err.message)
  process.exit(1)
})
