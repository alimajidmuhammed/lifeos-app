/**
 * Zero-dependency, standards-compliant PDF 1.4 Multi-Page JPEG Encoder
 * Pure TypeScript (works in Web, Node tests, and React Native without native PDF libs).
 * Embeds each scanned/enhanced JPEG page via /DCTDecode XObjects scaled to A4 or native aspect ratio.
 */

export interface PdfJpegPage {
  jpegBytes: Uint8Array;
  width: number;
  height: number;
}

const encoder = new TextEncoder();

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

export function buildMultiPagePdfFromJpegs(pages: PdfJpegPage[]): Uint8Array {
  if (pages.length === 0) {
    throw new Error('At least one page is required to generate a PDF.');
  }

  // Object numbering:
  // 1: Catalog
  // 2: Pages
  // For page i (0..N-1):
  //   pageObj = 3 + i * 3
  //   imgObj  = 4 + i * 3
  //   cntObj  = 5 + i * 3
  const objectBodies: Array<{ id: number; bytes: Uint8Array }> = [];
  const pageIds: number[] = [];

  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const pageObjId = 3 + i * 3;
    const imgObjId = 4 + i * 3;
    const contentObjId = 5 + i * 3;
    pageIds.push(pageObjId);

    // Fit onto A4-width (595pt) while preserving scanned image aspect ratio
    const safeW = Math.max(1, Math.round(p.width));
    const safeH = Math.max(1, Math.round(p.height));
    const pageW = 595;
    const pageH = Math.max(200, Math.min(1200, Math.round((safeH / safeW) * pageW)));

    const pageDict =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] ` +
      `/Resources << /XObject << /Im0 ${imgObjId} 0 R >> >> /Contents ${contentObjId} 0 R >>`;
    objectBodies.push({ id: pageObjId, bytes: encoder.encode(pageDict) });

    const imgHeader =
      `<< /Type /XObject /Subtype /Image /Width ${safeW} /Height ${safeH} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpegBytes.byteLength} >>\nstream\n`;
    const imgFooter = `\nendstream`;
    objectBodies.push({
      id: imgObjId,
      bytes: concatBytes([encoder.encode(imgHeader), p.jpegBytes, encoder.encode(imgFooter)]),
    });

    const contentStream = `q\n${pageW} 0 0 ${pageH} 0 0 cm\n/Im0 Do\nQ\n`;
    const contentDict = `<< /Length ${contentStream.length} >>\nstream\n${contentStream}endstream`;
    objectBodies.push({ id: contentObjId, bytes: encoder.encode(contentDict) });
  }

  const catalogObj = {
    id: 1,
    bytes: encoder.encode('<< /Type /Catalog /Pages 2 0 R >>'),
  };
  const pagesObj = {
    id: 2,
    bytes: encoder.encode(
      `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`
    ),
  };

  const allObjects = [catalogObj, pagesObj, ...objectBodies].sort((a, b) => a.id - b.id);

  const chunks: Uint8Array[] = [];
  const header = encoder.encode('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n');
  chunks.push(header);

  let offset = header.byteLength;
  const xrefOffsets: number[] = [0]; // index 0 = free object

  for (const obj of allObjects) {
    xrefOffsets.push(offset);
    const prefix = encoder.encode(`${obj.id} 0 obj\n`);
    const suffix = encoder.encode('\nendobj\n');
    chunks.push(prefix, obj.bytes, suffix);
    offset += prefix.byteLength + obj.bytes.byteLength + suffix.byteLength;
  }

  const xrefStart = offset;
  const xrefLines = [`xref`, `0 ${allObjects.length + 1}`, `0000000000 65535 f `];
  for (let i = 1; i < xrefOffsets.length; i++) {
    xrefLines.push(`${String(xrefOffsets[i]).padStart(10, '0')} 00000 n `);
  }
  const trailer = [
    ...xrefLines,
    `trailer`,
    `<< /Size ${allObjects.length + 1} /Root 1 0 R >>`,
    `startxref`,
    `${xrefStart}`,
    `%%EOF`,
    '',
  ].join('\n');

  chunks.push(encoder.encode(trailer));
  return concatBytes(chunks);
}
