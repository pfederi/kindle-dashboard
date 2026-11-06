import sharp from 'sharp';

/** Converts any PNG to a 1-channel PNG whose values are multiples of 17 (16 gray levels). */
export async function toGray16(png: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i++) data[i] = Math.round((data[i] as number) / 17) * 17;
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 1 } })
    .toColourspace('b-w')
    .png({ compressionLevel: 9 })
    .toBuffer();
}
