const { createHash, randomBytes } = require('node:crypto');
const { Buffer } = require('node:buffer');
const { extname } = require('node:path');
const { createContent } = require('./content');
const { createSiteSettings, fields: customizationFields } = require('./site-settings');

function createApplication({ openDatabase, readAsset, derivePassword, env = {}, production = false,
  localHostOnly = false, closeInvalidRequests = false, sharedInitialization = true }) {
  const password = env.ADMIN_PASSWORD;
  const configuredOrigin = env.PUBLIC_ORIGIN && new URL(env.PUBLIC_ORIGIN);
  if (configuredOrigin && (configuredOrigin.href !== configuredOrigin.origin + '/' ||
      !(production ? ['https:'] : ['http:', 'https:']).includes(configuredOrigin.protocol))) {
    throw new Error('Set PUBLIC_ORIGIN to the public site origin, without a path.');
  }

  let app;

  async function initialize() {
    const db = await openDatabase();
    await db.exec(`
    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      workshop TEXT NOT NULL,
      date TEXT NOT NULL,
      persons TEXT NOT NULL,
      note TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Yeni' CHECK(status IN ('Yeni', 'Onaylandı', 'İptal edildi'))
    );
    CREATE TABLE IF NOT EXISTS contact_messages (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0 CHECK(is_read IN (0, 1)),
      received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );
    CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY,
      csrf TEXT NOT NULL,
      expires INTEGER NOT NULL,
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL
    );
  `);
    const columns = db.prepare('PRAGMA table_info(contact_messages)');
    const hasReadColumn = async () => (await columns.all()).some(column => column.name === 'is_read');
    if (!(await hasReadColumn())) {
      try {
        await db.exec('ALTER TABLE contact_messages ADD COLUMN is_read INTEGER NOT NULL DEFAULT 0 CHECK(is_read IN (0, 1))');
      } catch (error) {
        if (!(await hasReadColumn())) throw error;
      }
    }

    const settings = await createSiteSettings(db, env.ADMIN_USER || 'admin',
      production && (password?.length || 0) < 16 ? undefined : password, derivePassword);
    if (production && !(await settings.username())) {
      throw Object.assign(new Error('Set ADMIN_PASSWORD to at least 16 characters to initialize the administrator.'),
        { code: 'ADMIN_BOOTSTRAP_REQUIRED', storageUnavailable: true });
    }
    const content = await createContent(db, escapeHtml);

    return {
      settings, content,
      insert: db.prepare('INSERT INTO bookings (name, email, phone, workshop, date, persons, note) VALUES (?, ?, ?, ?, ?, ?, ?)'),
      list: db.prepare('SELECT * FROM bookings ORDER BY id DESC'),
      update: db.prepare('UPDATE bookings SET status = ? WHERE id = ?'),
      remove: db.prepare('DELETE FROM bookings WHERE id = ?'),
      saveMessage: db.prepare('INSERT INTO contact_messages (name, email, phone, subject, message) VALUES (?, ?, ?, ?, ?)'),
      listMessages: db.prepare('SELECT * FROM contact_messages ORDER BY id DESC'),
      setMessageRead: db.prepare('UPDATE contact_messages SET is_read = ? WHERE id = ?'),
      getSession: db.prepare(`SELECT s.csrf FROM admin_sessions s JOIN admin_account a
        ON a.id = 1 AND a.username = s.username AND a.password_hash = s.password_hash
        WHERE s.token_hash = ? AND s.expires > ?`),
      saveSession: db.prepare('INSERT INTO admin_sessions VALUES (?, ?, ?, ?, ?)'),
      pruneSessions: db.prepare('DELETE FROM admin_sessions WHERE expires <= ?'),
      deleteSession: db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?')
    };
  }

  function application() {
    if (!sharedInitialization) {
      return app || initialize().then(initialized => (app ??= initialized));
    }
    app ??= initialize().catch(error => {
      app = undefined;
      throw error;
    });
    return app;
  }
  const subjects = ['Ürün Siparişi', 'Workshop & Özel Ders', 'Kurumsal İş Birliği', 'Genel Soru'];
  const messageDate = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Istanbul' });
  const bookingDate = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'long', timeZone: 'Europe/Istanbul' });
  const workshops = ['Çocuk Seramik Workshopu', 'Yetişkin Seramik Workshopu', 'Seramik Boyama Workshopu'];
  const groups = ['1 kişi', '2 kişi', '3 kişi', '4 kişi', '5–8 kişi'];
  const statuses = ['Yeni', 'Onaylandı', 'İptal edildi'];
  const sessionSeconds = 8 * 60 * 60;
  const loginAttempts = new Map();
  const formAttempts = new Map();
  const cookieFlags = `Path=/admin; HttpOnly; SameSite=Strict${production ? '; Secure' : ''}`;
  const tokenHash = token => createHash('sha256').update(token).digest('hex');

  const pages = new Set(['index.html', 'atolye.html', 'felsefemiz.html', 'iletisim.html', 'koleksiyon.html', 'randevu.html', 'yolculuk.html', 'script.js', 'style.css', 'admin.css', 'admin-editor.js']);
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.png': 'image/png' };

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  function html(response, status, content) {
    response.writeHead(status, { 'Content-Type': mime['.html'], 'Cache-Control': 'no-store' });
    response.end(content);
  }

  function page(title, content) {
    return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} | Caju Clay</title><link rel="stylesheet" href="/style.css"></head><body><main class="section server-page"><a href="/">Caju Clay ana sayfası</a><h1>${title}</h1>${content}</main></body></html>`;
  }

  function redirect(response, location) {
    response.writeHead(303, { Location: location, 'Cache-Control': 'no-store' });
    response.end();
  }

  function sameOrigin(request) {
    const site = request.headers['sec-fetch-site'];
    if (site === 'cross-site' || site === 'same-site') return false;
    const origin = request.headers.origin;
    if (!origin) return true;
    try {
      const parsed = new URL(origin);
      if (parsed.origin !== origin || !['https:', 'http:'].includes(parsed.protocol)) return false;
      if (configuredOrigin) return origin === configuredOrigin.origin;
      return parsed.host === request.headers.host && (!production || parsed.protocol === 'https:');
    } catch {
      return false;
    }
  }

  function submissionAllowed(request, response) {
    const now = Date.now();
    const client = request.socket.remoteAddress;
    let bucket = formAttempts.get(client);
    if (bucket?.until <= now) {
      formAttempts.delete(client);
      bucket = undefined;
    }
    if (!bucket && formAttempts.size < 10000) {
      bucket = { count: 0, until: now + 10 * 60 * 1000 };
      formAttempts.set(client, bucket);
    }
    if (bucket && bucket.count < 30) {
      bucket.count += 1;
      return true;
    }
    response.setHeader('Retry-After', Math.max(1, Math.ceil(((bucket?.until || now + 60000) - now) / 1000)));
    html(response, 429, page('Gönderim sınırına ulaşıldı', '<p>Bir süre sonra tekrar deneyin.</p>'));
    return false;
  }

  let nextPrune = 0;
  function pruneLimits(now) {
    if (now < nextPrune) return;
    nextPrune = now + 60000;
    for (const limits of [loginAttempts, formAttempts]) {
      for (const [key, entry] of limits) {
        if (entry.until <= now) limits.delete(key);
      }
    }
  }

  async function readForm(request, limit = 16384) {
    if (request.headers['content-type']?.split(';')[0] !== 'application/x-www-form-urlencoded') {
      throw Object.assign(new Error('Form biçimi desteklenmiyor.'), { status: 415 });
    }
    if (Number(request.headers['content-length']) > limit) {
      request.resume();
      throw Object.assign(new Error('Form çok uzun.'), { status: 413 });
    }
    const chunks = [];
    let bytes = 0;
    for await (const chunk of request.iterator({ destroyOnReturn: false })) {
      bytes += chunk.length;
      if (bytes > limit) {
        request.resume();
        throw Object.assign(new Error('Form çok uzun.'), { status: 413 });
      }
      chunks.push(chunk);
    }
    return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
  }

  function renderContact(response, status, message, { marker, fields = {}, choices = [], textarea, text } = {}) {
    return readAsset('iletisim.html').then(body => {
      const template = body.toString('utf8');
      for (const [field, value] of Object.entries(fields)) {
        template = template.replace(`name="${field}"`, match => `${match} value="${escapeHtml(value || '')}"`);
      }
      for (const value of choices) {
        if (!value) continue;
        const option = `<option value="${escapeHtml(value)}">`;
        template = template.replace(option, match => match.replace('>', ' selected>'));
      }
      if (textarea) {
        template = template.replace(new RegExp(`(<textarea[^>]+name="${textarea}"[^>]*>)`), (_, tag) => tag + escapeHtml(text || ''));
      }
      html(response, status, template.replace(`<!-- ${marker} -->`, () =>
        `<p id="${marker}" class="form-status" role="${status < 400 ? 'status' : 'alert'}">${escapeHtml(message)}</p>`));
    });
  }

  function validContact(name, email, phone) {
    return name.length >= 2 && name.length <= 100 && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
      /^\+?[\d ()-]{10,24}$/.test(phone) && /^\d{10,15}$/.test(phone.replace(/\D/g, ''));
  }

  function adminDocument(title, className, body) {
    return `<!doctype html><html lang="tr"><head><meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} | Caju Clay</title>
      <link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/admin.css">
      </head><body class="${className}">${body}</body></html>`;
  }

  function panel(title, body, csrf, active) {
    const links = [['/admin', 'Yazılar'], ['/admin/randevular', 'Randevular'], ['/admin/mesajlar', 'Mesajlar'],
      ['/admin/site', 'Site Ayarları'], ['/admin/hesap', 'Hesabım']];
    return adminDocument(title, 'studio-admin', `<div class="studio-shell">
      <aside class="studio-sidebar">
        <a class="studio-wordmark" href="/admin">CAJU CLAY</a>
        <nav class="studio-links" aria-label="Yönetim">
          ${links.map(([url, label]) => `<a href="${url}"${active === url ? ' aria-current="page"' : ''}>${label}</a>`).join('')}
        </nav>
        <a class="studio-public-link" href="/">Siteyi Görüntüle</a>
      </aside>
      <main class="studio-main">
        <header class="studio-header"><h1>${title}</h1><div class="studio-session">
          <form method="post" action="/admin/logout"><input type="hidden" name="csrf" value="${csrf}">
            <button class="button secondary">Çıkış Yap</button></form>
        </div></header>
        ${body}
      </main></div>`);
  }

  function loginPage(message = '', role = 'alert') {
    return adminDocument('Yönetici Girişi', 'studio-login', `<main class="studio-login-layout">
      <div class="studio-login-image" aria-hidden="true"></div>
      <div class="studio-login-content">
        <a class="studio-wordmark" href="/">CAJU CLAY</a>
        <div class="studio-login-card">
          <h1>Yönetici Girişi</h1>
          <form class="booking-fields" method="post" action="/admin/login">
            ${message ? `<p class="form-status" role="${role}">${escapeHtml(message)}</p>` : ''}
            <label for="username">Kullanıcı adı</label>
            <input class="input-preview" id="username" name="username" autocomplete="username" required>
            <label for="password">Parola</label>
            <input class="input-preview" id="password" name="password" type="password" autocomplete="current-password" maxlength="256" required>
            <button class="button">Giriş Yap</button>
          </form>
        </div>
        <a class="studio-back" href="/">Siteye Dön</a>
      </div></main>`);
  }

  function accountPage(csrf, username, message = '') {
    return panel('Hesabım', `<form class="panel booking-fields studio-settings" method="post" action="/admin/hesap">
      <input type="hidden" name="csrf" value="${csrf}">
      ${message ? `<p class="form-status" role="alert">${escapeHtml(message)}</p>` : ''}
      <label for="account-name">Kullanıcı adı</label>
      <input class="input-preview" id="account-name" name="username" value="${escapeHtml(username)}" autocomplete="username" minlength="3" maxlength="40" required>
      <label for="account-current">Mevcut parola</label>
      <input class="input-preview" id="account-current" name="currentPassword" type="password" autocomplete="current-password" maxlength="256" required>
      <label for="account-new">Yeni parola</label>
      <p id="password-hint">En az 16 karakter. Yalnızca kullanıcı adını değiştirmek için boş bırakın.</p>
      <input class="input-preview" id="account-new" name="newPassword" type="password" autocomplete="new-password" aria-describedby="password-hint" minlength="16" maxlength="256">
      <label for="account-confirm">Yeni parola tekrar</label>
      <input class="input-preview" id="account-confirm" name="confirmPassword" type="password" autocomplete="new-password" maxlength="256">
      <button class="button">Hesabı Güncelle</button>
    </form>`, csrf, '/admin/hesap');
  }

  function customizationPage(csrf, values, feedback = '', role = 'status') {
    return panel('Site Ayarları', `<form class="panel booking-fields studio-settings" method="post" action="/admin/site">
      <input type="hidden" name="csrf" value="${csrf}">
      <p>Başlık ve açıklama alanları boş bırakıldığında varsayılan metinler kullanılır.</p>
      ${feedback ? `<p class="form-status" role="${role}">${escapeHtml(feedback)}</p>` : ''}
      ${customizationFields.map(({ name, label, limit, hint }) => `<label for="${name}">${label}</label>
        ${hint ? `<small id="${name}-hint">${hint}</small>` : ''}
        <textarea class="input-preview" id="${name}" name="${name}" maxlength="${limit}" rows="${name === 'heroIntro' ? 4 : 2}"${hint ? ` aria-describedby="${name}-hint"` : ''}>${escapeHtml(values[name] || '')}</textarea>`).join('')}
      <button class="button">Değişiklikleri Kaydet</button>
    </form>`, csrf, '/admin/site');
  }

  const messageStatuses = ['Okunmadı', 'Okundu'];

  function adminFilters(params, categoryOptions, statusOptions) {
    const query = (params.get('q') || '').trim().slice(0, 120);
    const category = params.get('kategori');
    const status = params.get('durum');
    return { q: query, kategori: categoryOptions.includes(category) ? category : '',
      durum: statusOptions.includes(status) ? status : '' };
  }

  function filterQuery(filters, result) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value) params.set(key, value);
    }
    if (result) params.set('sonuc', result);
    return params.size ? '?' + params.toString() : '';
  }

  function searchable(query, fields) {
    const words = query.toLocaleLowerCase('tr').split(/\s+/);
    const text = fields.join(' ').toLocaleLowerCase('tr');
    return words.every(word => text.includes(word));
  }

  function summaryCards(metrics) {
    return `<dl class="studio-metrics">${metrics.map(([label, value, tone]) => `
      <div class="studio-metric ${tone || ''}"><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl>`;
  }

  function filtersForm(route, filters, categoryLabel, categories, stateOptions, placeholder) {
    function options(values, selected, allLabel) {
      return `<option value="">${allLabel}</option>${values.map(value =>
        `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(value)}</option>`).join('')}`;
    }
    return `<form class="studio-filters" method="get" action="${route}" aria-label="Kayıtları filtrele">
      <label>Arama <input class="input-preview" name="q" type="search" maxlength="120" value="${escapeHtml(filters.q)}" placeholder="${placeholder}"></label>
      <label>${categoryLabel} <select class="input-preview" name="kategori">${options(categories, filters.kategori, 'Tümü')}</select></label>
      <label>Durum <select class="input-preview" name="durum">${options(stateOptions, filters.durum, 'Tümü')}</select></label>
      <div class="admin-actions"><button class="button">Filtrele</button><a href="${route}">Temizle</a></div>
    </form>`;
  }

  function contactLinks({ email, phone }) {
    const mailTarget = encodeURIComponent(email).replace('%40', '@');
    const phoneTarget = phone.replace(/[^+\d]/g, '');
    return `<div class="studio-contact-links">
      <a href="mailto:${escapeHtml(mailTarget)}">${escapeHtml(email)}</a>
      <a href="tel:${escapeHtml(phoneTarget)}">${escapeHtml(phone)}</a></div>`;
  }

  function recordList(entries, total, emptyMessage) {
    const count = `${entries.length} / ${total} kayıt`;
    return `<p class="studio-results">${count}</p><div class="studio-records">${entries.join('') ||
      `<p class="studio-empty">${total ? 'Filtrelerinize uyan kayıt bulunamadı.' : emptyMessage}</p>`}</div>`;
  }

  function bookingsPage(csrf, params, bookings) {
    const route = '/admin/randevular';
    const filters = adminFilters(params, workshops, statuses);
    const query = escapeHtml(filterQuery(filters));
    const entries = bookings.filter(item =>
      (!filters.kategori || item.workshop === filters.kategori) &&
      (!filters.durum || item.status === filters.durum) &&
      searchable(filters.q, [item.name, item.email, item.phone, item.workshop, item.date, item.note])
    ).map(booking => `
      <article class="studio-record">
        <header class="studio-record-header">
          <div><h2>${escapeHtml(booking.name)}</h2><p>${escapeHtml(booking.workshop)}</p></div>
          <span class="studio-badge ${['is-new', 'is-done', 'is-muted'][statuses.indexOf(booking.status)]}">${booking.status}</span>
        </header>
        <dl class="studio-booking-meta">
          <div><dt>Tercih edilen tarih</dt><dd><time datetime="${escapeHtml(booking.date)}">${bookingDate.format(new Date(booking.date + 'T00:00:00Z'))}</time></dd></div>
          <div><dt>Katılımcı</dt><dd>${escapeHtml(booking.persons)}</dd></div>
          <div><dt>İletişim</dt><dd>${contactLinks(booking)}</dd></div>
        </dl>
        ${booking.note ? `<div class="studio-message-text"><strong>Talep notu</strong><p>${escapeHtml(booking.note)}</p></div>` : ''}
        <footer class="studio-record-footer">
          <form method="post" action="/admin/bookings/${booking.id}/status${query}" class="studio-status-form">
            <input type="hidden" name="csrf" value="${csrf}">
            <label for="status-${booking.id}">Talep durumu</label>
            <select class="input-preview" id="status-${booking.id}" name="status">
              ${statuses.map(status => `<option${status === booking.status ? ' selected' : ''}>${status}</option>`).join('')}
            </select>
            <button class="button">Durumu Kaydet</button>
          </form>
          <details class="studio-delete"><summary>Talebi sil</summary>
            <form method="post" action="/admin/bookings/${booking.id}/delete${query}">
              <input type="hidden" name="csrf" value="${csrf}">
              <p>Bu randevu talebi kalıcı olarak silinecek.</p>
              <button class="button secondary">Silme İşlemini Onayla</button>
            </form>
          </details>
        </footer>
      </article>`);
    const messages = { guncellendi: 'Randevu durumu güncellendi.', silindi: 'Randevu talebi silindi.' };
    const result = params.get('sonuc');
    return panel('Randevu Talepleri', `
      ${summaryCards([['Toplam talep', bookings.length], ...statuses.map((status, index) =>
        [status, bookings.filter(item => item.status === status).length, ['is-new', 'is-done', 'is-muted'][index]])])}
      ${filtersForm(route, filters, 'Atölye', workshops, statuses, 'İsim, e-posta, telefon veya not')}
      ${Object.hasOwn(messages, result) ? `<p class="form-status" role="status">${messages[result]}</p>` : ''}
      ${recordList(entries, bookings.length, 'Henüz randevu talebi yok.')}
    `, csrf, route);
  }

  function messagesPage(csrf, params, messages) {
    const route = '/admin/mesajlar';
    const filters = adminFilters(params, subjects, messageStatuses);
    const query = escapeHtml(filterQuery(filters));
    const unread = messages.filter(item => !item.is_read).length;
    const entries = messages.filter(item =>
      (!filters.kategori || item.subject === filters.kategori) &&
      (!filters.durum || filters.durum === messageStatuses[item.is_read]) &&
      searchable(filters.q, [item.name, item.email, item.phone, item.subject, item.message])
    ).map(item => `
      <article class="studio-record${item.is_read ? '' : ' studio-record-unread'}">
        <header class="studio-record-header">
          <div><h2>${escapeHtml(item.subject)}</h2><p>${escapeHtml(item.name)} ·
            <time datetime="${escapeHtml(item.received_at)}">${messageDate.format(new Date(item.received_at))}</time></p></div>
          <span class="studio-badge ${item.is_read ? 'is-muted' : 'is-new'}">${messageStatuses[item.is_read]}</span>
        </header>
        ${contactLinks(item)}
        <p class="studio-message-text">${escapeHtml(item.message)}</p>
        <footer class="studio-record-footer">
          <form method="post" action="/admin/mesajlar/${item.id}/durum${query}">
            <input type="hidden" name="csrf" value="${csrf}">
            <button class="button secondary" name="read" value="${item.is_read ? 0 : 1}">${item.is_read ? 'Okunmadı Olarak İşaretle' : 'Okundu Olarak İşaretle'}</button>
          </form>
        </footer>
      </article>`);
    return panel('İletişim Mesajları', `
      ${summaryCards([['Toplam mesaj', messages.length], ['Okunmadı', unread, 'is-new'], ['Okundu', messages.length - unread, 'is-muted']])}
      ${filtersForm(route, filters, 'Konu', subjects, messageStatuses, 'Gönderici, e-posta veya mesaj')}
      ${params.get('sonuc') === 'guncellendi' ? '<p class="form-status" role="status">Mesaj durumu güncellendi.</p>' : ''}
      ${recordList(entries, messages.length, 'Henüz iletişim mesajı yok.')}
    `, csrf, route);
  }
  async function handle(request, response) {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    response.setHeader('Content-Security-Policy', [
      "default-src 'self'", "script-src 'self'", "style-src 'self' https://fonts.googleapis.com",
      "style-src-attr 'unsafe-inline'", "font-src 'self' https://fonts.gstatic.com", "img-src 'self' data:",
      "object-src 'none'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'"
    ].join('; '));
    if (production) response.setHeader('Strict-Transport-Security', 'max-age=31536000');
    if (localHostOnly &&
        !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(request.headers.host || '')) {
      return html(response, 421, page('Geçersiz sunucu adresi', ''));
    }
    if (!request.url.startsWith('/') || request.url.startsWith('//')) {
      return html(response, 400, page('Geçersiz adres', ''));
    }
    const url = new URL(request.url, 'http://localhost');
    const path = decodeURIComponent(url.pathname);
    pruneLimits(Date.now());
    if (request.method === 'POST' && !sameOrigin(request)) {
      return html(response, 403, page('İşlem reddedildi', '<p>Formu site üzerinden yeniden gönderin.</p>'));
    }
    if (request.method === 'POST' && ['/mesaj', '/randevu'].includes(path) && !submissionAllowed(request, response)) return;

    const { settings, content, insert, list, update, remove, saveMessage, listMessages, setMessageRead,
      getSession, saveSession, pruneSessions, deleteSession } = await application();
    if (path === '/admin' || path.startsWith('/admin/')) {
      const token = /(?:^|;\s*)caju_admin=([a-f0-9]{64})(?:;|$)/.exec(request.headers.cookie || '')?.[1];
      const now = Date.now();
      const hash = token && tokenHash(token);
      const session = hash && await getSession.get(hash, now);
      const username = await settings.username();
      if (!username) return html(response, 503, page('Yönetim paneli kapalı', '<p>Yönetici erişimi henüz yapılandırılmadı.</p>'));

      if (path === '/admin/login') {
        if (session) return redirect(response, '/admin');
        if (request.method === 'GET') {
          const changed = url.searchParams.get('hesap') === 'guncellendi';
          return html(response, 200, loginPage(changed ? 'Hesabınız güncellendi. Yeni bilgilerinizle giriş yapın.' : '', 'status'));
        }
        if (request.method === 'POST') {
          const form = await readForm(request, 4096);
          const client = request.socket.remoteAddress;
          let attempt = loginAttempts.get(client);
          if (attempt?.until <= now) {
            loginAttempts.delete(client);
            attempt = undefined;
          }
          if (attempt?.count >= 10 || (!attempt && loginAttempts.size >= 10000)) {
            response.setHeader('Retry-After', Math.max(1, Math.ceil(((attempt?.until || now + 60000) - now) / 1000)));
            return html(response, 429, loginPage('Çok fazla deneme yapıldı. Birkaç dakika sonra tekrar deneyin.'));
          }
          attempt ??= { count: 0, until: now + 5 * 60 * 1000 };
          attempt.count += 1;
          loginAttempts.set(client, attempt);
          const account = await settings.authenticate(form.get('username'), form.get('password'));
          if (!account) {
            return html(response, 401, loginPage('Kullanıcı adı veya parola hatalı.'));
          }
          if (loginAttempts.get(client) === attempt) loginAttempts.delete(client);
          await pruneSessions.run(now);
          const newToken = randomBytes(32).toString('hex');
          await saveSession.run(tokenHash(newToken), randomBytes(32).toString('hex'), now + sessionSeconds * 1000,
            account.username, account.password_hash);
          response.setHeader('Set-Cookie', `caju_admin=${newToken}; ${cookieFlags}; Max-Age=${sessionSeconds}`);
          return redirect(response, '/admin');
        }
      }
      if (!session) return redirect(response, '/admin/login');
      const { csrf } = session;
      if (request.method === 'GET' && path === '/admin') {
        return html(response, 200, panel('Yazılar', await content.dashboard(csrf, url.searchParams.get('sonuc')), csrf, '/admin'));
      }
      if (request.method === 'GET' && path === '/admin/randevular') return html(response, 200, bookingsPage(csrf, url.searchParams, await list.all()));
      if (request.method === 'GET' && path === '/admin/mesajlar') return html(response, 200, messagesPage(csrf, url.searchParams, await listMessages.all()));
      if (request.method === 'GET' && path === '/admin/hesap') return html(response, 200, accountPage(csrf, username));
      if (request.method === 'GET' && path === '/admin/site') {
        const feedback = url.searchParams.get('sonuc') === 'kaydedildi' ? 'Site ayarları kaydedildi.' : '';
        return html(response, 200, customizationPage(csrf, await settings.read(), feedback));
      }

      const article = /^\/admin\/yazilar\/(yeni|[1-9]\d*)(?:\/(yayinla|sil))?$/.exec(path);
      if (article && request.method === 'GET' && !article[2]) {
        const post = article[1] === 'yeni' ? null : await content.find(article[1]);
        if (article[1] === 'yeni' || post) {
          return html(response, 200, panel(post ? 'Yazıyı Düzenle' : 'Yeni Yazı', content.editor(csrf, post), csrf, '/admin'));
        }
      }
      if (request.method === 'POST') {
        const form = await readForm(request, article ? 300000 : 16384);
        if (!(await getSession.get(hash, Date.now()))) return redirect(response, '/admin/login');
        if (form.get('csrf') !== csrf) return html(response, 403, page('İşlem reddedildi', '<p>Yönetim panelini yenileyip tekrar deneyin.</p>'));
        if (path === '/admin/logout') {
          await deleteSession.run(hash);
          response.setHeader('Set-Cookie', `caju_admin=; ${cookieFlags}; Max-Age=0`);
          return redirect(response, '/admin/login');
        }
        if (path === '/admin/hesap') {
          const message = await settings.changeAccount(form);
          if (message) return html(response, 400, accountPage(csrf, username, message));
          await deleteSession.run(hash);
          response.setHeader('Set-Cookie', `caju_admin=; ${cookieFlags}; Max-Age=0`);
          return redirect(response, '/admin/login?hesap=guncellendi');
        }
        if (path === '/admin/site') {
          const values = settings.readFields(form);
          if (!(await settings.store(values))) {
            return html(response, 400, customizationPage(csrf, values, 'Duyuru en fazla 180, başlık 120 ve açıklama 300 karakter olabilir.', 'alert'));
          }
          return redirect(response, '/admin/site?sonuc=kaydedildi');
        }
        if (article && (article[1] !== 'yeni' || !article[2])) {
          const [, id, action] = article;
          if (id === 'yeni' || (await content.find(id))) {
            try {
              const result = await content.change(id, action, form);
              if (result) return redirect(response, '/admin?sonuc=' + result);
            } catch (error) {
              if (error.status !== 400) throw error;
              return html(response, 400, panel('Yazıyı Kontrol Edin', content.editor(csrf, content.formDraft(id, form), error.message), csrf, '/admin'));
            }
          }
        }
        const booking = /^\/admin\/bookings\/(\d+)\/(status|delete)$/.exec(path);
        if (booking) {
          const id = Number(booking[1]);
          const status = form.get('status');
          if (booking[2] === 'status' && !statuses.includes(status)) {
            return html(response, 400, page('Geçersiz talep durumu', '<p>Listeden bir durum seçin.</p>'));
          }
          const result = await (booking[2] === 'delete' ? remove.run(id) : update.run(status, id));
          if (result.changes) {
            const filters = adminFilters(url.searchParams, workshops, statuses);
            return redirect(response, '/admin/randevular' + filterQuery(filters, booking[2] === 'delete' ? 'silindi' : 'guncellendi'));
          }
        }
        const message = /^\/admin\/mesajlar\/(\d+)\/durum$/.exec(path);
        if (message) {
          const read = form.get('read');
          if (read !== '0' && read !== '1') return html(response, 400, page('Geçersiz mesaj durumu', ''));
          if ((await setMessageRead.run(Number(read), message[1])).changes) {
            const filters = adminFilters(url.searchParams, subjects, messageStatuses);
            return redirect(response, '/admin/mesajlar' + filterQuery(filters, 'guncellendi'));
          }
        }
      }
    }

    if (request.method === 'POST' && path === '/mesaj') {
      const form = await readForm(request);
      const fields = Object.fromEntries(['contactName', 'contactEmail', 'contactPhone', 'contactSubject', 'contactMsg'].map(
        field => [field, (form.get(field) || '').trim()]
      ));
      const { contactName, contactEmail, contactPhone, contactSubject, contactMsg } = fields;
      if (!validContact(contactName, contactEmail, contactPhone) || !subjects.includes(contactSubject) || !contactMsg || contactMsg.length > 1500) {
        return renderContact(response, 400,
          'Adınızı, geçerli e-posta ve telefon numaranızı, konuyu ve en fazla 1.500 karakterlik mesajınızı girin.', {
            marker: 'message-status',
            fields: { contactName, contactEmail, contactPhone },
            choices: subjects.includes(contactSubject) ? [contactSubject] : [],
            textarea: 'contactMsg',
            text: contactMsg
          });
      }
      await saveMessage.run(contactName, contactEmail, contactPhone, contactSubject, contactMsg);
      return redirect(response, '/iletisim.html?mesaj=alindi#mesaj');
    }

    if (request.method === 'POST' && path === '/randevu') {
      const form = await readForm(request);
      const values = Object.fromEntries(['name', 'email', 'phone', 'workshop', 'date', 'persons', 'note'].map(
        field => [field, (form.get(field) || '').trim()]
      ));
      const { name, email, phone, workshop, date, persons, note } = values;
      const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Istanbul' }).format(new Date());
      const parsedDate = new Date(date + 'T00:00:00Z');
      const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(parsedDate.getTime()) &&
        parsedDate.toISOString().slice(0, 10) === date && date >= today;
      if (!validContact(name, email, phone) ||
          !workshops.includes(workshop) || !validDate || !groups.includes(persons) || note.length > 1000) {
        return renderContact(response, 400,
          'Adınızı, geçerli bir e-posta ve telefon numarası ile bugünden itibaren bir tarih girin. Not en fazla 1.000 karakter olabilir.', {
            marker: 'booking-status',
            fields: { name, email, phone, date },
            choices: [workshops.includes(workshop) && workshop, groups.includes(persons) && persons],
            textarea: 'note',
            text: note
          });
      }

      await insert.run(name, email, phone, workshop, date, persons, note);
      return redirect(response, '/iletisim.html?talep=alindi#randevu');
    }

    if (request.method === 'GET' && path === '/iletisim.html') {
      if (url.searchParams.get('talep') === 'alindi') {
        return renderContact(response, 200, 'Randevu talebiniz alındı. Ekibimiz kontenjan teyidi için sizinle iletişime geçecek.', { marker: 'booking-status' });
      }
      if (url.searchParams.get('mesaj') === 'alindi') {
        return renderContact(response, 200, 'Mesajınız alındı. Atölye ekibi sizinle iletişime geçecek.', { marker: 'message-status' });
      }
    }

    const file = path === '/' ? 'index.html' : path.slice(1);
    const image = /^images\/(?:urunler\/)?[^/\\:\x00-\x1f]+\.(?:jpe?g|png)$/i.test(file);
    if (['GET', 'HEAD'].includes(request.method) && (pages.has(file) || image)) {
      try {
        let body = await readAsset(file);
        if (file === 'index.html') {
          const [{ announcement, heroTitle, heroIntro }, publishedSection] = await Promise.all([settings.read(), content.publicSection()]);
          const template = body.toString('utf8')
            .replace('<!-- site-announcement -->', () => announcement ? `<p class="site-announcement">${escapeHtml(announcement)}</p>` : '')
            .replace(/<!-- hero-title -->([\s\S]*?)<!-- \/hero-title -->/, (_, fallback) => heroTitle ? escapeHtml(heroTitle) : fallback)
            .replace(/<!-- hero-intro -->([\s\S]*?)<!-- \/hero-intro -->/, (_, fallback) => heroIntro ? escapeHtml(heroIntro) : fallback)
            .replace('<!-- published-content -->', () => publishedSection);
          body = Buffer.from(template);
          response.setHeader('Cache-Control', 'no-cache');
        }
        response.writeHead(200, { 'Content-Type': mime[extname(file).toLowerCase()], 'Content-Length': body.length });
        return response.end(request.method === 'HEAD' ? undefined : body);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    return html(response, 404, page('Sayfa bulunamadı', ''));
  }

  function handler(request, response) {
    return handle(request, response).catch(error => {
      if (response.destroyed) return;
      if (error.storageUnavailable) {
        console.error(error.code);
        return html(response, 503, page('Hizmet geçici olarak kullanılamıyor', '<p>Lütfen daha sonra tekrar deneyin.</p>'));
      }
      if (error.status) {
        if (closeInvalidRequests) response.setHeader('Connection', 'close');
        return html(response, error.status, page('Form gönderilemedi', `<p>${escapeHtml(error.message)}</p>`));
      }
      if (error instanceof URIError) return html(response, 400, page('Geçersiz adres', ''));
      console.error(error.code || error.name);
      return html(response, 500, page('Bir sorun oluştu', '<p>Lütfen daha sonra tekrar deneyin.</p>'));
    });
  }

  return { handler, initialize: application };
}

module.exports = { createApplication };
