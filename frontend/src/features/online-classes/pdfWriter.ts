/**
 * Minimal PDF writer: one JPEG image per page, nothing else.
 *
 * A whiteboard export only ever needs "this picture is this page", so a small
 * writer here avoids shipping a PDF library to every browser. The pages are
 * embedded as DCT (JPEG) streams, which PDF readers decode natively.
 */

export interface JpegPage {
  jpeg: Uint8Array;
  /** Pixel size of the image; the page is sized to match (1 px = 0.75 pt). */
  width: number;
  height: number;
}

const PX_TO_PT = 0.75;

const encoder = new TextEncoder();

function text(value: string): Uint8Array {
  return encoder.encode(value);
}

function num(value: number): string {
  return String(Math.round(value * 100) / 100);
}

export function buildPdf(pages: JpegPage[]): Uint8Array {
  if (pages.length === 0) throw new Error('A PDF needs at least one page');

  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (chunk: Uint8Array) => {
    chunks.push(chunk);
    length += chunk.length;
  };
  const startObject = (id: number) => {
    offsets[id] = length;
    push(text(`${id} 0 obj\n`));
  };

  // Header; the second line (bytes above 127) tells transfer tools this is binary.
  push(text('%PDF-1.4\n'));
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  const firstPageId = 3;
  const pageId = (index: number) => firstPageId + index * 3;

  startObject(1);
  push(text('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'));

  startObject(2);
  const kids = pages.map((_, index) => `${pageId(index)} 0 R`).join(' ');
  push(text(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>\nendobj\n`));

  pages.forEach((page, index) => {
    const id = pageId(index);
    const w = num(page.width * PX_TO_PT);
    const h = num(page.height * PX_TO_PT);

    startObject(id);
    push(
      text(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] ` +
          `/Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>\nendobj\n`,
      ),
    );

    const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    startObject(id + 1);
    push(text(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`));

    startObject(id + 2);
    push(
      text(
        `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} ` +
          `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
      ),
    );
    push(page.jpeg);
    push(text('\nendstream\nendobj\n'));
  });

  const objectCount = pageId(pages.length - 1) + 3; // ids 1 .. objectCount-1
  const xrefAt = length;
  let table = `xref\n0 ${objectCount}\n0000000000 65535 f \n`;
  for (let id = 1; id < objectCount; id += 1) {
    table += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  push(text(table));
  push(text(`trailer\n<< /Size ${objectCount} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`));

  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/** The bytes of a `data:` URL, e.g. a canvas `toDataURL('image/jpeg')`. */
export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
