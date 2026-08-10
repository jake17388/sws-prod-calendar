import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '_site');
const publicAssets = [
  'index.html',
  'manifest.json',
  'version.json',
  'sw.js',
  'js',
  'styles',
  'icons',
];

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

for (const asset of publicAssets) {
  fs.cpSync(path.join(root, asset), path.join(output, asset), { recursive: true });
}

const pdfJsBuild = path.join(root, 'node_modules', 'pdfjs-dist', 'build');
const pdfJsOutput = path.join(output, 'vendor', 'pdfjs');
fs.mkdirSync(pdfJsOutput, { recursive: true });
for (const file of ['pdf.min.mjs', 'pdf.worker.min.mjs']) {
  fs.copyFileSync(path.join(pdfJsBuild, file), path.join(pdfJsOutput, file));
}
