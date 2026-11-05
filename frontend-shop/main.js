const app = document.getElementById('app');
let magicWord = localStorage.getItem('shop_magic_word') || '';
let cart = {};
let items = [];
let footprint = '';

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

async function init() {
  footprint = await getFootprint();
  if (!magicWord) {
    renderLogin();
  } else {
    await loadShop();
  }
}

function renderLogin(errorMsg = '') {
  app.innerHTML = `
    <div class="mt-20 bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-xl">
      <h1 class="text-2xl font-bold mb-2">🤫 Secret Shop</h1>
      <p class="text-zinc-400 text-sm mb-4">Enter the building magic word to see stock & order to your room.</p>
      ${errorMsg ? `<div class="bg-red-950/60 border border-red-800 text-red-300 text-sm p-3 rounded-lg mb-4">${errorMsg}</div>` : ''}
      <form id="loginForm" class="space-y-4">
        <input id="wordInput" type="password" placeholder="Magic Word..." required
          class="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500" />
        <button class="w-full bg-emerald-600 hover:bg-emerald-500 font-semibold py-3 rounded-xl">Enter Shop</button>
      </form>
      <p class="text-xs text-zinc-600 mt-4 text-center">Device ID: ${footprint}</p>
    </div>
  `;

  document.getElementById('loginForm').onsubmit = async (e) => {
    e.preventDefault();
    const candidate = document.getElementById('wordInput').value.trim();
    const res = await fetch('/api/shop/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Device-Footprint': footprint },
      body: JSON.stringify({ magic_word: candidate })
    });

    if (res.ok) {
      magicWord = candidate;
      localStorage.setItem('shop_magic_word', magicWord);
      await loadShop();
    } else {
      const txt = await res.text();
      renderLogin(txt || 'Invalid magic word');
    }
  };
}

async function loadShop() {
  const res = await fetch('/api/shop/items', {
    headers: { 'X-Magic-Word': magicWord, 'X-Device-Footprint': footprint }
  });
  if (res.status === 401 || res.status === 403) {
    localStorage.removeItem('shop_magic_word');
    magicWord = '';
    return renderLogin(await res.text());
  }
  items = await res.json();
  renderShop();
}

function renderShop() {
  const totalItems = Object.values(cart).reduce((a, b) => a + b, 0);
  const totalPrice = items.reduce((sum, it) => sum + (cart[it.id] || 0) * it.price, 0);

  app.innerHTML = `
    <div class="flex justify-between items-center mb-6">
      <h1 class="text-2xl font-bold">🛒 In-Stock Items</h1>
      <button id="refreshBtn" class="text-xs bg-zinc-800 px-3 py-1.5 rounded-lg text-zinc-300">↻ Refresh</button>
    </div>

    <div class="space-y-3 mb-8">
      ${items.length === 0 ? `<p class="text-zinc-500 text-center py-10">Nothing in stock right now.</p>` : ''}
      ${items.map(it => `
        <div class="flex items-center justify-between bg-zinc-900 border border-zinc-800 p-3 rounded-xl">
          <div class="flex items-center gap-3">
            ${it.image_url ? `<img src="${it.image_url}" class="w-16 h-16 object-cover rounded-lg bg-zinc-800" />` : `<div class="w-16 h-16 rounded-lg bg-zinc-800 flex items-center justify-center text-xl">📦</div>`}
            <div>
              <div class="font-semibold">${it.name}</div>
              <div class="text-emerald-400 font-medium">$${it.price}</div>
              <div class="text-xs text-zinc-500">${it.stock} left</div>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <button data-dec="${it.id}" class="w-8 h-8 rounded-lg bg-zinc-800 font-bold">-</button>
            <span class="w-6 text-center font-semibold">${cart[it.id] || 0}</span>
            <button data-inc="${it.id}" data-max="${it.stock}" class="w-8 h-8 rounded-lg bg-emerald-600 font-bold">+</button>
          </div>
        </div>
      `).join('')}
    </div>

    ${totalItems > 0 ? `
      <form id="orderForm" class="bg-zinc-900 border border-emerald-700/50 p-4 rounded-2xl space-y-3 sticky bottom-4 shadow-2xl">
        <div class="flex justify-between font-bold text-lg">
          <span>Total (${totalItems} items)</span>
          <span class="text-emerald-400">$${totalPrice}</span>
        </div>
        <input id="roomInput" type="text" placeholder="Your Room Number (e.g. 304)" required
          class="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-emerald-500" />
        <p class="text-xs text-amber-400/90">⚠️ False orders to wrong rooms will permanently ban your device (${footprint.slice(0, 8)}...).</p>
        <button class="w-full bg-emerald-600 hover:bg-emerald-500 font-bold py-3 rounded-xl">Order to My Room</button>
      </form>
    ` : ''}
  `;

  document.getElementById('refreshBtn').onclick = loadShop;

  document.querySelectorAll('[data-inc]').forEach(btn => {
    btn.onclick = () => {
      const id = Number(btn.dataset.inc);
      const max = Number(btn.dataset.max);
      cart[id] = Math.min(max, (cart[id] || 0) + 1);
      renderShop();
    };
  });

  document.querySelectorAll('[data-dec]').forEach(btn => {
    btn.onclick = () => {
      const id = Number(btn.dataset.dec);
      if (cart[id] > 0) cart[id]--;
      if (cart[id] === 0) delete cart[id];
      renderShop();
    };
  });

  const orderForm = document.getElementById('orderForm');
  if (orderForm) {
    orderForm.onsubmit = async (e) => {
      e.preventDefault();
      const room = document.getElementById('roomInput').value.trim();
      const orderItems = Object.entries(cart).map(([id, qty]) => ({ item_id: Number(id), quantity: qty }));

      const res = await fetch('/api/shop/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Device-Footprint': footprint },
        body: JSON.stringify({ magic_word: magicWord, room_number: room, items: orderItems })
      });

      if (res.ok) {
        cart = {};
        alert(`✅ Order sent to Room ${room}! Hang tight.`);
        await loadShop();
      } else {
        alert('❌ Order failed: ' + (await res.text()));
        await loadShop();
      }
    };
  }
}

init();
