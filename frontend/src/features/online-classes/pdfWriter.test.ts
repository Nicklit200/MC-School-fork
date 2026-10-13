import { describe, expect, it } from 'vitest';
import { buildPdf, dataUrlToBytes } from './pdfWriter';

// An 8x8 red JPEG, so the file is a real PDF a real reader can open.
const TINY_JPEG = dataUrlToBytes('data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ0ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDGooorzj7E/9k=');

const latin1 = (bytes: Uint8Array) => Array.from(bytes, (b) => String.fromCharCode(b)).join('');

describe('buildPdf', () => {
  it('writes a PDF header, one page object per image and an end marker', () => {
    const pdf = latin1(
      buildPdf([
        { jpeg: TINY_JPEG, width: 1600, height: 900 },
        { jpeg: TINY_JPEG, width: 1600, height: 900 },
      ]),
    );
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(pdf).toContain('/Count 2');
    expect(pdf.match(/\/Type \/Page /g)).toHaveLength(2);
    expect(pdf.match(/\/Filter \/DCTDecode/g)).toHaveLength(2);
  });

  it('sizes each page to its image (1 px = 0.75 pt)', () => {
    const pdf = latin1(buildPdf([{ jpeg: TINY_JPEG, width: 1600, height: 900 }]));
    expect(pdf).toContain('/MediaBox [0 0 1200 675]');
  });

  it('points every cross-reference entry at its object, and startxref at the table', () => {
    const bytes = buildPdf([
      { jpeg: TINY_JPEG, width: 800, height: 600 },
      { jpeg: TINY_JPEG, width: 800, height: 450 },
      { jpeg: TINY_JPEG, width: 800, height: 600 },
    ]);
    const pdf = latin1(bytes);

    const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(pdf)![1]);
    expect(pdf.slice(startxref, startxref + 4)).toBe('xref');

    const entries = [...pdf.slice(startxref).matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]));
    expect(entries.length).toBe(1 + 3 * 3 + 1); // catalog + pages + 3 per page
    entries.forEach((offset, index) => {
      expect(pdf.slice(offset, offset + String(index + 1).length + 6)).toBe(`${index + 1} 0 obj`);
    });
  });

  it('keeps the JPEG bytes intact inside the file', () => {
    const bytes = buildPdf([{ jpeg: TINY_JPEG, width: 8, height: 8 }]);
    expect(latin1(bytes)).toContain(latin1(TINY_JPEG));
  });

  it('refuses to write an empty document', () => {
    expect(() => buildPdf([])).toThrow();
  });
});

describe('dataUrlToBytes', () => {
  it('decodes the payload of a data URL', () => {
    expect(Array.from(dataUrlToBytes('data:application/octet-stream;base64,AQID'))).toEqual([1, 2, 3]);
  });
});
