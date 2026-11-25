const { createServer } = require('node:http');
const { scrypt } = require('node:crypto');
const { readFile, realpath } = require('node:fs/promises');
const { resolve } = require('node:path');
const { promisify } = require('node:util');
const { openDatabase } = require('./database');
const { createApplication } = require('./app');

const production = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
const derive = promisify(scrypt);

async function readAsset(file) {
  const filename = resolve(__dirname, file);
  const actual = await realpath(filename);
  if (actual !== filename && (process.platform !== 'win32' || actual.toLowerCase() !== filename.toLowerCase())) {
    throw Object.assign(new Error('Asset not found.'), { code: 'ENOENT' });
  }
  return readFile(actual);
}

const app = createApplication({
  openDatabase,
  readAsset,
  derivePassword: (password, salt) => derive(password, salt, 64),
  env: process.env,
  production,
  localHostOnly: !production && !process.env.HOST,
  closeInvalidRequests: !process.env.VERCEL
});

if (require.main === module) {
  app.initialize().then(() => {
    createServer({ headersTimeout: 10000, requestTimeout: 20000, keepAliveTimeout: 5000, maxHeaderSize: 16384 }, app.handler)
      .listen(Number(process.env.PORT || 3000), process.env.HOST || (production ? '0.0.0.0' : '127.0.0.1'), () => {
        console.log('Caju Clay sunucusu haz?r.');
      });
  }).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = app.handler;
