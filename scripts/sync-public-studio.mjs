import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(projectRoot, 'public');

function copySyncSafe(src, dest) {
  const destDir = path.dirname(dest);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  if (fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true, force: true });
  }
  fs.cpSync(src, dest, { recursive: true });
}

if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

for (const name of ['mmd_rtx.html', 'mmd-character-motion.js']) {
  const src = path.join(projectRoot, name);
  if (fs.existsSync(src)) {
    copySyncSafe(src, path.join(publicDir, name));
    console.log(`synced public/${name}`);
  } else {
    console.warn(`missing ${name}, skipping`);
  }
}

const vendorSrc = path.join(projectRoot, 'vendor');
if (fs.existsSync(vendorSrc)) {
  copySyncSafe(vendorSrc, path.join(publicDir, 'vendor'));
  console.log('synced public/vendor');
} else {
  console.warn('missing vendor/, skipping');
}
