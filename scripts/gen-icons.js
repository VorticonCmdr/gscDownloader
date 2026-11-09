import { readFileSync, writeFileSync } from 'node:fs';
// Regenerate src/lib/icons.js: npm run icons
const [root = '.', out = 'src/lib/icons.js'] = process.argv.slice(2);
const names = ['arrow-counterclockwise','arrow-left-right','cloud-download','download','exclamation-triangle-fill',
  'graph-up','lightning-fill','pause-fill','person-circle','person-x-fill','play-fill','plus-circle','trash'];
const ver = JSON.parse(readFileSync(`${root}/node_modules/bootstrap-icons/package.json`, 'utf8')).version;
const entries = names.map((n) => {
  const svg = readFileSync(`${root}/node_modules/bootstrap-icons/icons/${n}.svg`, 'utf8');
  if (!/viewBox="0 0 16 16"/.test(svg)) throw new Error(`unexpected viewBox in ${n}`);
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/\s*\n\s*/g, '').trim();
  return `  '${n}': '${inner.replace(/'/g, "\\'")}',`;
});
writeFileSync(out, `// Inline SVG icons — replaces the bootstrap-icons webfont (~620 KB of CSS + fonts).
// Path data from bootstrap-icons v${ver} (MIT, https://icons.getbootstrap.com/). Generated, do not hand-edit:
// add a name to the list in the generator and re-run it.
//
// Usage: static markup keeps <i class="bi bi-NAME"></i> placeholders and calls hydrateIcons();
// scripts call iconSvg(NAME) directly.

import './icons.css';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Trusted constants only — never interpolate user input here.
const ICONS = {
${entries.join('\n')}
};

export function iconSvg(name) {
  const markup = ICONS[name];
  if (!markup) throw new Error(\`Unknown icon: \${name}\`);
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', \`bi bi-\${name}\`);
  svg.innerHTML = markup;
  return svg;
}

/** Replace every <i class="bi bi-NAME"> under root with the inline SVG, keeping extra classes. */
export function hydrateIcons(root = document) {
  for (const el of root.querySelectorAll('i.bi')) {
    const name = [...el.classList].find((c) => c.startsWith('bi-'))?.slice(3);
    if (!name || !ICONS[name]) continue;
    const svg = iconSvg(name);
    for (const c of el.classList) if (c !== 'bi' && c !== \`bi-\${name}\`) svg.classList.add(c);
    el.replaceWith(svg);
  }
}
`);
console.log(`wrote ${names.length} icons from bootstrap-icons ${ver}`);
