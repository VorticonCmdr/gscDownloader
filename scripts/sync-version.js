import { readFileSync, writeFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const manifest = JSON.parse(readFileSync('src/manifest.json', 'utf8'));
manifest.version = pkg.version;
writeFileSync('src/manifest.json', JSON.stringify(manifest, null, 2) + '\n');
console.log(`manifest.json version → ${pkg.version}`);
