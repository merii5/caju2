const blocks = document.getElementById('editor-blocks');
const template = document.getElementById('editor-block-template');
const addButton = document.getElementById('add-block');
const status = document.getElementById('editor-status');
const maxBlocks = Number(blocks.dataset.max);

function refreshControls() {
  const items = Array.from(blocks.children);
  addButton.disabled = items.length >= maxBlocks;
  items.forEach((block, index) => {
    block.querySelector('legend').textContent = 'İçerik bloğu ' + (index + 1);
    block.querySelector('[data-block-actions]').hidden = false;
    block.querySelector('[data-block-action="up"]').disabled = index === 0;
    block.querySelector('[data-block-action="down"]').disabled = index === items.length - 1;
    block.querySelector('[data-block-action="remove"]').disabled = items.length === 1;
  });
}

addButton.hidden = false;
addButton.addEventListener('click', () => {
  if (blocks.children.length >= maxBlocks) return;
  blocks.append(template.content.cloneNode(true));
  refreshControls();
  blocks.lastElementChild.querySelector('select').focus();
  status.textContent = 'Blok eklendi.';
});

blocks.addEventListener('click', event => {
  const control = event.target.closest('[data-block-action]');
  if (!control || control.disabled) return;
  const block = control.closest('fieldset');
  const previous = block.previousElementSibling;
  const next = block.nextElementSibling;

  switch (control.dataset.blockAction) {
    case 'up':
      blocks.insertBefore(block, previous);
      status.textContent = 'Blok yukarı taşındı.';
      break;
    case 'down':
      blocks.insertBefore(next, block);
      status.textContent = 'Blok aşağı taşındı.';
      break;
    case 'remove':
      block.remove();
      status.textContent = 'Blok kaldırıldı.';
      break;
  }

  refreshControls();
  (block.isConnected ? block : next || previous).querySelector('select').focus();
});

refreshControls();
