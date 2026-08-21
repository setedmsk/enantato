import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(scriptDirectory, '..');
const outputDirectory = join(repositoryRoot, 'dist');

const files = [
  'index.html',
  'styles.css',
  'app.js',
  'realtime.js',
  'manifest.webmanifest',
  'service-worker.js'
];

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(join(outputDirectory, 'assets'), { recursive: true });

await Promise.all(
  files.map((file) => cp(join(repositoryRoot, file), join(outputDirectory, file)))
);
await cp(join(repositoryRoot, 'assets', 'icon.svg'), join(outputDirectory, 'assets', 'icon.svg'));

console.log('Desktop frontend prepared in dist/.');
