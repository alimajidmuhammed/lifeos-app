/**
 * Browser-side Document Scan Enhancer (Crop, Rotate 90deg, Document B&W / Crisp Color filters)
 * Produces compressed JPEG bytes ready for local IndexedDB storage or multi-page PDF export.
 */

export type ScanFilterPreset = 'original' | 'document_bw' | 'vivid_color';

export interface ScanTransformOptions {
  rotationDeg: 0 | 90 | 180 | 270;
  cropInsetPct: number; // 0..20 (% trimmed symmetrically from each edge)
  filter: ScanFilterPreset;
  quality?: number; // 0.5..0.95
  maxDimension?: number;
}

export interface EnhancedScanResult {
  dataUrl: string;
  jpegBytes: Uint8Array;
  width: number;
  height: number;
  sizeBytes: number;
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode image for scan enhancement.'));
    img.src = src;
  });
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const commaIdx = dataUrl.indexOf(',');
  const b64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

export async function enhanceScannedImage(
  sourceDataUrl: string,
  opts: ScanTransformOptions
): Promise<EnhancedScanResult> {
  const img = await loadImageElement(sourceDataUrl);
  const inset = Math.max(0, Math.min(20, opts.cropInsetPct)) / 100;

  const sx = Math.round(img.naturalWidth * inset);
  const sy = Math.round(img.naturalHeight * inset);
  const sw = Math.max(16, Math.round(img.naturalWidth * (1 - inset * 2)));
  const sh = Math.max(16, Math.round(img.naturalHeight * (1 - inset * 2)));

  const maxDim = opts.maxDimension ?? 1600;
  const scale = Math.min(1, maxDim / Math.max(sw, sh));
  const scaledW = Math.max(16, Math.round(sw * scale));
  const scaledH = Math.max(16, Math.round(sh * scale));

  const quarterTurns = opts.rotationDeg === 90 || opts.rotationDeg === 270;
  const outW = quarterTurns ? scaledH : scaledW;
  const outH = quarterTurns ? scaledW : scaledH;

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable.');

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, outW, outH);

  ctx.save();
  ctx.translate(outW / 2, outH / 2);
  ctx.rotate((opts.rotationDeg * Math.PI) / 180);
  const supportsFilter = typeof ctx.filter === 'string';
  if (supportsFilter) {
    if (opts.filter === 'document_bw') {
      ctx.filter = 'grayscale(100%) contrast(155%) brightness(108%)';
    } else if (opts.filter === 'vivid_color') {
      ctx.filter = 'contrast(120%) brightness(105%) saturate(112%)';
    } else {
      ctx.filter = 'none';
    }
  }
  ctx.drawImage(img, sx, sy, sw, sh, -scaledW / 2, -scaledH / 2, scaledW, scaledH);
  ctx.restore();

  // Pixel-level fallback for browsers (like older Safari/iOS) that ignore ctx.filter
  if (!supportsFilter && opts.filter !== 'original') {
    const imgData = ctx.getImageData(0, 0, outW, outH);
    const data = imgData.data;
    const contrast = opts.filter === 'document_bw' ? 1.55 : 1.2;
    const brightness = opts.filter === 'document_bw' ? 15 : 8;
    for (let i = 0; i < data.length; i += 4) {
      let r = data[i];
      let g = data[i + 1];
      let b = data[i + 2];
      if (opts.filter === 'document_bw') {
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        r = g = b = lum;
      }
      data[i] = Math.min(255, Math.max(0, (r - 128) * contrast + 128 + brightness));
      data[i + 1] = Math.min(255, Math.max(0, (g - 128) * contrast + 128 + brightness));
      data[i + 2] = Math.min(255, Math.max(0, (b - 128) * contrast + 128 + brightness));
    }
    ctx.putImageData(imgData, 0, 0);
  }

  const quality = opts.quality ?? 0.85;
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  const jpegBytes = dataUrlToBytes(dataUrl);

  return {
    dataUrl,
    jpegBytes,
    width: outW,
    height: outH,
    sizeBytes: jpegBytes.byteLength,
  };
}
