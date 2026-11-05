const app = document.getElementById('app');
let items = [];
let orders = [];
let bans = [];

async function loadAll() {
  const [iRes, oRes, bRes] = await Promise.all([
    fetch('/api/admin/items'),
    fetch('/api/admin/orders'),
    fetch('/api/admin/bans')
  ]);
  items = (await iRes.json()) || [];
  orders = (await oRes.json()) || [];
  bans = (await bRes.json()) || [];
  render();
}

function render() {
  app.innerHTML = `
    <div class="flex justify-between items-center mb-6">
      <h1 class="text-2xl font-bold text-amber-400">🔒 Roommate Admin</h1>
      <button id="refreshBtn" class="bg-zinc-800 px-3 py-1.5 rounded-lg text-sm">↻ Refresh</button>
    </div>

    <!-- 1. ORDERS SECTION -->
    <section class="mb-8">
      <h2 class="text-lg font-bold mb-3">🛎️ Incoming Room Orders</h2>
      <div class="space-y-3">
        ${orders.length === 0 ? `<p class="text-zinc-500 text-sm">No orders yet.</p>` : ''}
        ${orders.map(o => `
          <div class="bg-zinc-900 border ${o.status === 'pending' ? 'border-amber-500/60' : 'border-zinc-800'} p-4 rounded-xl">
            <div class="flex justify-between items-start mb-2">
              <div>
                <span class="text-lg font-bold text-white">Room ${o.room_number}</span>
                <span class="ml-2 text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">${o.status}</span>
                <div class="text-xs text-zinc-500 font-mono mt-1">Footprint: ${o.footprint_hash}</div>
              </div>
              <div class="text-right">
                <div class="text-emerald-400 font-bold">$${o.total_price}</div>
                <div class="text-xs text-zinc-500">${o.created_at}</div>
              </div>
            </div>
            <div class="text-sm text-zinc-300 mb-3">
              ${(o.items || []).map(i => `${i.qty}x ${i.name}`).join(', ')}
            </div>
            ${o.status === 'pending' ? `
              <div class="flex gap-2">
                <button data-deliver="${o.id}" class="flex-1 bg-emerald-600 hover:bg-emerald-500 py-2 rounded-lg text-sm font-bold">✅ Delivered</button>
                <button data-false="${o.id}" class="flex-1 bg-red-700 hover:bg-red-600 py-2 rounded-lg text-sm font-bold">🚫 False Order (Ban + Restore Stock)</button>
              </div>
            ` : ''}
          </div>
        `).join('')}
      </div>
    </section>

    <!-- 2. ADD NEW ITEM -->
    <section class="mb-8 bg-zinc-900 border border-zinc-800 p-4 rounded-xl">
      <h2 class="text-lg font-bold mb-3">➕ Add New Item</h2>
      <form id="addForm" class="grid grid-cols-2 gap-3">
        <input name="name" placeholder="Item Name" required class="col-span-2 bg-zinc-800 px-3 py-2 rounded-lg" />
        <input name="price" type="number" placeholder="Price ($)" required class="bg-zinc-800 px-3 py-2 rounded-lg" />
        <input name="stock" type="number" placeholder="Stock Count" required class="bg-zinc-800 px-3 py-2 rounded-lg" />
        <input name="image" type="file" accept="image/*" capture="environment" class="col-span-2 text-sm text-zinc-400" />
        <button class="col-span-2 bg-amber-500 text-black font-bold py-2.5 rounded-lg">Upload & Add Item</button>
      </form>
    </section>

    <!-- 3. EDIT INVENTORY -->
    <section class="mb-8">
      <h2 class="text-lg font-bold mb-3">📦 Edit Stock & Items</h2>
      <div class="space-y-2">
        ${items.map(it => `
          <div class="bg-zinc-900 border border-zinc-800 p-3 rounded-xl flex flex-wrap gap-2 items-center justify-between">
            <input id="name-${it.id}" value="${it.name}" class="bg-zinc-800 px-2 py-1 rounded text-sm flex-1 min-w-[120px]" />
            <input id="price-${it.id}" type="number" value="${it.price}" class="bg-zinc-800 px-2 py-1 rounded text-sm w-20" />
            <input id="stock-${it.id}" type="number" value="${it.stock}" class="bg-zinc-800 px-2 py-1 rounded text-sm w-20" />
            <button data-save="${it.id}" class="bg-blue-600 px-3 py-1 rounded text-sm font-semibold">Save</button>
          </div>
        `).join('')}
      </div>
    </section>

    <!-- 4. BANNED FOOTPRINTS -->
    <section class="mb-8 bg-zinc-900 border border-zinc-800 p-4 rounded-xl">
      <h2 class="text-lg font-bold mb-3">🔨 Banned Device Footprints</h2>
      <form id="banForm" class="flex gap-2 mb-4">
        <input id="banHash" placeholder="Footprint hash..." required class="flex-1 bg-zinc-800 px-3 py-2 rounded-lg text-sm font-mono" />
        <button class="bg-red-700 px-4 py-2 rounded-lg text-sm font-bold">Ban</button>
      </form>
      <div class="space-y-2">
        ${bans.map(b => `
          <div class="flex justify-between items-center bg-zinc-800/60 p-2 rounded-lg text-xs">
            <div>
              <div class="font-mono text-red-400">${b.footprint_hash}</div>
              <div class="text-zinc-400">${b.reason} (${b.banned_at})</div>
            </div>
            <button data-unban="${b.footprint_hash}" class="bg-zinc-700 px-2.5 py-1 rounded">Unban</button>
          </div>
        `).join('')}
      </div>
    </section>
  `;

  document.getElementById('refreshBtn').onclick = loadAll;

  document.getElementById('addForm').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await fetch('/api/admin/items', { method: 'POST', body: fd });
    await loadAll();
  };

  document.querySelectorAll('[data-save]').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.save;
      const name = document.getElementById(`name-${id}`).value;
      const price = Number(document.getElementById(`price-${id}`).value);
      const stock = Number(document.getElementById(`stock-${id}`).value);
      await fetch(`/api/admin/items/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, price, stock })
      });
      await loadAll();
    };
  });

  document.querySelectorAll('[data-deliver]').forEach(btn => {
    btn.onclick = async () => {
      await fetch(`/api/admin/orders/${btn.dataset.deliver}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'delivered' })
      });
      await loadAll();
    };
  });

  document.querySelectorAll('[data-false]').forEach(btn => {
    btn.onclick = async () => {
      if (!confirm('Mark false order, restore item stock, and BAN this device footprint?')) return;
      await fetch(`/api/admin/orders/${btn.dataset.false}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'false_order' })
      });
      await loadAll();
    };
  });

  document.getElementById('banForm').onsubmit = async (e) => {
    e.preventDefault();
    const hash = document.getElementById('banHash').value.trim();
    await fetch('/api/admin/bans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ footprint_hash: hash, reason: 'Manual admin ban' })
    });
    await loadAll();
  };

  document.querySelectorAll('[data-unban]').forEach(btn => {
    btn.onclick = async () => {
      await fetch(`/api/admin/bans/${btn.dataset.unban}`, { method: 'DELETE' });
      await loadAll();
    };
  });
}

loadAll();
