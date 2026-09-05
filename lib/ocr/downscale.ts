'use client';

/**
 * Shrinks a photo before upload. Browser only.
 *
 * Two reasons. A 12MP phone photo is several megabytes, and the payer is on
 * restaurant wifi with seven people waiting. And the Messages API scales images
 * down to fit roughly 1568px on the long edge regardless, so anything larger is
 * bytes spent for no extra detail.
 *
 * Re-encoding through a canvas also normalises the format: a HEIC straight out
 * of an iPhone comes back as JPEG, which the API accepts and HEIC is not.
 */

/** Matches the API's own resize, so nothing is uploaded that will be thrown away. */
const MAX_EDGE = 1568;
const JPEG_QUALITY = 0.85;

export class ImageDecodeError extends Error {
  constructor() {
    super('That file could not be read as an image.');
    this.name = 'ImageDecodeError';
  }
}

async function toBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      // Fall through: some browsers refuse HEIC here but manage it via an <img>.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new ImageDecodeError());
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function downscaleToJpeg(file: File): Promise<Blob> {
  const source = await toBitmap(file);
  const width = 'naturalWidth' in source ? source.naturalWidth : source.width;
  const height = 'naturalHeight' in source ? source.naturalHeight : source.height;
  if (!width || !height) throw new ImageDecodeError();

  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));

  const context = canvas.getContext('2d');
  if (!context) throw new ImageDecodeError();
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  if ('close' in source) source.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
  );
  if (!blob) throw new ImageDecodeError();
  return blob;
}
