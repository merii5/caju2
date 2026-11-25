const types = { heading: 'Başlık', paragraph: 'Paragraf', quote: 'Alıntı' };
const maxBlocks = 20;

async function createContent(db, escape) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      blocks TEXT NOT NULL,
      published_title TEXT,
      published_blocks TEXT,
      published_at TEXT
    );
  `);

  const select = db.prepare('SELECT * FROM articles WHERE id = ?');
  const all = db.prepare('SELECT * FROM articles ORDER BY id DESC');
  const published = db.prepare('SELECT published_title, published_blocks FROM articles WHERE published_at IS NOT NULL ORDER BY published_at DESC, id DESC');
  const insert = db.prepare('INSERT INTO articles (title, blocks) VALUES (?, ?)');
  const save = db.prepare('UPDATE articles SET title = ?, blocks = ? WHERE id = ?');
  const insertPublished = db.prepare(`INSERT INTO articles (title, blocks, published_title, published_blocks, published_at)
    VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`);
  const savePublished = db.prepare(`UPDATE articles SET title = ?, blocks = ?, published_title = ?, published_blocks = ?,
    published_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`);
  const publish = db.prepare(`UPDATE articles SET published_title = title,
    published_blocks = blocks, published_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`);
  const remove = db.prepare('DELETE FROM articles WHERE id = ?');

  function formDraft(id, form) {
    const blockTypes = form.getAll('blockType');
    const texts = form.getAll('blockText');
    return {
      id,
      title: (form.get('title') || '').trim(),
      blocks: blockTypes.slice(0, maxBlocks).map((type, index) => ({ type, text: (texts[index] || '').trim() }))
    };
  }

  async function change(id, action, form) {
    if (action === 'sil') return (await remove.run(id)).changes ? 'silindi' : null;
    if (action === 'yayinla') return (await publish.run(id)).changes ? 'yayinlandi' : null;

    const { title, blocks } = formDraft(id, form);
    if (!title || title.length > 120 || !blocks.length || form.getAll('blockType').length > maxBlocks ||
        form.getAll('blockText').length !== blocks.length ||
        blocks.some(block => !Object.hasOwn(types, block.type) || !block.text || block.text.length > 1500)) {
      throw Object.assign(new Error('En fazla 120 karakterlik bir yazı başlığı ve 1–20 dolu blok girin. Her blok en fazla 1.500 karakter olabilir.'), { status: 400 });
    }
    const encoded = JSON.stringify(blocks);
    const publishNow = form.get('intent') === 'publish';
    if (publishNow) {
      const values = [title, encoded, title, encoded];
      const result = await (id === 'yeni' ? insertPublished.run(...values) : savePublished.run(...values, id));
      return result.changes ? 'yayinlandi' : null;
    }
    const result = await (id === 'yeni' ? insert.run(title, encoded) : save.run(title, encoded, id));
    return result.changes ? 'kaydedildi' : null;
  }

  async function dashboard(csrf, result) {
    const messages = { kaydedildi: 'Taslak kaydedildi.', yayinlandi: 'Yazı yayınlandı.', silindi: 'Yazı silindi.' };
    const entries = (await all.all()).map(post => {
      const hasChanges = post.title !== post.published_title || post.blocks !== post.published_blocks;
      const status = post.published_at ? (hasChanges ? 'Yayında · Taslak değişikliği var' : 'Yayında') : 'Taslak';
      return `<article class="panel article-row">
        <div><h2>${escape(post.title)}</h2><p>${status}</p></div>
        <div class="admin-actions">
          <a class="button secondary" href="/admin/yazilar/${post.id}">Düzenle</a>
          ${hasChanges ? `<form method="post" action="/admin/yazilar/${post.id}/yayinla">
            <input type="hidden" name="csrf" value="${csrf}"><button class="button">Yayınla</button></form>` : ''}
          <details><summary>Sil</summary><form method="post" action="/admin/yazilar/${post.id}/sil">
            <input type="hidden" name="csrf" value="${csrf}">
            <p>Yazı ve yayınlanan sürümü kalıcı olarak silinecek.</p>
            <button class="button secondary">Yazıyı Kalıcı Olarak Sil</button></form></details>
        </div></article>`;
    }).join('');

    return `<div class="admin-actions"><a class="button" href="/admin/yazilar/yeni">Yeni Yazı Ekle</a>
      <a href="/#atolye-yazilari">Sitedeki Yazıları Gör</a></div>
      ${Object.hasOwn(messages, result) ? `<p role="status">${messages[result]}</p>` : ''}
      ${entries || '<p>Henüz yazı eklenmedi.</p>'}`;
  }

  function blockFields(block = { type: 'paragraph', text: '' }) {
    return `<fieldset class="editor-block"><legend>İçerik bloğu</legend>
      <label>Blok türü <select class="input-preview" name="blockType">
        ${Object.entries(types).map(([type, label]) => `<option value="${type}"${block.type === type ? ' selected' : ''}>${label}</option>`).join('')}
      </select></label>
      <label>Blok metni <textarea class="input-preview note" name="blockText" maxlength="1500" required>${escape(block.text)}</textarea></label>
      <div class="admin-actions" data-block-actions hidden>
        <button type="button" data-block-action="up">Yukarı Taşı</button>
        <button type="button" data-block-action="down">Aşağı Taşı</button>
        <button type="button" data-block-action="remove">Bloğu Kaldır</button>
      </div></fieldset>`;
  }

  function editor(csrf, post, message = '') {
    const blocks = post?.blocks?.length ? post.blocks : [undefined];
    return `<form class="panel booking-fields" method="post" action="/admin/yazilar/${post?.id || 'yeni'}">
      <input type="hidden" name="csrf" value="${csrf}">
      ${message ? `<p role="alert">${escape(message)}</p>` : ''}
      <label for="post-title">Yazı başlığı</label>
      <input class="input-preview" id="post-title" name="title" required maxlength="120" value="${escape(post?.title || '')}">
      <div id="editor-blocks" data-max="${maxBlocks}">${blocks.map(blockFields).join('')}</div>
      <template id="editor-block-template">${blockFields()}</template>
      <div class="admin-actions">
        <button class="button secondary" id="add-block" type="button" hidden>Blok Ekle</button>
        <button class="button secondary" name="intent" value="save">Taslağı Kaydet</button>
        <button class="button" name="intent" value="publish">Kaydet ve Yayınla</button>
      </div>
      <p id="editor-status" role="status"></p>
    </form><script src="/admin-editor.js" defer></script>`;
  }

  async function publicSection() {
    const posts = await published.all();
    if (!posts.length) return '';
    const tags = { heading: 'h4', paragraph: 'p', quote: 'blockquote' };
    return `<section id="atolye-yazilari" class="section">
      <div class="section-heading"><h2>Atölyeden Yazılar</h2></div>
      <div class="published-articles">${posts.map(post => `<article class="panel">
        <h3>${escape(post.published_title)}</h3>
        ${JSON.parse(post.published_blocks).map(({ type, text }) => `<${tags[type]}>${escape(text)}</${tags[type]}>`).join('')}
      </article>`).join('')}</div></section>`;
  }

  async function find(id) {
    const post = await select.get(id);
    return post && { ...post, blocks: JSON.parse(post.blocks) };
  }

  return { dashboard, editor, publicSection, find, change, formDraft };
}

module.exports = { createContent };
