/**
 * 100% On-Device Browser OCR using Tesseract.js (WebAssembly).
 * Lazy-loaded only when scanning/uploading images in Vault so initial bundle stays fast.
 * Zero cloud transmission — respects LifeOS Free-Tier Privacy Gate.
 */
export async function runLocalImageOcr(
  imageDataUrl: string,
  onProgress?: (pct: number) => void
): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng', 1, {
    logger: (m: { status?: string; progress?: number }) => {
      if (m.status === 'recognizing text' && typeof m.progress === 'number') {
        onProgress?.(Math.round(m.progress * 100));
      }
    },
  });

  try {
    const result = await worker.recognize(imageDataUrl);
    return (result?.data?.text ?? '').trim();
  } finally {
    await worker.terminate();
  }
}
