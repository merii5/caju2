const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const directory = path.join(root, '.worker-assets');
const pages = [
  'index.html', 'iletisim.html', 'atolye.html', 'felsefemiz.html', 'koleksiyon.html',
  'randevu.html', 'yolculuk.html', 'style.css', 'admin.css', 'script.js', 'admin-editor.js'
];
const files = new Set(pages);

for (const file of pages) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  for (const [image] of source.matchAll(/images\/(?:urunler\/)?[^"'\r\n()<>?#/]+?\.(?:jpeg|jpg|png)(?=["')\s])/gi)) {
    files.add(image);
  }
}

const existing = fs.lstatSync(directory, { throwIfNoEntry: false });
if (existing && (!existing.isDirectory() || existing.isSymbolicLink() || path.dirname(directory) !== root)) {
  throw new Error('Invalid Worker asset output directory.');
}
if (existing) fs.rmSync(directory, { recursive: true });
fs.mkdirSync(directory);

for (const file of files) {
  const destination = path.join(directory, file);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(path.join(root, file), destination);
}

fs.writeFileSync(path.join(directory, '_headers'), `/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; style-src-attr 'unsafe-inline'; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'
`);
console.log(`Prepared ${files.size} Cloudflare assets.`);
