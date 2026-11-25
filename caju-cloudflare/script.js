/**
 * CAJU CLAY — El Yapımı Seramik & Atölye
 * Gezinme, koleksiyon filtreleme ve ürün galerileri
 */

document.addEventListener('DOMContentLoaded', () => {

  // ----------------------------------------------------
  // 1. KOLEKSİYON SAYFASI KATEGORİ FİLTRELEME (koleksiyon.html)
  // ----------------------------------------------------
  const filterBtns = document.querySelectorAll('.filter-btn');
  const productItems = document.querySelectorAll('.product-item');

  if (filterBtns.length > 0 && productItems.length > 0) {
    filterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        filterBtns.forEach(button => button.setAttribute('aria-pressed', String(button === btn)));

        const filter = btn.dataset.filter;

        productItems.forEach(item => {
          if (filter === 'all' || item.dataset.category === filter) {
            item.style.display = 'flex';
          } else {
            item.style.display = 'none';
          }
        });
      });
    });
    filterBtns.forEach(button => button.setAttribute('aria-pressed', String(button.classList.contains('active'))));
    const openLinkedCategory = () => {
      const linkedId = window.location.hash.slice(1);
      if (!linkedId) return;

      const linkedFilter = Array.from(filterBtns).find(button => button.id === linkedId);
      linkedFilter?.click();
    };
    window.addEventListener('hashchange', openLinkedCategory);
    openLinkedCategory();
  }

  // ----------------------------------------------------
  // Mobil menü ve kaydırma gölgesi
  // ----------------------------------------------------
  const navbar = document.querySelector('.navbar');
  if (navbar) {
    const menu = navbar.querySelector('.navbar-menu');
    const toggle = navbar.querySelector('.nav-toggle');
    if (menu && toggle) {
      const mobile = window.matchMedia('(max-width: 950px)');
      navbar.classList.add('has-mobile-menu');

      const isOpen = () => toggle.getAttribute('aria-expanded') === 'true';
      const setOpen = open => {
        toggle.setAttribute('aria-expanded', String(open));
        menu.classList.toggle('is-open', open);
      };
      toggle.addEventListener('click', () => setOpen(!isOpen()));
      menu.addEventListener('click', event => {
        const link = event.target.closest('a[href]');
        if (!mobile.matches || !link) return;
        setOpen(false);
        if (link.getAttribute('href').startsWith('#')) {
          const destination = document.getElementById(link.hash.slice(1));
          if (destination) {
            destination.setAttribute('tabindex', '-1');
            destination.focus({ preventScroll: true });
          }
        }
      });
      document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && isOpen()) {
          setOpen(false);
          toggle.focus();
        }
      });
      document.addEventListener('pointerdown', event => {
        if (!navbar.contains(event.target) && isOpen()) setOpen(false);
      });
      mobile.addEventListener('change', () => {
        if (mobile.matches && menu.contains(document.activeElement)) toggle.focus();
        if (!mobile.matches && document.activeElement === toggle) menu.querySelector('a')?.focus();
        setOpen(false);
      });
    }

    window.addEventListener('scroll', () => {
      if (window.scrollY > 40) {
        navbar.style.boxShadow = '0 4px 20px rgba(107, 80, 64, 0.08)';
      } else {
        navbar.style.boxShadow = 'none';
      }
    });
  }

});

// Her dokunuşta küçük bir yürüyüş izi oluşturan dört pati.
(() => {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  document.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    const steps = [{ x: -21, y: 23 }, { x: 9, y: 5 }, { x: -6, y: -21 }, { x: 24, y: -39 }];
    const existingPaws = [...document.querySelectorAll('.caju-paw')];
    existingPaws.slice(0, Math.max(0, existingPaws.length + steps.length - 32)).forEach(paw => paw.remove());
    steps.forEach((step, stepIndex) => {
      const paw = document.createElement('span');
      paw.className = 'caju-paw';
      paw.setAttribute('aria-hidden', 'true');
      paw.style.left = `${Math.max(14, Math.min(window.innerWidth - 14, event.clientX + step.x))}px`;
      paw.style.top = `${Math.max(14, Math.min(window.innerHeight - 14, event.clientY + step.y))}px`;
      paw.style.setProperty('--paw-angle', `${stepIndex % 2 === 0 ? -15 : 12}deg`);
      const delay = reducedMotion.matches ? 0 : stepIndex * 85;
      paw.style.animationDelay = `${delay}ms`;
      paw.style.animationFillMode = 'both';
      if (reducedMotion.matches) paw.classList.add('caju-paw-still');
      for (let index = 0; index < 5; index += 1) {
        const pad = document.createElement('span');
        pad.className = `caju-paw-pad caju-paw-pad-${index}`;
        paw.appendChild(pad);
      }
      document.body.appendChild(paw);
      window.setTimeout(() => paw.remove(), 850 + delay);
    });
  }, { passive: true });
})();
// Ürün kartlarında farklı açı ve kullanım fotoğrafları.
document.addEventListener('click', (event) => {
 const thumb = event.target.closest('.product-thumb');
 if (!thumb) return;
 const card = thumb.closest('.added-product');
 card.querySelector('.product-main-image').src = thumb.dataset.photo;
 card.querySelectorAll('.product-thumb').forEach(button => {
  const selected = button === thumb;
  button.classList.toggle('is-selected', selected);
  button.setAttribute('aria-pressed', String(selected));
 });
});
