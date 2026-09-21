/**
 * 2DY — image pipeline
 *
 * Takes the raw generated PNGs in src/assets/img and emits, per image:
 *   - AVIF + WebP at four widths
 *   - a tiny base64 LQIP for blur-up
 *   - intrinsic width/height, so every <img> can carry them and never shift
 * Plus the social card and the favicon set.
 *
 * Output goes to dist/assets/img and a manifest to src/assets/img/manifest.json
 * which build.mjs reads to emit correct <picture> markup.
 */
import sharp from 'sharp';
import { readdir, readFile, mkdir, writeFile, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src', 'assets', 'img');
const OUT = path.join(ROOT, 'dist', 'assets', 'img');

const WIDTHS = [640, 1024, 1600, 2400];
const QUALITY = { avif: 52, webp: 74 };

// The social card is composed from the hero frame.
const OG_SOURCE = 'hero';
const FAVICON_SOURCE = 'texture';

sharp.cache(false);
sharp.concurrency(4);

async function main() {
  if (existsSync(OUT)) await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const files = (await readdir(SRC)).filter((f) => /\.(png|jpe?g)$/i.test(f));
  if (!files.length) {
    console.error('No source images found in', SRC);
    process.exit(1);
  }

  const manifest = {};
  let totalIn = 0;
  let totalOut = 0;

  for (const file of files) {
    const name = path.parse(file).name;
    const abs = path.join(SRC, file);
    const input = sharp(abs, { limitInputPixels: false });
    const meta = await input.metadata();

    totalIn += (await stat(abs)).size;

    const entry = {
      width: meta.width,
      height: meta.height,
      aspect: +(meta.width / meta.height).toFixed(4),
      widths: [],
      lqip: '',
    };

    // Only emit widths we actually have pixels for, always keeping at least
    // one — and always keep the source's own width, so a small original
    // (the 900px phone photos of real work) still has a full-size variant
    // for the lightbox instead of topping out at 640.
    const targets = WIDTHS.filter((w) => w <= meta.width);
    if (!targets.length || targets[targets.length - 1] < meta.width * 0.95) {
      targets.push(meta.width);
    }

    for (const w of targets) {
      const base = input.clone().resize({ width: w, withoutEnlargement: true });

      const [avif, webp] = await Promise.all([
        base.clone().avif({ quality: QUALITY.avif, effort: 4 }).toBuffer(),
        base.clone().webp({ quality: QUALITY.webp, effort: 5 }).toBuffer(),
      ]);

      await writeFile(path.join(OUT, `${name}-${w}.avif`), avif);
      await writeFile(path.join(OUT, `${name}-${w}.webp`), webp);

      totalOut += avif.length + webp.length;
      entry.widths.push(w);
    }

    // Blur-up placeholder — 20px wide, heavily compressed, inlined as a data URI.
    const lqipBuf = await input
      .clone()
      .resize({ width: 20 })
      .blur(1.1)
      .webp({ quality: 28 })
      .toBuffer();
    entry.lqip = `data:image/webp;base64,${lqipBuf.toString('base64')}`;

    manifest[name] = entry;
    console.log(
      `  ${name.padEnd(16)} ${String(meta.width).padStart(5)}×${String(meta.height).padEnd(5)}  →  ${entry.widths.join(', ')}`
    );
  }

  // ---- social card -------------------------------------------------------
  if (manifest[OG_SOURCE]) {
    const og = await sharp(path.join(SRC, `${OG_SOURCE}.png`), { limitInputPixels: false })
      .resize({ width: 1200, height: 630, fit: 'cover', position: 'centre' })
      .modulate({ brightness: 0.92 })
      .jpeg({ quality: 84, mozjpeg: true })
      .toBuffer();
    await writeFile(path.join(OUT, 'og.jpg'), og);
    totalOut += og.length;
    console.log(`  og.jpg           1200×630`);
  }

  // ---- favicons ----------------------------------------------------------
  const monogram = await readFile(path.join(SRC, 'favicon.svg'));

  for (const size of [16, 32, 180, 192, 512]) {
    const buf = await sharp(monogram).resize(size, size).png().toBuffer();
    const fname = size === 180 ? 'apple-touch-icon.png' : `icon-${size}.png`;
    await writeFile(path.join(OUT, fname), buf);
    totalOut += buf.length;
  }
  await writeFile(path.join(OUT, 'icon.svg'), monogram);
  console.log('  favicons         16, 32, 180, 192, 512 + svg');

  await writeFile(
    path.join(SRC, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf8'
  );

  const mb = (n) => (n / 1024 / 1024).toFixed(1);
  console.log(
    `\n  ${files.length} images  ·  ${mb(totalIn)} MB in  →  ${mb(totalOut)} MB out ` +
    `(${Math.round((1 - totalOut / totalIn) * 100)}% smaller)\n`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
