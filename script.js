import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabase-config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ---------- category -> DOM ids ---------- */
const CATEGORY_MAP = {
  bestseller: { gridId: "grid-bestseller", countId: "count-bestseller" },
  sandwich:   { gridId: "grid-sandwich",   countId: "count-sandwich" },
  rice:       { gridId: "grid-rice",       countId: "count-rice" },
  dessert:    { gridId: "grid-dessert",    countId: "count-dessert" },
  drink:      { gridId: "grid-drinks",     countId: "count-drinks" }
};

/* Supabase Edge Function that relays a completed order straight into the
   Telegram group. Replaces the old tg://resolve deep-link approach so the
   customer never has to leave the site or tap "send" themselves. */
const TELEGRAM_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/clever-processor`;

let allProducts = [];

/* ---------- basket state ----------
   Cart is a simple { productId: qty } map persisted to localStorage so a
   customer's basket survives a page refresh. If localStorage is blocked
   (private browsing, embedded webview, browser settings, etc.) we fall
   back to an in-memory object so the basket still works for the current
   session — it just won't survive a page refresh in that case. */
let storageAvailable = true;
try {
  const testKey = "__lk_storage_test__";
  localStorage.setItem(testKey, "1");
  localStorage.removeItem(testKey);
} catch (e) {
  storageAvailable = false;
  console.warn("[L&K] localStorage is unavailable — cart will not persist across refreshes.", e);
}

let memoryCart = {};
let cart = loadCart();

function loadCart() {
  if (!storageAvailable) return memoryCart;
  try {
    const raw = JSON.parse(localStorage.getItem("lk_cart") || "{}");
    return raw;
  } catch (e) {
    console.warn("[L&K] Failed to read cart from localStorage:", e);
    return {};
  }
}
function saveCart() {
  if (!storageAvailable) {
    memoryCart = cart;
    return;
  }
  try {
    localStorage.setItem("lk_cart", JSON.stringify(cart));
  } catch (e) {
    console.warn("[L&K] Failed to save cart to localStorage, falling back to memory:", e);
    storageAvailable = false;
    memoryCart = cart;
  }
}
function priceNum(p) {
  if (!p || p.price == null) return 0;
  const n = parseFloat(String(p.price).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/* ---------- customer details (name / phone / pickup date) ----------
   Kept alongside the cart so a returning customer doesn't have to
   retype their details every time they place an order. */
function loadCustomer() {
  try { return JSON.parse(localStorage.getItem("lk_customer") || "{}"); }
  catch { return {}; }
}
function saveCustomer(info) {
  try { localStorage.setItem("lk_customer", JSON.stringify(info)); }
  catch { /* storage unavailable */ }
}
function getCustomerFields() {
  return {
    name  : document.getElementById('custName')?.value.trim() || '',
    phone : document.getElementById('custPhone')?.value.trim() || '',
    date  : document.getElementById('custDate')?.value || ''
  };
}
function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
}

/* ---------- keep content clear of the fixed header ----------
   header is `position:fixed` (see style.css), so it's out of document
   flow. We measure its real rendered height (fonts/wrap can shift it a
   few px per device) and publish it as --header-h, which .heroWrap and
   .sectionHead read to know how much space to reserve/scroll-offset. */
function setHeaderHeight() {
  const header = document.querySelector('header');
  if (header) {
    document.documentElement.style.setProperty('--header-h', header.offsetHeight + 'px');
  }
}
setHeaderHeight();
window.addEventListener('resize', setHeaderHeight);
// Re-measure after fonts finish loading, since custom fonts can change
// header height slightly after first paint.
document.fonts?.ready?.then(setHeaderHeight);

/* ---------- add-to-basket control ----------
   Renders either a "+" button (nothing in the basket yet) or a
   −/qty/+ stepper (already in the basket) for a given product. Shared
   between grid cards and the product detail modal so both stay in sync. */
function addControlHTML(p) {
  if (p.is_out_of_stock) {
    return `<p class="outOfStockText">Unavailable</p>`;
  }
  const qty = cart[p.id] || 0;
  if (qty > 0) {
    return `
      <div class="stepper" data-id="${p.id}">
        <button class="stepBtn minus" data-action="dec" aria-label="Remove one">−</button>
        <span class="stepQty">${qty}</span>
        <button class="stepBtn plus" data-action="inc" aria-label="Add one">+</button>
      </div>`;
  }
  return `
    <button class="addBtn" data-id="${p.id}" aria-label="Add to basket">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
    </button>`;
}

function refreshCardControl(id) {
  const product = allProducts.find(p => p.id === id);
  if (!product) return;
  document.querySelectorAll(`.addWrap[data-add-id="${id}"]`).forEach(wrap => {
    wrap.innerHTML = addControlHTML(product);
  });
}

function addToCart(id) {
  cart[id] = (cart[id] || 0) + 1;
  saveCart();
  console.log('[L&K] addToCart:', id, '-> cart is now', JSON.stringify(cart));
  refreshCardControl(id);
  updateCartBar();
  if (document.getElementById('cartOverlay')?.classList.contains('open')) renderCartModal();
}
function decFromCart(id) {
  if (!cart[id]) return;
  cart[id] -= 1;
  if (cart[id] <= 0) delete cart[id];
  saveCart();
  refreshCardControl(id);
  updateCartBar();
  if (document.getElementById('cartOverlay')?.classList.contains('open')) renderCartModal();
}
function clearCart() {
  cart = {};
  saveCart();
  allProducts.forEach(p => refreshCardControl(p.id));
  updateCartBar();
  renderCartModal();
}

function cartEntries() {
  return Object.entries(cart);
}
function cartTotal() {
  return cartEntries().reduce((sum, [id, qty]) => {
    const p = allProducts.find(pp => pp.id === id);
    return sum + priceNum(p) * qty;
  }, 0);
}

function updateCartBar() {
  const bar = document.getElementById('cartBar');
  if (!bar) return;
  const count = cartEntries().reduce((s, [, q]) => s + q, 0);
  bar.style.display = count > 0 ? 'flex' : 'none';
  const countEl = document.getElementById('cartCount');
  const totalEl = document.getElementById('cartBarTotal');
  if (countEl) countEl.textContent = String(count);
  if (totalEl) totalEl.textContent = '$' + cartTotal().toFixed(2);
}

function buildQuoteText() {
  const entries = cartEntries();
  const { name, phone, date } = getCustomerFields();
  let text = "🧾 L&K Sandwich Order\n\n";
  text += `Name: ${name || '—'}\n`;
  text += `Phone: ${phone || '—'}\n`;
  text += `Pickup/Delivery date: ${date ? formatDate(date) : '—'}\n\n`;
  entries.forEach(([id, qty], i) => {
    const p = allProducts.find(pp => pp.id === id);
    if (!p) return;
    const line = priceNum(p) * qty;
    text += `${i + 1}. ${p.name} (${p.id}) x${qty} — $${line.toFixed(2)}\n`;
  });
  text += `\nTotal: $${cartTotal().toFixed(2)}`;
  return text;
}

function renderCartModal() {
  const container = document.getElementById('cartItems');
  if (!container) return;
  const entries = cartEntries();

  if (entries.length === 0) {
    container.innerHTML = `<p class="cartEmpty">Your basket is empty.</p>`;
  } else {
    container.innerHTML = entries.map(([id, qty]) => {
      const p = allProducts.find(pp => pp.id === id);
      if (!p) return '';
      const lineTotal = (priceNum(p) * qty).toFixed(2);
      return `
        <div class="cartItemRow">
          <img src="${escapeAttr(p.image_url)}" alt="${escapeAttr(p.name)}">
          <div class="cartItemInfo">
            <p class="cartItemName">${escapeHTML(p.name)}</p>
            <p class="cartItemId">ID: ${p.id}</p>
          </div>
          <div class="stepper" data-id="${id}">
            <button class="stepBtn minus" data-action="dec" aria-label="Remove one">−</button>
            <span class="stepQty">${qty}</span>
            <button class="stepBtn plus" data-action="inc" aria-label="Add one">+</button>
          </div>
          <p class="cartItemLineTotal">$${lineTotal}</p>
        </div>`;
    }).join('');
  }

  const totalEl = document.getElementById('cartModalTotal');
  if (totalEl) totalEl.textContent = '$' + cartTotal().toFixed(2);

  updateSendButtonState();
}

/* ---------- send order directly via Supabase Edge Function ----------
   Replaces the old tg://resolve / t.me deep-link flow. The Edge Function
   holds the bot token as a server-side secret and posts the order text
   straight into the Telegram group, so the customer never has to open
   Telegram themselves. */
function updateSendButtonState() {
  const sendBtn = document.getElementById('sendOrderBtn');
  if (!sendBtn) return;
  const { name, phone, date } = getCustomerFields();
  const items = cartEntries();
  const complete = items.length > 0 && name && phone && date;
  console.log('[L&K] updateSendButtonState:', { items: items.length, name, phone, date, complete });
  sendBtn.disabled = !complete;
}

/* Opens the confirmation modal instead of sending right away, so the
   customer gets one last look at their order before it goes out. */
function openConfirmModal() {
  const sendBtn = document.getElementById('sendOrderBtn');
  if (!sendBtn || sendBtn.disabled) return;

  const summaryEl = document.getElementById('confirmSummary');
  if (summaryEl) summaryEl.textContent = buildQuoteText();

  document.getElementById('confirmOverlay')?.classList.add('open');
}
function closeConfirmModal() {
  document.getElementById('confirmOverlay')?.classList.remove('open');
}

async function sendOrderToTelegram() {
  const sendBtn = document.getElementById('sendOrderBtn');
  const confirmSendBtn = document.getElementById('confirmSendBtn');
  if (!sendBtn || sendBtn.disabled) return;

  const originalLabel = sendBtn.textContent;
  const originalConfirmLabel = confirmSendBtn?.textContent;
  sendBtn.disabled = true;
  sendBtn.textContent = 'Sending…';
  if (confirmSendBtn) { confirmSendBtn.disabled = true; confirmSendBtn.textContent = 'Sending…'; }

  try {
    const res = await fetch(TELEGRAM_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({ text: buildQuoteText() })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to send order');

    closeConfirmModal();
    sendBtn.textContent = 'Order Sent ✓';
    setTimeout(() => {
      clearCart();
      cartOverlay?.classList.remove('open');
      sendBtn.textContent = originalLabel;
      sendBtn.disabled = false;
      if (confirmSendBtn) { confirmSendBtn.textContent = originalConfirmLabel; confirmSendBtn.disabled = false; }
    }, 1200);
  } catch (err) {
    console.error('[L&K] Failed to send order:', err);
    alert('Could not send your order. Please check your connection and try again.');
    sendBtn.textContent = originalLabel;
    sendBtn.disabled = false;
    if (confirmSendBtn) { confirmSendBtn.textContent = originalConfirmLabel; confirmSendBtn.disabled = false; }
  }
}

/* Single delegated listener handles every "+" button and every stepper
   button, whether it's inside a product card, the detail modal, or the
   basket modal — all three re-use the same .addBtn / .stepBtn markup. */
document.addEventListener('click', (e) => {
  const addBtn = e.target.closest('.addBtn');
  if (addBtn) {
    e.stopPropagation();
    addToCart(addBtn.dataset.id);
    return;
  }
  const stepBtn = e.target.closest('.stepBtn');
  if (stepBtn) {
    e.stopPropagation();
    const wrap = stepBtn.closest('.stepper');
    const id = wrap?.dataset.id;
    if (!id) return;
    if (stepBtn.dataset.action === 'inc') addToCart(id);
    else decFromCart(id);
  }
});

function cardHTML(p) {
  const badge = p.badge ? `<span class="badge">${escapeHTML(p.badge)}</span>` : "";
  const price = p.price ? `<p class="price">${escapeHTML(String(p.price))}</p>` : "";
  const outOfStock = p.is_out_of_stock;
  const stockRibbon = outOfStock ? `<span class="outOfStockBadge"><span>Out of stock</span></span>` : "";
  return `
    <div class="card ${outOfStock ? 'outOfStock' : ''}" data-id="${p.id}">
      <div class="cardArt">
        ${badge}
        ${stockRibbon}
        <img src="${escapeAttr(p.image_url)}" alt="${escapeAttr(p.name)}">
      </div>
      <div class="cardBody">
        <div class="cardBodyMain">
          <p class="id">ID: ${p.id}</p>
          <p class="name">${escapeHTML(p.name)}</p>
          ${price}
        </div>
        <div class="addWrap cardAddWrap" data-add-id="${p.id}">${addControlHTML(p)}</div>
      </div>
    </div>`;
}
function escapeHTML(str) {
  return (str ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
function escapeAttr(str) { return escapeHTML(str); }

async function loadProducts() {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .order("category", { ascending: true })
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("[L&K menu] Failed to load products:", error.message);
    return;
  }

  allProducts = data || [];
  renderAll(allProducts);
  initCardClicks();
  updateCartBar();
  if (document.getElementById('cartOverlay')?.classList.contains('open')) renderCartModal();
}

function renderAll(products) {
  // group by category
  const byCategory = {};
  products.forEach(p => {
    (byCategory[p.category] ||= []).push(p);
  });
  const bestsellers = products.filter(p => p.is_bestseller);

  renderGrid("bestseller", bestsellers);
  renderGrid("sandwich", byCategory.sandwich || []);
  renderGrid("rice", byCategory.rice || []);
  renderGrid("dessert", byCategory.dessert || []);
  renderGrid("drink", byCategory.drink || []);
}

function renderGrid(category, items) {
  const cfg = CATEGORY_MAP[category];
  if (!cfg) return;
  const gridEl = document.getElementById(cfg.gridId);
  const countEl = document.getElementById(cfg.countId);
  if (gridEl) gridEl.innerHTML = items.map(cardHTML).join("");
  if (countEl) countEl.textContent = items.length ? String(items.length).padStart(2, "0") + " items" : "Coming soon";
}

/* ---------- chips / section nav ---------- */
const chips = document.querySelectorAll('.chip');
const sections = document.querySelectorAll('.sectionHead');
const twines = document.querySelectorAll('.twine');

chips.forEach(chip => {
  chip.addEventListener('click', () => {
    const target = document.getElementById(chip.dataset.target);
    if (target) target.scrollIntoView({ behavior: 'smooth' });
  });
});

// rootMargin's top offset should track the fixed header's real height so
// a section only counts as "current" once it clears the header, not a
// hardcoded guess.
function currentHeaderPx() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--header-h').trim();
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : 172;
}

const sectionObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      chips.forEach(c => c.classList.toggle('active', c.dataset.target === entry.target.id));
    }
  });
}, { rootMargin: `-${currentHeaderPx() + 20}px 0px -70% 0px`, threshold: 0 });
sections.forEach(sec => sectionObserver.observe(sec));

/* ---------- hero slider ---------- */
const heroSlides = document.querySelectorAll('#hero .heroSlide');
const heroDotBtns = document.querySelectorAll('#heroDots button');
let heroIndex = 0;
let heroTimer;

function showHeroSlide(i) {
  heroIndex = i;
  heroSlides.forEach((s, idx) => s.classList.toggle('active', idx === i));
  heroDotBtns.forEach((d, idx) => d.classList.toggle('active', idx === i));
}
function nextHeroSlide() { showHeroSlide((heroIndex + 1) % heroSlides.length); }
function startHeroAutoplay() {
  clearInterval(heroTimer);
  heroTimer = setInterval(nextHeroSlide, 4000);
}
heroDotBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    showHeroSlide(parseInt(btn.dataset.i));
    startHeroAutoplay();
  });
});
startHeroAutoplay();

/* ---------- search by product ID ---------- */
const searchInput = document.getElementById('searchInput');
if (searchInput) {
  searchInput.addEventListener('input', () => {
    const query = searchInput.value.trim().toLowerCase();
    const cards = document.querySelectorAll('.grid .card');

    cards.forEach(card => {
      const id = (card.dataset.id || '').toLowerCase();
      const matches = query === '' || id.includes(query);
      card.style.display = matches ? '' : 'none';
    });

    sections.forEach(sectionHead => {
      let grid = sectionHead.nextElementSibling;
      while (grid && !grid.classList.contains('grid')) {
        grid = grid.nextElementSibling;
      }
      if (!grid) return;
      const anyVisible = Array.from(grid.querySelectorAll('.card'))
        .some(c => c.style.display !== 'none');
      sectionHead.style.display = anyVisible ? '' : 'none';
      grid.style.display = anyVisible ? '' : 'none';
    });

    twines.forEach(twine => {
      const next = twine.nextElementSibling;
      if (next && next.classList.contains('sectionHead')) {
        twine.style.display = next.style.display === 'none' ? 'none' : '';
      }
    });
  });
}

/* ---------- product detail modal ---------- */
const overlay = document.getElementById('modalOverlay');
const modalImg = document.getElementById('modalImg');

function openModal(product) {
  document.getElementById('modalBadge').textContent = product.badge || '';
  document.getElementById('modalBadge').style.display = product.badge ? '' : 'none';
  document.getElementById('modalId').textContent = 'ID: ' + product.id;
  document.getElementById('modalName').textContent = product.name || 'N/A';
  // Coerce to string first: Supabase numeric columns come back as JS
  // numbers, and numbers don't have .replace(), which used to throw here
  // and silently abort the rest of openModal (image never set, modal
  // never opened).
  const rawPrice = product.price != null ? String(product.price) : '';
  document.getElementById('modalPrice').textContent = rawPrice ? ('$' + rawPrice.replace(/^\$/, '')) : '';
  modalImg.src = product.image_url;
  modalImg.alt = product.name || 'N/A';

  const addRow = document.getElementById('modalAddRow');
  if (addRow) {
    addRow.dataset.addId = product.id;
    addRow.innerHTML = addControlHTML(product);
  }

  overlay.classList.add('open');
}
function closeModal() { overlay.classList.remove('open'); }

function initCardClicks() {
  document.querySelectorAll('.grid .card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.dataset.id;
      const product = allProducts.find(p => p.id === id);
      if (!product) {
        console.warn('[L&K menu] No product found for id "' + id + '".');
        return;
      }
      openModal(product);
    });
  });
}

document.getElementById('modalClose').addEventListener('click', closeModal);
overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

/* ---------- basket bar + basket modal ---------- */
const cartOverlay = document.getElementById('cartOverlay');
const cartBarBtn = document.getElementById('cartBarBtn');
const cartClose = document.getElementById('cartClose');
const clearCartBtn = document.getElementById('clearCartBtn');
const sendOrderBtn = document.getElementById('sendOrderBtn');

const custNameInput = document.getElementById('custName');
const custPhoneInput = document.getElementById('custPhone');
const custDateInput = document.getElementById('custDate');

// Don't let a customer pick a date in the past.
if (custDateInput) custDateInput.min = new Date().toISOString().split('T')[0];

function prefillCustomerFields() {
  const saved = loadCustomer();
  if (custNameInput) custNameInput.value = saved.name || '';
  if (custPhoneInput) custPhoneInput.value = saved.phone || '';
  if (custDateInput) custDateInput.value = saved.date || '';
}

[custNameInput, custPhoneInput, custDateInput].forEach(input => {
  if (!input) return;
  input.addEventListener('input', () => {
    saveCustomer(getCustomerFields());
    updateSendButtonState();
  });
});

if (cartBarBtn) {
  cartBarBtn.addEventListener('click', () => {
    prefillCustomerFields();
    renderCartModal();
    cartOverlay.classList.add('open');
  });
}
if (cartClose) cartClose.addEventListener('click', () => cartOverlay.classList.remove('open'));
if (cartOverlay) cartOverlay.addEventListener('click', (e) => { if (e.target === cartOverlay) cartOverlay.classList.remove('open'); });
if (clearCartBtn) clearCartBtn.addEventListener('click', clearCart);
if (sendOrderBtn) sendOrderBtn.addEventListener('click', openConfirmModal);

/* ---------- confirm order modal ---------- */
const confirmOverlay = document.getElementById('confirmOverlay');
const confirmCancelBtn = document.getElementById('confirmCancelBtn');
const confirmSendBtn = document.getElementById('confirmSendBtn');

if (confirmCancelBtn) confirmCancelBtn.addEventListener('click', closeConfirmModal);
if (confirmSendBtn) confirmSendBtn.addEventListener('click', sendOrderToTelegram);
if (confirmOverlay) confirmOverlay.addEventListener('click', (e) => { if (e.target === confirmOverlay) closeConfirmModal(); });

/* ---------- our locations map ---------- */
const locations = [
  { name: 'L&K - First Branch',  address: 'ABA Grand Phnom Penh Branch', lat: 11.629444, lng: 104.872917, url: 'https://maps.app.goo.gl/hN2KTEVes9xH4kVk7' },
  { name: 'L&K - Second Branch', address: 'The Westline school, Russey Keo (598)', lat: 11.632111, lng: 104.883500, url: 'https://maps.app.goo.gl/Qfq4Wr57AxrwQB8g6' }
];

let map, markers = [];
const mapEl = document.getElementById('map');

if (mapEl && window.L) {
  map = L.map('map', {
    zoom: 13,
    zoomControl: true,
    scrollWheelZoom: false,
    attributionControl: false
  });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(map);

  // Logo-based marker: a circular badge showing the shop logo, with a small
  // numbered chip in the corner so branches stay distinguishable.
  function makeIcon(n) {
    const html = `
      <div style="position:relative;width:46px;height:46px;">
        <div style="
          width:46px;height:46px;border-radius:50%;overflow:hidden;
          background:#fff;border:3px solid #fff;
          box-shadow:0 3px 10px rgba(43,33,24,.35), 0 0 0 1px rgba(43,33,24,.08);
        ">
          <img src="img/logo.png" alt="L&K logo" style="width:100%;height:100%;object-fit:cover;display:block;">
        </div>
        <div style="
          position:absolute;bottom:-4px;right:-4px;width:18px;height:18px;border-radius:50%;
          background:#2b2118;color:#fff;font:700 10px 'Inter',sans-serif;
          display:flex;align-items:center;justify-content:center;
          border:2px solid #fff;
        ">${n}</div>
      </div>`;
    return L.divIcon({
      html,
      className: '',
      iconSize: [46, 46],
      iconAnchor: [23, 23],
      popupAnchor: [0, -26]
    });
  }

  markers = locations.map((loc, i) => {
    const m = L.marker([loc.lat, loc.lng], { icon: makeIcon(i + 1) }).addTo(map);
    m.bindPopup(`
      <div style="font-family:'Inter',sans-serif;min-width:165px;padding:2px 0;">
        <div style="font-weight:700;font-size:13px;color:#2b2118;margin-bottom:3px;">${loc.name}</div>
        <div style="font-size:11px;color:#6b5f52;margin-bottom:10px;line-height:1.4;">${loc.address}</div>
        <a href="${loc.url}" target="_blank" rel="noopener"
           style="display:inline-flex;align-items:center;gap:6px;background:#723c10;color:#fff;
                  font-size:11px;font-weight:600;padding:7px 13px;border-radius:8px;text-decoration:none;">
          Get Directions
        </a>
      </div>`, { maxWidth: 220, minWidth: 180 });
    return m;
  });

  const group = L.featureGroup(markers);
  map.fitBounds(group.getBounds().pad(0.35));
}

function focusLocation(i) {
  if (!map || i >= locations.length) return;
  map.setView([locations[i].lat, locations[i].lng], 15, { animate: true, duration: 0.75 });
  markers[i].openPopup();
  document.getElementById('map').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
window.focusLocation = focusLocation;

/* ---------- working hours: highlight today + open/closed status ---------- */
(function () {
  const now = new Date();
  const day = now.getDay();
  const isWeekend = (day === 0 || day === 6);

  const row = document.querySelector(`.hoursRow[data-day="${isWeekend ? "weekend" : "weekday"}"]`);
  if (row) row.classList.add("today");

  const openHour = 4;
  const closeHour = 20;
  const hour = now.getHours();
  const isOpen = !isWeekend && hour >= openHour && hour < closeHour;

  const statusEl = document.getElementById("openStatus");
  if (statusEl) statusEl.textContent = isOpen ? "Open now" : "Closed now";
})();

async function loadHeroImages() {
  const { data, error } = await supabase.from('site_settings').select('*').in('key', ['hero_1', 'hero_2', 'hero_3']);
  if (error) return;
  data.forEach(row => {
    const idNum = row.key.split('_')[1];
    const img = document.getElementById(`heroImg${idNum}`);
    if (img && row.value) img.src = row.value;
  });
}

/* ---------- go ---------- */
loadProducts();
loadHeroImages();
updateCartBar();
updateSendButtonState();

// Live updates: if the admin edits a product while someone has the site
// open, refresh the grids automatically.
supabase
  .channel('products-changes')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => {
    loadProducts();
  })
  .subscribe();