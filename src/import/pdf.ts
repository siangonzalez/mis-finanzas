// Lee el texto de un PDF en el dispositivo, línea por línea. Si el PDF tiene
// contraseña, la usa solo para abrir el archivo: no se guarda ni se envía.

export class PdfPasswordError extends Error {
  readonly wrong: boolean
  constructor(wrong: boolean) {
    super(wrong ? 'Esa contraseña no abre el PDF.' : 'Este PDF tiene contraseña.')
    this.wrong = wrong
  }
}

// pdf.js pesa bastante: solo se descarga cuando cargas un PDF.
async function loadPdfJs() {
  const pdfjs = await import('pdfjs-dist')
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  return pdfjs
}

interface TextBit {
  str: string
  x: number
  y: number
}

// Une los pedazos de texto que están a la misma altura en una sola línea.
export function bitsToLines(bits: TextBit[]): string[] {
  const rows: { y: number; bits: TextBit[] }[] = []
  for (const b of bits.filter((b) => b.str.trim())) {
    const row = rows.find((r) => Math.abs(r.y - b.y) < 3)
    if (row) row.bits.push(b)
    else rows.push({ y: b.y, bits: [b] })
  }
  return rows
    .sort((a, b) => b.y - a.y) // en PDF, y crece hacia arriba
    .map((r) => r.bits.sort((a, b) => a.x - b.x).map((b) => b.str.trim()).join(' ').replace(/\s+/g, ' '))
}

export async function readPdfLines(file: ArrayBuffer, password?: string): Promise<string[]> {
  const pdfjs = await loadPdfJs()
  let doc
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(file), password }).promise
  } catch (e) {
    if ((e as { name?: string }).name === 'PasswordException') {
      throw new PdfPasswordError((e as { code?: number }).code === pdfjs.PasswordResponses.INCORRECT_PASSWORD)
    }
    throw new Error('No pude abrir el PDF.')
  }
  const lines: string[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent()
    const bits = content.items.flatMap((it) =>
      'str' in it ? [{ str: it.str, x: it.transform[4] as number, y: it.transform[5] as number }] : [],
    )
    lines.push(...bitsToLines(bits))
  }
  await doc.destroy()
  return lines
}
