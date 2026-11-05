const app = document.getElementById('app');

let magicWord = localStorage.getItem('shop_magic_word') || '';
let cart = loadSavedCart();
let items = [];
let footprint = '';
let notice = null; // { type: 'success' | 'error', text: string }

function loadSavedCart() {
  try {
    const raw = localStorage.getItem('shop_cart');
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function saveCart() {
  try {
    localStorage.setItem('shop_cart', JSON.stringify(cart));
  } catch (_) {}
}

function getCartCount() {
  return Object.values(cart).reduce((sum, qty) => sum + (Number(qty) || 0), 0);
}

function getCartTotal() {
  return items.reduce((sum, it) => sum + (cart[it.id] || 0) * it.price, 0);
}

function syncCartWithStock() {
  if (!Array.isArray(items) || items.length === 0) return;
  const itemMap = new Map(items.map(it => [Number(it.id), it]));
  let changed = false;
  for (const [idStr, qty] of Object.entries(cart)) {
    const id = Number(idStr);
    const it = itemMap.get(id);
    if (!it || it.stock <= 0) {
      delete cart[idStr];
      changed = true;
    } else if (qty > it.stock) {
      cart[idStr] = it.stock;
      changed = true;
    }
  }
  if (changed) saveCart();
}

// Generate deterministic hardware + browser footprint hash
async function getFootprint() {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.textBaseline = 'top';
  ctx.font = '14px Arial';
  ctx.fillText('dorm-shop-fp', 2, 2);

  let glRenderer = '';
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    if (dbg) glRenderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
  } catch (_) {}

  const raw = [
    navigator.userAgent,
    navigator.language,
    screen.width + 'x' + screen.height + 'x' + screen.colorDepth,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    navigator.hardwareConcurrency || '',
    canvas.toDataURL(),
    glRenderer
  ].join('|');

  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}

// SVG Icons (Strict no-emoji icon system)
const ICONS = {
  lock: `<svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`,
  store: `<svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>`,
  cart: `<svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>`,
  refresh: `<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>`,
  box: `<svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>`,
  trash: `<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`,
  arrowLeft: `<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>`,
  shieldAlert: `<svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`,
  checkCircle: `<svg class="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`
};

function navigate(path, replace = false) {
  if (window.location.pathname !== path) {
    if (replace) {
      window.history.replaceState({}, '', path);
    } else {
      window.history.pushState({}, '', path);
    }
  }
  route();
}

window.addEventListener('popstate', () => {
  route();
});

async function init() {
  footprint = await getFootprint();

  if (!magicWord) {
    navigate('/login', true);
    return;
  }

  const ok = await fetchItems();
  if (!ok) return;
  route();
}

// Strict 3-state router:
// 1) /login — when unauthenticated (cannot go to / or /page by removing /login)
//    When authenticated, cannot go from / or /page to /login by typing /login
// 2) /page — main shop item list
// 3) /cart — order & cart page (only accessible if cart has items)
function route() {
  const path = window.location.pathname;

  // Guard 1: If magic word is not set, force /login
  if (!magicWord) {
    if (path !== '/login') {
      window.history.replaceState({}, '', '/login');
    }
    renderLogin();
    return;
  }

  // Guard 2: Authenticated users cannot go to /login or stay on /
  if (path === '/login' || path === '/' || (path !== '/page' && path !== '/cart')) {
    window.history.replaceState({}, '', '/page');
    renderShop();
    return;
  }

  // Guard 3: /cart is only accessible if there is at least 1 item selected
  if (path === '/cart') {
    if (getCartCount() === 0) {
      window.history.replaceState({}, '', '/page');
      renderShop();
      return;
    }
    renderCart();
    return;
  }

  renderShop();
}

async function fetchItems() {
  try {
    const res = await fetch('/api/shop/items', {
      headers: { 'X-Magic-Word': magicWord, 'X-Device-Footprint': footprint }
    });
    if (res.status === 401 || res.status === 403) {
      const errText = await res.text();
      localStorage.removeItem('shop_magic_word');
      magicWord = '';
      window.history.replaceState({}, '', '/login');
      renderLogin(errText || 'Нэвтрэх эрх хүчингүй болсон байна.');
      return false;
    }
    items = (await res.json()) || [];
    syncCartWithStock();
    return true;
  } catch (_) {
    notice = { type: 'error', text: 'Сервертэй холбогдоход алдаа гарлаа.' };
    return true;
  }
}

function renderTopBar(activeView) {
  const totalItems = getCartCount();
  return `
    <header class="sticky top-0 z-30 surface-header">
      <div class="px-4 py-3 flex items-center justify-between gap-3">
        <div class="flex items-center gap-2.5 min-w-0">
          <button type="button" id="brandHomeBtn" aria-label="217-Store барааны жагсаалт руу очих"
            class="flex items-center gap-2.5 text-left font-bold text-lg tracking-tight text-[var(--color-ink)] hover:opacity-90 cursor-pointer shrink-0">
            <span class="w-9 h-9 rounded-lg bg-[var(--color-paper-3)] border border-[var(--color-rule)] flex items-center justify-center text-[var(--color-accent)] shrink-0">
              ${ICONS.store}
            </span>
            <span class="whitespace-nowrap">217-Store</span>
          </button>

          <button type="button" id="navItemsBtn"
            class="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer whitespace-nowrap ${
              activeView === 'shop'
                ? 'bg-[var(--color-paper-3)] text-[var(--color-ink)] border border-[var(--color-rule)]'
                : 'text-[var(--color-ink-2)] hover:text-[var(--color-ink)]'
            }">
            Бараанууд
          </button>
        </div>

        <div class="flex items-center gap-2 shrink-0">
          ${
            totalItems > 0
              ? `
            <button type="button" id="topCartBtn" aria-label="Сагс болон захиалгын хуудас руу очих"
              class="relative inline-flex items-center gap-2 px-3.5 h-10 rounded-lg border transition-colors cursor-pointer ${
                activeView === 'cart'
                  ? 'bg-[var(--color-accent)] text-[var(--color-accent-ink)] border-transparent font-bold'
                  : 'bg-[var(--color-paper-2)] text-[var(--color-ink)] border-[var(--color-rule)] hover:bg-[var(--color-paper-3)] font-semibold'
              }">
              ${ICONS.cart}
              <span class="text-sm tabular-nums">${totalItems}</span>
            </button>
          `
              : ''
          }
        </div>
      </div>
    </header>
  `;
}

function bindTopBarEvents() {
  const brandBtn = document.getElementById('brandHomeBtn');
  if (brandBtn) {
    brandBtn.onclick = () => navigate('/page');
  }
  const navItemsBtn = document.getElementById('navItemsBtn');
  if (navItemsBtn) {
    navItemsBtn.onclick = () => navigate('/page');
  }
  const topCartBtn = document.getElementById('topCartBtn');
  if (topCartBtn) {
    topCartBtn.onclick = () => navigate('/cart');
  }
}

function renderNoticeBanner() {
  if (!notice) return '';
  const isError = notice.type === 'error';
  return `
    <div role="status" class="mb-4 p-3.5 rounded-xl border flex items-start justify-between gap-3 text-sm ${
      isError
        ? 'bg-[var(--color-danger-paper)] border-[var(--color-danger)] text-[var(--color-danger-ink)]'
        : 'bg-[var(--color-paper-2)] border-[var(--color-accent)] text-[var(--color-ink)]'
    }">
      <div class="flex items-center gap-2.5">
        ${isError ? ICONS.shieldAlert : ICONS.checkCircle}
        <span>${escapeHtml(notice.text)}</span>
      </div>
      <button type="button" id="dismissNoticeBtn" aria-label="Мэдэгдэл хаах" class="text-xs px-2 py-1 rounded hover:bg-black/20 cursor-pointer">Хаах</button>
    </div>
  `;
}

function bindNoticeEvents(rerenderFn) {
  const btn = document.getElementById('dismissNoticeBtn');
  if (btn) {
    btn.onclick = () => {
      notice = null;
      rerenderFn();
    };
  }
}

// STATE 1: /login
function renderLogin(errorMsg = '') {
  app.innerHTML = `
    <main class="flex-1 flex flex-col justify-center px-4 py-12">
      <div class="surface-card p-6 sm:p-8">
        <div class="flex items-center gap-3 mb-4">
          <div class="w-11 h-11 rounded-xl bg-[var(--color-paper-3)] border border-[var(--color-rule)] flex items-center justify-center text-[var(--color-accent)]">
            ${ICONS.lock}
          </div>
          <div>
            <h1 class="text-2xl font-bold tracking-tight">217-Store</h1>
            <p class="text-sm text-[var(--color-ink-2)]">Дотуур байрны дотоод дэлгүүр</p>
          </div>
        </div>

        <p class="text-sm text-[var(--color-ink-2)] mb-6">
          Дэлгүүрийн барааны үлдэгдэл харах болон өрөөндөө захиалга өгөхийн тулд нууц үгээ оруулна уу.
        </p>

        ${
          errorMsg
            ? `<div role="alert" class="mb-4 p-3.5 rounded-xl border bg-[var(--color-danger-paper)] border-[var(--color-danger)] text-[var(--color-danger-ink)] text-sm flex items-center gap-2.5">
                ${ICONS.shieldAlert}
                <span>${escapeHtml(errorMsg)}</span>
              </div>`
            : ''
        }

        <form id="loginForm" class="space-y-4">
          <div>
            <label for="wordInput" class="block text-sm font-medium text-[var(--color-ink-2)] mb-1.5">Нууц үг</label>
            <input id="wordInput" name="magic_word" type="password" autocomplete="current-password" placeholder="Нууц үгээ бичнэ үү…" required
              class="input-field w-full px-4 h-12" />
          </div>
          <button type="submit" id="loginSubmitBtn" class="btn-primary w-full h-12 text-base flex items-center justify-center">
            Дэлгүүр рүү нэвтрэх
          </button>
        </form>

        <div class="mt-6 pt-4 border-t border-[var(--color-rule)] flex items-center justify-between text-xs text-[var(--color-muted)]">
          <span>Төхөөрөмжийн дугаар</span>
          <span class="font-mono tabular-nums">${footprint}</span>
        </div>
      </div>
    </main>
  `;

  const form = document.getElementById('loginForm');
  const input = document.getElementById('wordInput');
  const submitBtn = document.getElementById('loginSubmitBtn');

  form.onsubmit = async (e) => {
    e.preventDefault();
    const candidate = input.value.trim();
    if (!candidate) return;

    submitBtn.disabled = true;
    submitBtn.textContent = 'Шалгаж байна…';

    try {
      const res = await fetch('/api/shop/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Device-Footprint': footprint },
        body: JSON.stringify({ magic_word: candidate })
      });

      if (res.ok) {
        magicWord = candidate;
        localStorage.setItem('shop_magic_word', magicWord);
        await fetchItems();
        navigate('/page', true);
      } else {
        const txt = await res.text();
        renderLogin(txt.trim() || 'Нууц үг буруу байна.');
        const newInput = document.getElementById('wordInput');
        if (newInput) newInput.focus();
      }
    } catch (_) {
      renderLogin('Сервертэй холбогдож чадсангүй.');
    }
  };
}

// STATE 2: /page (Item list + small cart + floating bottom order button)
function renderShop() {
  const totalItems = getCartCount();
  const totalPrice = getCartTotal();

  app.innerHTML = `
    ${renderTopBar('shop')}

    <main class="flex-1 px-4 pt-5 pb-32">
      ${renderNoticeBanner()}

      <div class="flex items-center justify-between mb-4">
        <div>
          <h1 class="text-xl font-bold tracking-tight">Бэлэн байгаа бараанууд</h1>
          <p class="text-xs text-[var(--color-ink-2)]">Сагсандаа бараагаа нэмээд өрөөндөө захиалаарай</p>
        </div>
        <button type="button" id="refreshBtn" class="btn-secondary px-3 h-10 text-xs font-semibold inline-flex items-center gap-1.5">
          ${ICONS.refresh}
          <span>Шинэчлэх</span>
        </button>
      </div>

      <div class="space-y-3">
        ${
          items.length === 0
            ? `<div class="surface-card p-10 text-center">
                <div class="w-12 h-12 rounded-xl bg-[var(--color-paper-3)] mx-auto mb-3 flex items-center justify-center text-[var(--color-muted)]">
                  ${ICONS.box}
                </div>
                <p class="font-semibold text-[var(--color-ink)]">Одоогоор бараа дууссан байна</p>
                <p class="text-sm text-[var(--color-ink-2)] mt-1">Түр хүлээгээд «Шинэчлэх» товчийг дарж шалгана уу.</p>
              </div>`
            : items
                .map((it) => {
                  const qty = cart[it.id] || 0;
                  return `
                  <article class="surface-card p-3.5 flex items-center justify-between gap-3">
                    <div class="flex items-center gap-3.5 min-w-0">
                      ${
                        it.image_url
                          ? `<img src="${escapeAttr(it.image_url)}" alt="${escapeAttr(it.name)}" width="64" height="64" class="w-16 h-16 object-cover rounded-xl bg-[var(--color-paper-3)] shrink-0 border border-[var(--color-rule)]" />`
                          : `<div class="w-16 h-16 rounded-xl bg-[var(--color-paper-3)] border border-[var(--color-rule)] flex items-center justify-center text-[var(--color-muted)] shrink-0">${ICONS.box}</div>`
                      }
                      <div class="min-w-0">
                        <h2 class="font-semibold text-base text-[var(--color-ink)] truncate">${escapeHtml(it.name)}</h2>
                        <div class="text-[var(--color-accent)] font-bold text-base tabular-nums mt-0.5">${formatPrice(it.price)}</div>
                        <div class="text-xs text-[var(--color-ink-2)] tabular-nums mt-0.5">Үлдэгдэл: ${it.stock} ш</div>
                      </div>
                    </div>

                    <div class="flex items-center gap-2 shrink-0">
                      <button type="button" data-dec="${it.id}" aria-label="${escapeAttr(it.name)} тоог хасах"
                        ${qty === 0 ? 'disabled' : ''}
                        class="btn-secondary w-11 h-11 flex items-center justify-center text-lg font-bold disabled:opacity-40 disabled:cursor-not-allowed">
                        −
                      </button>
                      <span class="w-7 text-center font-bold tabular-nums text-base">${qty}</span>
                      <button type="button" data-inc="${it.id}" data-max="${it.stock}" aria-label="${escapeAttr(it.name)} сагсанд нэмэх"
                        ${qty >= it.stock ? 'disabled' : ''}
                        class="btn-primary w-11 h-11 flex items-center justify-center text-lg font-bold">
                        +
                      </button>
                    </div>
                  </article>
                `;
                })
                .join('')
        }
      </div>
    </main>

    ${
      totalItems > 0
        ? `
      <div class="fixed bottom-0 inset-x-0 z-40 pointer-events-none">
        <div class="max-w-lg mx-auto p-4 pointer-events-auto">
          <div class="surface-card p-3 shadow-2xl border-[var(--color-accent)]">
            <button type="button" id="floatingOrderBtn"
              class="btn-primary w-full h-12 px-4 flex items-center justify-between text-base">
              <span class="inline-flex items-center gap-2">
                ${ICONS.cart}
                <span>Захиалах (${totalItems} ш)</span>
              </span>
              <span class="font-extrabold tabular-nums">${formatPrice(totalPrice)}</span>
            </button>
          </div>
        </div>
      </div>
    `
        : ''
    }
  `;

  bindTopBarEvents();
  bindNoticeEvents(renderShop);

  const refreshBtn = document.getElementById('refreshBtn');
  if (refreshBtn) {
    refreshBtn.onclick = async () => {
      refreshBtn.disabled = true;
      await fetchItems();
      renderShop();
    };
  }

  document.querySelectorAll('[data-inc]').forEach((btn) => {
    btn.onclick = () => {
      const id = Number(btn.dataset.inc);
      const max = Number(btn.dataset.max);
      cart[id] = Math.min(max, (cart[id] || 0) + 1);
      saveCart();
      renderShop();
    };
  });

  document.querySelectorAll('[data-dec]').forEach((btn) => {
    btn.onclick = () => {
      const id = Number(btn.dataset.dec);
      if (cart[id] > 0) cart[id]--;
      if (cart[id] <= 0) delete cart[id];
      saveCart();
      renderShop();
    };
  });

  const floatingOrderBtn = document.getElementById('floatingOrderBtn');
  if (floatingOrderBtn) {
    floatingOrderBtn.onclick = () => {
      navigate('/cart');
    };
  }
}

// STATE 3: /cart (Cart management, exit to item list, remove items, room number input, floating bottom order button)
function renderCart() {
  const cartEntries = Object.entries(cart)
    .map(([idStr, qty]) => {
      const item = items.find((i) => i.id === Number(idStr));
      return item && qty > 0 ? { item, qty: Number(qty) } : null;
    })
    .filter(Boolean);

  if (cartEntries.length === 0) {
    navigate('/page', true);
    return;
  }

  const totalItems = getCartCount();
  const totalPrice = getCartTotal();
  const savedRoom = localStorage.getItem('shop_room_number') || '';

  app.innerHTML = `
    ${renderTopBar('cart')}

    <main class="flex-1 px-4 pt-5 pb-32">
      ${renderNoticeBanner()}

      <div class="flex items-center justify-between mb-4">
        <div>
          <h1 class="text-xl font-bold tracking-tight">Таны сагс</h1>
          <p class="text-xs text-[var(--color-ink-2)]">Нийт ${totalItems} ширхэг бараа сонгогдсон байна</p>
        </div>
        <button type="button" id="backToItemsBtn" class="btn-secondary px-3 h-10 text-xs font-semibold inline-flex items-center gap-1.5">
          ${ICONS.arrowLeft}
          <span>Бараа нэмэх</span>
        </button>
      </div>

      <div class="space-y-2.5 mb-6">
        ${cartEntries
          .map(
            ({ item, qty }) => `
          <div class="surface-card p-3.5 flex items-center justify-between gap-3">
            <div class="flex items-center gap-3 min-w-0">
              ${
                item.image_url
                  ? `<img src="${escapeAttr(item.image_url)}" alt="${escapeAttr(item.name)}" width="52" height="52" class="w-13 h-13 object-cover rounded-lg bg-[var(--color-paper-3)] border border-[var(--color-rule)] shrink-0" />`
                  : `<div class="w-12 h-12 rounded-lg bg-[var(--color-paper-3)] border border-[var(--color-rule)] flex items-center justify-center text-[var(--color-muted)] shrink-0">${ICONS.box}</div>`
              }
              <div class="min-w-0">
                <div class="font-semibold text-sm text-[var(--color-ink)] truncate">${escapeHtml(item.name)}</div>
                <div class="text-xs text-[var(--color-ink-2)] tabular-nums mt-0.5">
                  ${formatPrice(item.price)} × ${qty} ш = <span class="text-[var(--color-accent)] font-bold">${formatPrice(item.price * qty)}</span>
                </div>
              </div>
            </div>

            <div class="flex items-center gap-1.5 shrink-0">
              <button type="button" data-cart-dec="${item.id}" aria-label="${escapeAttr(item.name)} цөөлөх"
                class="btn-secondary w-9 h-9 flex items-center justify-center font-bold">
                −
              </button>
              <span class="w-6 text-center font-bold tabular-nums text-sm">${qty}</span>
              <button type="button" data-cart-inc="${item.id}" data-max="${item.stock}" aria-label="${escapeAttr(item.name)} нэмэх"
                ${qty >= item.stock ? 'disabled' : ''}
                class="btn-secondary w-9 h-9 flex items-center justify-center font-bold disabled:opacity-40">
                +
              </button>
              <button type="button" data-cart-remove="${item.id}" aria-label="${escapeAttr(item.name)} сагснаас хасах"
                class="ml-1 w-9 h-9 rounded-lg border border-[var(--color-rule)] bg-[var(--color-danger-paper)] text-[var(--color-danger-ink)] flex items-center justify-center hover:opacity-90 cursor-pointer">
                ${ICONS.trash}
              </button>
            </div>
          </div>
        `
          )
          .join('')}
      </div>

      <form id="checkoutForm" class="surface-card p-4 space-y-4">
        <div class="flex items-center justify-between pb-3 border-b border-[var(--color-rule)]">
          <span class="text-sm text-[var(--color-ink-2)]">Нийт төлөх дүн (${totalItems} бараа)</span>
          <span class="text-xl font-extrabold text-[var(--color-accent)] tabular-nums">${formatPrice(totalPrice)}</span>
        </div>

        <div>
          <label for="roomInput" class="block text-sm font-medium text-[var(--color-ink)] mb-1.5">
            Хүргүүлэх өрөөний дугаар
          </label>
          <input id="roomInput" name="room_number" type="text" inputmode="text" autocomplete="off"
            value="${escapeAttr(savedRoom)}"
            placeholder="Жишээ нь: 304" required
            class="input-field w-full px-4 h-12 font-semibold tabular-nums" />
        </div>

        <div class="p-3 rounded-xl bg-[var(--color-warn-paper)] border border-[var(--color-warn)] text-xs text-[var(--color-warn)] flex items-start gap-2.5">
          ${ICONS.shieldAlert}
          <span>
            Буруу өрөө рүү хуурамч захиалга өгвөл таны төхөөрөмжийг (<code class="font-mono">${footprint.slice(0, 8)}…</code>) системээс бүрмөсөн блоклохыг анхаарна уу.
          </span>
        </div>
      </form>
    </main>

    <div class="fixed bottom-0 inset-x-0 z-40 pointer-events-none">
      <div class="max-w-lg mx-auto p-4 pointer-events-auto">
        <div class="surface-card p-3 shadow-2xl border-[var(--color-accent)]">
          <button type="submit" form="checkoutForm" id="submitOrderBtn"
            class="btn-primary w-full h-12 px-4 flex items-center justify-between text-base">
            <span>Өрөөндөө захиалах</span>
            <span class="font-extrabold tabular-nums">${formatPrice(totalPrice)}</span>
          </button>
        </div>
      </div>
    </div>
  `;

  bindTopBarEvents();
  bindNoticeEvents(renderCart);

  document.getElementById('backToItemsBtn').onclick = () => {
    navigate('/page');
  };

  const roomInput = document.getElementById('roomInput');
  if (roomInput) {
    roomInput.oninput = () => {
      localStorage.setItem('shop_room_number', roomInput.value.trim());
    };
  }

  document.querySelectorAll('[data-cart-inc]').forEach((btn) => {
    btn.onclick = () => {
      const id = Number(btn.dataset.cartInc);
      const max = Number(btn.dataset.max);
      cart[id] = Math.min(max, (cart[id] || 0) + 1);
      saveCart();
      renderCart();
    };
  });

  document.querySelectorAll('[data-cart-dec]').forEach((btn) => {
    btn.onclick = () => {
      const id = Number(btn.dataset.cartDec);
      if (cart[id] > 0) cart[id]--;
      if (cart[id] <= 0) delete cart[id];
      saveCart();
      if (getCartCount() === 0) {
        navigate('/page', true);
      } else {
        renderCart();
      }
    };
  });

  document.querySelectorAll('[data-cart-remove]').forEach((btn) => {
    btn.onclick = () => {
      const id = Number(btn.dataset.cartRemove);
      delete cart[id];
      saveCart();
      if (getCartCount() === 0) {
        navigate('/page', true);
      } else {
        renderCart();
      }
    };
  });

  const checkoutForm = document.getElementById('checkoutForm');
  const submitOrderBtn = document.getElementById('submitOrderBtn');

  checkoutForm.onsubmit = async (e) => {
    e.preventDefault();
    const room = roomInput.value.trim();
    if (!room) {
      roomInput.focus();
      return;
    }

    localStorage.setItem('shop_room_number', room);
    const orderItems = Object.entries(cart).map(([id, qty]) => ({
      item_id: Number(id),
      quantity: Number(qty)
    }));

    submitOrderBtn.disabled = true;
    submitOrderBtn.innerHTML = `<span>Захиалга илгээж байна…</span>`;

    try {
      const res = await fetch('/api/shop/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Device-Footprint': footprint },
        body: JSON.stringify({ magic_word: magicWord, room_number: room, items: orderItems })
      });

      if (res.ok) {
        cart = {};
        saveCart();
        notice = {
          type: 'success',
          text: `${room} тоот руу захиалга амжилттай бүртгэгдлээ.`
        };
        await fetchItems();
        navigate('/page', true);
      } else {
        const errText = await res.text();
        notice = {
          type: 'error',
          text: `Захиалга амжилтгүй: ${errText.trim() || 'Алдаа гарлаа'}`
        };
        await fetchItems();
        if (getCartCount() === 0) {
          navigate('/page', true);
        } else {
          renderCart();
        }
      }
    } catch (_) {
      notice = { type: 'error', text: 'Сүлжээний алдаа гарлаа. Дахин оролдоно уу.' };
      renderCart();
    }
  };
}

function formatPrice(val) {
  const num = Number(val) || 0;
  return num.toLocaleString('mn-MN') + '₮';
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(str) {
  return escapeHtml(str);
}

init();
