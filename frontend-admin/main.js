const app = document.getElementById('app');
let items = [];
let orders = [];
let bans = [];
let notice = null;
let audioCtx = null;
let soundEnabled = localStorage.getItem('admin_sound_enabled') !== 'false';
let sseConnected = false;

const ICONS = {
  shield: `<svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>`,
  refresh: `<svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>`,
  bell: `<svg class="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>`,
  volumeOn: `<svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>`,
  volumeOff: `<svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>`,
  plus: `<svg class="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`,
  box: `<svg class="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>`,
  ban: `<svg class="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>`,
  check: `<svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>`
};

const STATUS_LABELS = {
  pending: {
    label: 'Хүлээгдэж буй',
    cls: 'badge-pending'
  },
  delivered: {
    label: 'Хүргэгдсэн',
    cls: 'badge-delivered'
  },
  false_order: {
    label: 'Хуурамч захиалга',
    cls: 'badge-false'
  }
};

function ensureAudioContext() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!audioCtx) {
      audioCtx = new AudioCtx();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  } catch (_) {
    return null;
  }
}

// Unlock Web Audio on first user tap anywhere on the page
window.addEventListener('pointerdown', () => {
  if (soundEnabled) ensureAudioContext();
}, { once: true });

// Two-tone doorbell chime synthesized via Web Audio API (no external MP3 needed)
function playOrderChime() {
  if (!soundEnabled) return;
  const ctx = ensureAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const notes = [
    { freq: 659.25, start: 0, dur: 0.18 },    // E5
    { freq: 880.00, start: 0.16, dur: 0.35 }  // A5
  ];

  notes.forEach(({ freq, start, dur }) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now + start);

    gain.gain.setValueAtTime(0.0001, now + start);
    gain.gain.exponentialRampToValueAtTime(0.28, now + start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + start);
    osc.stop(now + start + dur + 0.02);
  });
}

function triggerBrowserNotification(ev) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const itemsLine = Array.isArray(ev.items) && ev.items.length > 0 ? ev.items.join(', ') : '';
    const body = `${ev.room_number} тоот · ${formatPrice(ev.total_price)}${itemsLine ? `\n${itemsLine}` : ''}`;
    new Notification(`217-Store · Шинэ захиалга (#${ev.order_id})`, {
      body,
      tag: `order-${ev.order_id}`,
      renotify: true
    });
  } catch (_) {}
}

function connectLiveOrderStream() {
  if (!('EventSource' in window)) return;
  const es = new EventSource('/api/admin/events');

  es.onopen = () => {
    sseConnected = true;
  };

  es.addEventListener('order_created', async (e) => {
    try {
      const ev = JSON.parse(e.data);
      playOrderChime();
      triggerBrowserNotification(ev);
      notice = {
        type: 'success',
        text: `Шинэ захиалга ирлээ: ${ev.room_number} тоот (${formatPrice(ev.total_price)})`
      };
      await loadAll();
    } catch (_) {
      await loadAll();
    }
  });

  es.onerror = () => {
    sseConnected = false;
  };
}

async function loadAll() {
  try {
    const [iRes, oRes, bRes] = await Promise.all([
      fetch('/api/admin/items'),
      fetch('/api/admin/orders'),
      fetch('/api/admin/bans')
    ]);
    items = (await iRes.json()) || [];
    orders = (await oRes.json()) || [];
    bans = (await bRes.json()) || [];
  } catch (_) {
    notice = { type: 'error', text: 'Мэдээлэл татахад алдаа гарлаа.' };
  }
  render();
}

function render() {
  const pendingCount = orders.filter((o) => o.status === 'pending').length;
  const notifSupported = 'Notification' in window;
  const notifPerm = notifSupported ? Notification.permission : 'unsupported';

  app.innerHTML = `
    <header class="sticky top-0 z-30 surface-header mb-5">
      <div class="px-4 py-3 flex items-center justify-between gap-2">
        <div class="flex items-center gap-2.5 min-w-0">
          <div class="w-10 h-10 rounded-xl bg-[var(--color-paper-3)] border border-[var(--color-rule)] flex items-center justify-center text-[var(--color-accent)] shrink-0">
            ${ICONS.shield}
          </div>
          <div class="min-w-0">
            <h1 class="text-base sm:text-lg font-bold tracking-tight text-[var(--color-ink)] leading-snug truncate">
              217-Store · Админ самбар
            </h1>
            <p class="text-xs text-[var(--color-ink-2)] leading-tight truncate">
              Захиалга ба үлдэгдлийн хяналт
            </p>
          </div>
        </div>

        <div class="flex items-center gap-1.5 shrink-0">
          <button type="button" id="toggleSoundBtn"
            aria-label="${soundEnabled ? 'Дуут дохио унтраах' : 'Дуут дохио асаах'}"
            title="${soundEnabled ? 'Дуут дохио асаалттай (дарж унтраах)' : 'Дуут дохио унтарсан (дарж асаах)'}"
            class="btn-secondary px-2.5 h-10 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap ${
              soundEnabled ? 'text-[var(--color-accent)] border-[var(--color-accent)]' : 'text-[var(--color-muted)]'
            }">
            ${soundEnabled ? ICONS.volumeOn : ICONS.volumeOff}
            <span class="hidden sm:inline">${soundEnabled ? 'Дуу: Асаалттай' : 'Дуу: Унтарсан'}</span>
          </button>

          ${
            notifSupported && notifPerm !== 'granted'
              ? `<button type="button" id="enableNotifBtn"
                  class="btn-secondary px-2.5 h-10 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap text-[var(--color-ink)]">
                  ${ICONS.bell}
                  <span>Мэдэгдэл</span>
                </button>`
              : ''
          }

          <button type="button" id="refreshBtn" class="btn-secondary px-3 h-10 text-xs font-semibold inline-flex items-center gap-1.5 shrink-0 whitespace-nowrap">
            ${ICONS.refresh}
            <span>Шинэчлэх</span>
          </button>
        </div>
      </div>
    </header>

    <main class="px-4 space-y-7">
      ${
        notice
          ? `<div role="status" class="p-3.5 rounded-xl border flex items-center justify-between gap-3 text-sm ${
              notice.type === 'error'
                ? 'bg-[var(--color-danger-paper)] border-[var(--color-danger)] text-[var(--color-danger-ink)]'
                : 'bg-[var(--color-success-paper)] border-[var(--color-success)] text-[var(--color-success-ink)]'
            }">
              <span>${escapeHtml(notice.text)}</span>
              <button type="button" id="dismissNoticeBtn" class="text-xs px-2.5 py-1 rounded hover:bg-black/20 cursor-pointer shrink-0">Хаах</button>
            </div>`
          : ''
      }

      <!-- 1. ORDERS SECTION -->
      <section aria-labelledby="orders-heading">
        <div class="flex items-center justify-between gap-2 mb-3">
          <div class="flex items-center gap-2 min-w-0">
            <span class="text-[var(--color-accent)]">${ICONS.bell}</span>
            <h2 id="orders-heading" class="text-base sm:text-lg font-bold tracking-tight truncate">Ирсэн өрөөний захиалгууд</h2>
          </div>
          <span class="text-xs font-semibold px-2.5 py-1 rounded-lg surface-well text-[var(--color-ink-2)] tabular-nums shrink-0 whitespace-nowrap">
            Хүлээгдэж буй: ${pendingCount}
          </span>
        </div>

        <div class="space-y-3">
          ${
            orders.length === 0
              ? `<div class="surface-card p-8 text-center text-sm text-[var(--color-ink-2)]">Одоогоор захиалга ирээгүй байна.</div>`
              : orders
                  .map((o) => {
                    const st = STATUS_LABELS[o.status] || {
                      label: o.status,
                      cls: 'surface-well text-[var(--color-ink-2)]'
                    };
                    return `
                  <article class="surface-card p-4 ${o.status === 'pending' ? 'border-[var(--color-accent)]' : ''}">
                    <div class="flex justify-between items-start gap-3 mb-3">
                      <div class="min-w-0">
                        <div class="flex items-center gap-2 flex-wrap">
                          <span class="text-lg font-bold text-[var(--color-ink)] tabular-nums whitespace-nowrap">${escapeHtml(o.room_number)} тоот</span>
                          <span class="text-xs font-semibold px-2.5 py-0.5 rounded-md whitespace-nowrap ${st.cls}">${st.label}</span>
                        </div>
                        <div class="text-xs text-[var(--color-muted)] font-mono mt-1 tabular-nums break-all">
                          Төхөөрөмж: ${escapeHtml(o.footprint_hash)}
                        </div>
                      </div>
                      <div class="text-right shrink-0">
                        <div class="text-[var(--color-success)] font-extrabold text-base tabular-nums whitespace-nowrap">${formatPrice(o.total_price)}</div>
                        <div class="text-xs text-[var(--color-muted)] tabular-nums mt-0.5">${escapeHtml(o.created_at)}</div>
                      </div>
                    </div>

                    <div class="text-sm text-[var(--color-ink)] surface-well px-3 py-2.5 mb-3 flex flex-wrap gap-x-4 gap-y-1">
                      ${(o.items || []).map((i) => `<span class="inline-flex items-center gap-1"><strong class="tabular-nums text-[var(--color-accent)]">${i.qty}×</strong> <span>${escapeHtml(i.name)}</span></span>`).join('')}
                    </div>

                    ${
                      o.status === 'pending'
                        ? `
                      <div class="flex flex-col sm:flex-row gap-2">
                        <button type="button" data-deliver="${o.id}" class="btn-success flex-1 h-11 px-4 text-sm inline-flex items-center justify-center gap-1.5">
                          ${ICONS.check}
                          <span>Хүргэсэн</span>
                        </button>
                        <button type="button" data-false="${o.id}" class="btn-danger flex-1 h-11 px-4 text-sm inline-flex items-center justify-center gap-1.5">
                          ${ICONS.ban}
                          <span>Хуурамч захиалга (Блоклох)</span>
                        </button>
                      </div>
                    `
                        : ''
                    }
                  </article>
                `;
                  })
                  .join('')
          }
        </div>
      </section>

      <!-- 2. ADD NEW ITEM -->
      <section aria-labelledby="add-item-heading" class="surface-card p-4 sm:p-5">
        <div class="flex items-center gap-2 mb-4">
          <span class="text-[var(--color-accent)]">${ICONS.plus}</span>
          <h2 id="add-item-heading" class="text-base sm:text-lg font-bold tracking-tight">Шинэ бараа нэмэх</h2>
        </div>

        <form id="addForm" class="grid grid-cols-2 gap-3">
          <div class="col-span-2">
            <label for="newItemName" class="block text-xs font-medium text-[var(--color-ink-2)] mb-1">Барааны нэр</label>
            <input id="newItemName" name="name" placeholder="Жишээ нь: Шин рамен" required class="input-field w-full px-3.5 h-11" />
          </div>
          <div>
            <label for="newItemPrice" class="block text-xs font-medium text-[var(--color-ink-2)] mb-1">Үнэ (₮)</label>
            <input id="newItemPrice" name="price" type="number" min="0" placeholder="4500" required class="input-field w-full px-3.5 h-11 tabular-nums" />
          </div>
          <div>
            <label for="newItemStock" class="block text-xs font-medium text-[var(--color-ink-2)] mb-1">Үлдэгдэл тоо</label>
            <input id="newItemStock" name="stock" type="number" min="0" placeholder="20" required class="input-field w-full px-3.5 h-11 tabular-nums" />
          </div>
          <div class="col-span-2">
            <label for="newItemImage" class="block text-xs font-medium text-[var(--color-ink-2)] mb-1">Барааны зураг (сонголтоор)</label>
            <input id="newItemImage" name="image" type="file" accept="image/*" capture="environment"
              class="w-full text-sm text-[var(--color-ink-2)] file:mr-3 file:py-2 file:px-3.5 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-[var(--color-paper-3)] file:text-[var(--color-ink)] hover:file:opacity-90" />
          </div>
          <button type="submit" class="col-span-2 btn-primary h-11 px-4 text-sm">
            Бараа бүртгэх
          </button>
        </form>
      </section>

      <!-- 3. EDIT INVENTORY -->
      <section aria-labelledby="inventory-heading">
        <div class="flex items-center justify-between gap-2 mb-3">
          <div class="flex items-center gap-2 min-w-0">
            <span class="text-[var(--color-accent)]">${ICONS.box}</span>
            <h2 id="inventory-heading" class="text-base sm:text-lg font-bold tracking-tight truncate">Барааны үлдэгдэл засах</h2>
          </div>
          <span class="text-xs text-[var(--color-ink-2)] tabular-nums shrink-0 whitespace-nowrap">Нийт ${items.length} бараа</span>
        </div>

        <div class="space-y-2.5">
          ${
            items.length === 0
              ? `<div class="surface-card p-6 text-center text-sm text-[var(--color-ink-2)]">Бүртгэлтэй бараа алга байна.</div>`
              : items
                  .map(
                    (it) => `
                  <div class="surface-card p-3.5 space-y-2.5">
                    <div>
                      <label for="name-${it.id}" class="block text-xs text-[var(--color-muted)] mb-1">Барааны нэр</label>
                      <input id="name-${it.id}" value="${escapeAttr(it.name)}" class="input-field w-full px-3 h-10 text-sm font-medium" />
                    </div>
                    <div class="grid grid-cols-3 gap-2 items-end">
                      <div>
                        <label for="price-${it.id}" class="block text-xs text-[var(--color-muted)] mb-1">Үнэ (₮)</label>
                        <input id="price-${it.id}" type="number" min="0" value="${it.price}" class="input-field w-full px-3 h-10 text-sm tabular-nums" />
                      </div>
                      <div>
                        <label for="stock-${it.id}" class="block text-xs text-[var(--color-muted)] mb-1">Үлдэгдэл</label>
                        <input id="stock-${it.id}" type="number" min="0" value="${it.stock}" class="input-field w-full px-3 h-10 text-sm tabular-nums" />
                      </div>
                      <button type="button" data-save="${it.id}" class="btn-primary h-10 px-3 text-sm font-semibold w-full">
                        Хадгалах
                      </button>
                    </div>
                  </div>
                `
                  )
                  .join('')
          }
        </div>
      </section>

      <!-- 4. BANNED FOOTPRINTS -->
      <section aria-labelledby="bans-heading" class="surface-card p-4 sm:p-5">
        <div class="flex items-center gap-2 mb-3">
          <span class="text-[var(--color-danger)]">${ICONS.ban}</span>
          <h2 id="bans-heading" class="text-base sm:text-lg font-bold tracking-tight">Блоклогдсон төхөөрөмжүүд</h2>
        </div>

        <form id="banForm" class="flex flex-col sm:flex-row gap-2.5 mb-4">
          <label for="banHash" class="sr-only">Төхөөрөмжийн дугаар</label>
          <input id="banHash" placeholder="Төхөөрөмжийн дугаар (Footprint hash)…" required
            class="input-field flex-1 px-3.5 h-11 text-sm font-mono" />
          <button type="submit" class="btn-danger px-5 h-11 text-sm shrink-0">
            Блоклох
          </button>
        </form>

        <div class="space-y-2">
          ${
            bans.length === 0
              ? `<p class="text-xs text-[var(--color-ink-2)] py-2">Блоклогдсон төхөөрөмж байхгүй байна.</p>`
              : bans
                  .map(
                    (b) => `
                  <div class="flex justify-between items-center gap-3 surface-well p-3 text-xs">
                    <div class="min-w-0">
                      <div class="font-mono font-semibold text-[var(--color-danger-ink)] break-all tabular-nums">${escapeHtml(b.footprint_hash)}</div>
                      <div class="text-[var(--color-ink-2)] mt-0.5">${escapeHtml(b.reason)} · <span class="tabular-nums">${escapeHtml(b.banned_at)}</span></div>
                    </div>
                    <button type="button" data-unban="${escapeAttr(b.footprint_hash)}" class="btn-secondary px-3 h-9 text-xs font-semibold shrink-0 whitespace-nowrap">
                      Блок гаргах
                    </button>
                  </div>
                `
                  )
                  .join('')
          }
        </div>
      </section>
    </main>
  `;

  document.getElementById('refreshBtn').onclick = loadAll;

  const toggleSoundBtn = document.getElementById('toggleSoundBtn');
  if (toggleSoundBtn) {
    toggleSoundBtn.onclick = () => {
      soundEnabled = !soundEnabled;
      localStorage.setItem('admin_sound_enabled', String(soundEnabled));
      if (soundEnabled) {
        playOrderChime();
      }
      render();
    };
  }

  const enableNotifBtn = document.getElementById('enableNotifBtn');
  if (enableNotifBtn) {
    enableNotifBtn.onclick = async () => {
      const perm = await Notification.requestPermission();
      if (perm === 'granted') {
        notice = { type: 'success', text: 'Хөтөчийн мэдэгдэл идэвхэжлээ.' };
      } else {
        notice = { type: 'error', text: 'Мэдэгдэл илгээх зөвшөөрөл татгалзсан байна.' };
      }
      render();
    };
  }

  const dismissNoticeBtn = document.getElementById('dismissNoticeBtn');
  if (dismissNoticeBtn) {
    dismissNoticeBtn.onclick = () => {
      notice = null;
      render();
    };
  }

  document.getElementById('addForm').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const res = await fetch('/api/admin/items', { method: 'POST', body: fd });
    if (res.ok) {
      notice = { type: 'success', text: 'Шинэ бараа амжилттай нэмэгдлээ.' };
    } else {
      notice = { type: 'error', text: 'Бараа нэмэхэд алдаа гарлаа.' };
    }
    await loadAll();
  };

  document.querySelectorAll('[data-save]').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.dataset.save;
      const name = document.getElementById(`name-${id}`).value.trim();
      const price = Number(document.getElementById(`price-${id}`).value);
      const stock = Number(document.getElementById(`stock-${id}`).value);
      const res = await fetch(`/api/admin/items/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, price, stock })
      });
      if (res.ok) {
        notice = { type: 'success', text: `«${name}» барааны мэдээлэл шинэчлэгдлээ.` };
      } else {
        notice = { type: 'error', text: 'Хадгалахад алдаа гарлаа.' };
      }
      await loadAll();
    };
  });

  document.querySelectorAll('[data-deliver]').forEach((btn) => {
    btn.onclick = async () => {
      await fetch(`/api/admin/orders/${btn.dataset.deliver}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'delivered' })
      });
      notice = { type: 'success', text: 'Захиалгыг хүргэгдсэн төлөвт шилжүүллээ.' };
      await loadAll();
    };
  });

  document.querySelectorAll('[data-false]').forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm('Хуурамч захиалга гэж тэмдэглэн барааны үлдэгдлийг буцааж, энэ төхөөрөмжийг БЛОКЛОХ уу?')) return;
      await fetch(`/api/admin/orders/${btn.dataset.false}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'false_order' })
      });
      notice = { type: 'success', text: 'Хуурамч захиалга цуцлагдаж, төхөөрөмж блоклогдлоо.' };
      await loadAll();
    };
  });

  document.getElementById('banForm').onsubmit = async (e) => {
    e.preventDefault();
    const hash = document.getElementById('banHash').value.trim();
    if (!hash) return;
    await fetch('/api/admin/bans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ footprint_hash: hash, reason: 'Админ гараар блоклосон' })
    });
    notice = { type: 'success', text: `Төхөөрөмж (${hash}) блоклогдлоо.` };
    await loadAll();
  };

  document.querySelectorAll('[data-unban]').forEach((btn) => {
    btn.onclick = async () => {
      await fetch(`/api/admin/bans/${btn.dataset.unban}`, { method: 'DELETE' });
      notice = { type: 'success', text: 'Төхөөрөмжийн блокийг гаргалаа.' };
      await loadAll();
    };
  });
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

loadAll();
connectLiveOrderStream();
