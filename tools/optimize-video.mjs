/**
 * 2DY — hero video pipeline
 *
 * The raw generation is ~7 MB of 1080p, which is far too heavy for something
 * that plays silently behind the fold-one headline. This re-encodes it to a
 * pair of web-weight files:
 *
 *   hero.webm  VP9  — smaller, served first where supported
 *   hero.mp4   H.264 — universal fallback (Safari, older Android)
 *
 * Both are silent, capped at 1600px wide (it is a blurred-past background,
 * not a film), and use a faststart layout so playback begins before the file
 * has finished arriving.
 */
import { spawn } from 'node:child_process';
import { mkdir, stat, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpeg from 'ffmpeg-static';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src', 'assets', 'video');
const OUT = path.join(ROOT, 'dist', 'assets', 'video');

// Matches the largest poster candidate (hero-2400). At 1600 the hero
// visibly softened at the moment the video faded in over a 2400px still.
const MAX_WIDTH = 2400;

function run(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d.toString(); });
    p.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(err.slice(-1200)))
    );
  });
}

const mb = (n) => (n / 1024 / 1024).toFixed(2);

async function main() {
  if (!existsSync(SRC)) {
    console.log('  no src/assets/video — skipping');
    return;
  }

  const sources = (await readdir(SRC)).filter((f) => /\.(mp4|mov|webm)$/i.test(f));
  if (!sources.length) {
    console.log('  no source videos — skipping');
    return;
  }

  await mkdir(OUT, { recursive: true });

  for (const file of sources) {
    const name = path.parse(file).name;
    const input = path.join(SRC, file);
    const inSize = (await stat(input)).size;

    const scale = `scale='min(${MAX_WIDTH},iw)':-2`;

    // H.264 — universal. CRF 30 is aggressive, but this is a dark, slow,
    // heavily-gradiented plate where the loss is invisible.
    await run([
      '-y', '-i', input,
      '-an',
      '-vf', scale,
      '-c:v', 'libx264',
      '-profile:v', 'high',
      '-crf', '30',
      '-preset', 'slower',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      path.join(OUT, `${name}.mp4`),
    ]);

    // VP9 — roughly 30-40% smaller again for browsers that take it.
    await run([
      '-y', '-i', input,
      '-an',
      '-vf', scale,
      '-c:v', 'libvpx-vp9',
      '-crf', '42',
      '-b:v', '0',
      '-row-mt', '1',
      '-deadline', 'good',
      '-cpu-used', '2',
      path.join(OUT, `${name}.webm`),
    ]);

    const mp4 = (await stat(path.join(OUT, `${name}.mp4`))).size;
    const webm = (await stat(path.join(OUT, `${name}.webm`))).size;

    console.log(
      `  ${name.padEnd(10)} ${mb(inSize)} MB  →  mp4 ${mb(mp4)} MB · webm ${mb(webm)} MB` +
      `  (${Math.round((1 - webm / inSize) * 100)}% smaller)`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
