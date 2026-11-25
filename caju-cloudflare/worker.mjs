import { Buffer } from 'node:buffer';
import { createHmac } from 'node:crypto';
import application from './app.js';

const { createApplication } = application;

function workerError(code) {
  return Object.assign(new Error(code), { code, storageUnavailable: true });
}

function databaseAdapter(db) {
  if (!db) throw workerError('D1_BINDING_MISSING');
  return {
    async exec(sql) {
      const statements = sql.split(';').map(statement => statement.trim()).filter(Boolean);
      await db.batch(statements.map(statement => db.prepare(statement)));
    },
    prepare(sql) {
      const statement = (...params) => params.length ? db.prepare(sql).bind(...params) : db.prepare(sql);
      return {
        get: (...params) => statement(...params).first(),
        all: async (...params) => (await statement(...params).all()).results,
        run: async (...params) => ({ changes: (await statement(...params).run()).meta.changes })
      };
    }
  };
}

function workerApplication(env) {
  const { ASSETS, ADMIN_PASSWORD_PEPPER } = env;
  return createApplication({
    env,
    production: env.CAJU_LOCAL_DEV !== '1',
    sharedInitialization: false,
    openDatabase() {
      if (!/^[a-f0-9]{64}$/i.test(ADMIN_PASSWORD_PEPPER || '')) throw workerError('ADMIN_PEPPER_REQUIRED');
      return databaseAdapter(env.DB);
    },
    derivePassword(password, salt) {
      return createHmac('sha256', Buffer.from(ADMIN_PASSWORD_PEPPER, 'hex'))
        .update(salt + ':' + password)
        .digest();
    },
    async readAsset(file) {
      const path = file.split('/').map(encodeURIComponent).join('/');
      const asset = await ASSETS.fetch(new Request('https://assets.invalid/' + path));
      if (!asset.ok) throw Object.assign(new Error('Asset unavailable.'), { code: asset.status === 404 ? 'ENOENT' : 'ASSET_ERROR' });
      return Buffer.from(await asset.arrayBuffer());
    }
  });
}

let app;

async function* readBody(body) {
  if (!body) return;
  const reader = body.getReader();
  let complete = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        complete = true;
        return;
      }
      yield value;
    }
  } finally {
    if (!complete) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export default {
  async fetch(request, env) {
    app ??= workerApplication(env);
    const url = new URL(request.url);
    const headers = Object.fromEntries(request.headers);
    const incoming = {
      url: url.pathname + url.search,
      method: request.method,
      headers: { ...headers, host: url.host },
      socket: { remoteAddress: headers['cf-connecting-ip'] || 'unknown' },
      iterator: () => readBody(request.body),
      resume: () => { if (request.body && !request.body.locked) void request.body.cancel().catch(() => {}); }
    };
    const outputHeaders = new Headers();
    let status = 200;
    let body = null;
    const outgoing = {
      setHeader(name, value) { outputHeaders.set(name, String(value)); },
      writeHead(code, values) {
        status = code;
        for (const [name, value] of Object.entries(values)) this.setHeader(name, value);
      },
      end(value) { body = value ?? null; }
    };
    await app.handler(incoming, outgoing);
    return new Response(request.method === 'HEAD' ? null : body, { status, headers: outputHeaders });
  }
};
