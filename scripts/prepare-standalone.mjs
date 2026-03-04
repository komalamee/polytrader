import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const srcStatic = path.join(root, '.next', 'static');
const dstStatic = path.join(root, '.next', 'standalone', '.next', 'static');
const srcPublic = path.join(root, 'public');
const dstPublic = path.join(root, '.next', 'standalone', 'public');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyDir(src, dst) {
  if (!fs.existsSync(src)) return;
  ensureDir(dst);
  fs.cpSync(src, dst, { recursive: true, force: true });
}

copyDir(srcStatic, dstStatic);
copyDir(srcPublic, dstPublic);

console.log('[prepare-standalone] copied static + public assets into .next/standalone');
