import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY, STORAGE_BUCKET } from "./supabase-config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ---------- lock zoom (iOS Safari ignores user-scalable=no, so block gestures directly) ---------- */
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('gesturechange', (e) => e.preventDefault());
document.addEventListener('touchmove', (e) => {
  if (e.touches.length > 1) e.preventDefault();
}, { passive: false });
let lastTouchEnd = 0;
document.addEventListener('touchend', (e) => {
  const now = Date.now();
  if (now - lastTouchEnd <= 300) e.preventDefault();
  lastTouchEnd = now;
}, { passive: false });

const loginWrap = document.getElementById('loginWrap');
const dash = document.getElementById('dash');
const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');
const loginBtn = document.getElementById('loginBtn');
const loginBtnLabel = document.getElementById('loginBtnLabel');

const togglePasswordBtn = document.getElementById('togglePassword');
const loginPasswordInput = document.getElementById('loginPassword');
if (togglePasswordBtn && loginPasswordInput) {
  togglePasswordBtn.addEventListener('click', () => {
    const isPassword = loginPasswordInput.type === 'password';
    loginPasswordInput.type = isPassword ? 'text' : 'password';
    togglePasswordBtn.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
  });
}

let products = [];
let activeCategory = 'all';
let searchQuery = '';
let currentPhotoProductId = null;
let currentPage = 'dashboard';
let filterBestseller = false;
let filterOutOfStock = false;
let orders = [];
let ordersRealtimeChannel = null;

const CATEGORY_SETTING_KEY = 'menu_categories';
const DEFAULT_CATEGORIES = [
  { slug: 'sandwich', id: 'LK-S', name: 'Sandwich', customerLabel: 'សាំងវិច' },
  { slug: 'rice', id: 'LK-R', name: 'Rice', customerLabel: 'បាយ' },
  { slug: 'dessert', id: 'LK-D', name: 'Dessert', customerLabel: 'បង្អែម' },
  { slug: 'drink', id: 'LK-DR', name: 'Drink', customerLabel: 'ភេសជ្ជៈ' },
  { slug: 'salad', id: 'LK-SA', name: 'Salad', customerLabel: 'សាឡាដ' }
];
let categories = DEFAULT_CATEGORIES.map(category => ({ ...category }));

const PLACEHOLDER_IMAGE = 'img/placeholder.jpg';

/* ---------- auth ---------- */
async function checkSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    showDashboard();
  } else {
    showLogin();
  }
}

function showLogin() {
  loginWrap.style.display = 'flex';
  dash.style.display = 'none';
}

function showDashboard() {
  loginWrap.style.display = 'none';
  dash.style.display = 'block';
  loadProducts();
  setupSettingsPage();
  loadHeroSettings();
  setGreeting();
  subscribeToOrderChanges();
  switchPage('dashboard');
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.textContent = '';
  loginBtn.disabled = true;
  loginBtnLabel.textContent = 'Signing in…';

  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  loginBtn.disabled = false;
  loginBtnLabel.textContent = 'Sign In';

  if (error) {
    loginError.textContent = error.message || 'Could not sign in. Check your email and password.';
    return;
  }
  showDashboard();
});

async function logout() {
  if (ordersRealtimeChannel) {
    await supabase.removeChannel(ordersRealtimeChannel);
    ordersRealtimeChannel = null;
  }
  await supabase.auth.signOut();
  if (window.parent !== window) {
    window.parent.postMessage({ type: 'lk-admin-signed-out' }, window.location.origin);
  }
  showLogin();
}

/* ---------- tab navigation ---------- */
const pageTitleEl = document.getElementById('pageTitle');
const menuToolbar = document.getElementById('menuToolbar');
const fabBtn = document.getElementById('addProductBtn');
const pages = {
  dashboard: document.getElementById('page-dashboard'),
  menu: document.getElementById('page-menu'),
  orders: document.getElementById('page-orders'),
  settings: document.getElementById('page-settings')
};
const PAGE_TITLES = { dashboard: 'Dashboard', menu: 'Menu', orders: 'Orders', settings: 'Settings' };

function switchPage(name) {
  if (!pages[name]) return;
  currentPage = name;

  Object.entries(pages).forEach(([key, el]) => {
    if (el) el.classList.toggle('active', key === name);
  });

  document.querySelectorAll('.navBtn').forEach(b => {
    b.classList.toggle('active', b.dataset.page === name);
  });

  if (pageTitleEl) pageTitleEl.textContent = PAGE_TITLES[name] || '';
  if (menuToolbar) menuToolbar.style.display = name === 'menu' ? 'flex' : 'none';
  if (fabBtn) fabBtn.style.display = (name === 'settings' || name === 'orders') ? 'none' : 'flex';

  if (name === 'dashboard') updateDashboardStats();
  if (name === 'menu') renderCategoryManager();
  if (name === 'orders') loadOrders();

  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

document.querySelectorAll('.navBtn').forEach(btn => {
  btn.addEventListener('click', () => switchPage(btn.dataset.page));
});

/* ---------- dashboard page ---------- */
function updateDashboardStats() {
  const totalItems = products.length;
  const categoriesUsed = new Set(products.map(p => p.category)).size;
  const featured = products.filter(p => p.is_bestseller).length;
  const outOfStock = products.filter(p => p.is_out_of_stock).length;

  const elTotal = document.getElementById('statTotalItems');
  const elCats = document.getElementById('statCategories');
  const elFeatured = document.getElementById('statFeatured');
  const elOutOfStock = document.getElementById('statOutOfStock');
  if (elTotal) elTotal.textContent = totalItems;
  if (elCats) elCats.textContent = categoriesUsed;
  if (elFeatured) elFeatured.textContent = featured;
  if (elOutOfStock) elOutOfStock.textContent = outOfStock;
}

document.getElementById('quickAddItem')?.addEventListener('click', () => {
  openAddProductModal();
});
document.getElementById('quickCreateCategory')?.addEventListener('click', () => {
  openCategoryModal();
});

/* ---------- orders page ---------- */
const ordersList = document.getElementById('ordersList');
const ordersCount = document.getElementById('ordersCount');
const ordersRefreshBtn = document.getElementById('ordersRefreshBtn');
const ordersWeekStrip = document.getElementById('ordersWeekStrip');
const ordersPeriodMode = document.getElementById('ordersPeriodMode');
const ordersPeriodLabel = document.getElementById('ordersPeriodLabel');
const ordersPrevPeriod = document.getElementById('ordersPrevPeriod');
const ordersNextPeriod = document.getElementById('ordersNextPeriod');
const ordersDatePicker = document.getElementById('ordersDatePicker');
const ordersFilterBtn = document.getElementById('ordersFilterBtn');
const ordersFilterMenu = document.getElementById('ordersFilterMenu');
let selectedOrderDate = localDateInputValue();
let activeOrderPeriod = 'day';

function formatOrderCreatedAt(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  });
}

function localDateInputValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function localDateFromInput(value) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function startOfWeek(date) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setDate(result.getDate() - ((result.getDay() + 6) % 7));
  return result;
}

function orderPeriodBounds(period, value) {
  if (period === 'all') return null;
  const anchor = localDateFromInput(value);
  let start;
  let end;

  if (period === 'week') {
    start = startOfWeek(anchor);
    end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
  } else if (period === 'month') {
    start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);
  } else if (period === 'year') {
    start = new Date(anchor.getFullYear(), 0, 1);
    end = new Date(anchor.getFullYear() + 1, 0, 1);
  } else {
    start = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
    end = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + 1);
  }

  return { start: start.toISOString(), end: end.toISOString() };
}

function formatOrderPeriodLabel() {
  if (activeOrderPeriod === 'all') return 'All order records';
  const anchor = localDateFromInput(selectedOrderDate);
  if (activeOrderPeriod === 'day') {
    return anchor.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }
  if (activeOrderPeriod === 'month') {
    return anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }
  if (activeOrderPeriod === 'year') return String(anchor.getFullYear());

  const start = startOfWeek(anchor);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  const startText = start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const endText = end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return `${startText} – ${endText}`;
}

function renderOrdersWeekStrip() {
  if (!ordersWeekStrip) return;
  const anchor = localDateFromInput(selectedOrderDate);
  const weekStart = startOfWeek(anchor);
  const today = localDateInputValue();
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + index);
    const value = localDateInputValue(date);
    const classes = ['ordersDayBtn'];
    if (value === selectedOrderDate) classes.push('active');
    if (value === today) classes.push('today');
    const label = date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    return `<button type="button" class="${classes.join(' ')}" data-order-date="${value}" aria-label="${escapeAttr(label)}" aria-pressed="${value === selectedOrderDate}">
      <span>${date.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 3)}</span>
      <strong>${date.getDate()}</strong>
    </button>`;
  });
  ordersWeekStrip.innerHTML = days.join('');
}

function setOrdersFilterOpen(open) {
  if (!ordersFilterBtn || !ordersFilterMenu) return;
  ordersFilterMenu.classList.toggle('open', open);
  ordersFilterBtn.setAttribute('aria-expanded', String(open));
}

function syncOrderDateControls() {
  if (ordersPeriodMode) ordersPeriodMode.textContent = activeOrderPeriod === 'all'
    ? 'Records'
    : `${activeOrderPeriod.charAt(0).toUpperCase()}${activeOrderPeriod.slice(1)} view`;
  if (ordersPeriodLabel) ordersPeriodLabel.textContent = formatOrderPeriodLabel();
  if (ordersFilterBtn) ordersFilterBtn.classList.toggle('hasActiveFilter', activeOrderPeriod !== 'day');
  if (ordersPrevPeriod) ordersPrevPeriod.disabled = activeOrderPeriod === 'all';
  if (ordersNextPeriod) ordersNextPeriod.disabled = activeOrderPeriod === 'all';
  if (ordersDatePicker) ordersDatePicker.value = selectedOrderDate;
  document.querySelectorAll('[data-order-period]').forEach(button => {
    button.classList.toggle('active', button.dataset.orderPeriod === activeOrderPeriod);
  });
  renderOrdersWeekStrip();
}

function moveOrderPeriod(direction) {
  if (activeOrderPeriod === 'all') return;
  const anchor = localDateFromInput(selectedOrderDate);
  if (activeOrderPeriod === 'month') anchor.setMonth(anchor.getMonth() + direction);
  else if (activeOrderPeriod === 'year') anchor.setFullYear(anchor.getFullYear() + direction);
  else anchor.setDate(anchor.getDate() + (7 * direction));
  selectedOrderDate = localDateInputValue(anchor);
  syncOrderDateControls();
  loadOrders();
}

function formatOrderSchedule(dateValue, timeValue) {
  const date = dateValue
    ? new Date(`${dateValue}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : 'No date';
  return timeValue ? `${date} · ${timeValue}` : date;
}

function safeOrderItems(value) {
  return Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : [];
}

const ADMIN_KHR_PER_USD = 4000;

function formatAdminRiel(usdAmount) {
  const riel = Math.round(Number(usdAmount || 0) * ADMIN_KHR_PER_USD);
  return `${riel.toLocaleString('en-US')} ៛`;
}

function orderAddressHTML(order) {
  if (order.order_type !== 'delivery') return '';
  const address = String(order.delivery_address || '—');
  const isMapLink = /^https:\/\/www\.google\.com\/maps\?q=-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/i.test(address);
  const value = isMapLink
    ? `<a href="${escapeAttr(address)}" target="_blank" rel="noopener">Open customer location</a>`
    : `<span>${escapeHTML(address)}</span>`;
  return `
    <div class="orderDetailRow orderAddressRow">
      <span class="orderDetailIcon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>
      </span>
      ${value}
    </div>`;
}

function orderCardHTML(order) {
  const items = safeOrderItems(order.items);
  const orderTotal = Number(order.total || 0);
  const itemsHTML = items.map(item => {
    const catalogProduct = products.find(product => String(product.id) === String(item.id));
    const snapshotImage = String(item.image_url || '');
    const safeSnapshotImage = snapshotImage.startsWith('img/')
      || snapshotImage.startsWith(`${SUPABASE_URL}/storage/v1/object/public/`)
      ? snapshotImage
      : '';
    const imageUrl = String(catalogProduct?.image_url || safeSnapshotImage || PLACEHOLDER_IMAGE);
    const itemName = String(item.name || catalogProduct?.name || item.id || 'Item');
    return `
    <div class="adminOrderItem">
      <span class="adminOrderItemImage">
        <img src="${escapeAttr(imageUrl)}" alt="${escapeAttr(itemName)}" loading="lazy">
      </span>
      <span class="adminOrderItemBody">
        <span class="adminOrderItemName">${escapeHTML(itemName)}</span>
        ${item.id ? `<small class="adminOrderItemId">ID: ${escapeHTML(String(item.id))}</small>` : ''}
        <span class="adminOrderItemMeta">
          <span>${Number(item.quantity) || 0} ordered</span>
          <strong>$${Number(item.line_total || 0).toFixed(2)}</strong>
        </span>
      </span>
    </div>`;
  }).join('');
  const phone = String(order.customer_phone || '');
  const paymentLabel = order.payment_method === 'aba' ? 'ABA Pay' : 'Cash';
  const paymentState = order.payment_status === 'paid' ? 'Paid' : 'Cash on delivery';
  const numericOrderNumber = Number(order.order_number);
  const orderNumber = Number.isFinite(numericOrderNumber) && numericOrderNumber > 0
    ? String(numericOrderNumber).padStart(3, '0')
    : String(order.id || '').slice(0, 8).toUpperCase();
  const itemsPanelId = `admin-order-items-${String(order.id || orderNumber).replace(/[^a-z0-9_-]/gi, '')}`;
  const phoneHref = phone.replace(/[^+\d]/g, '');
  const phoneHTML = phone
    ? `<a class="adminOrderPhone" href="tel:${escapeAttr(phoneHref)}">
        <span class="adminOrderPhoneIcon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.33 1.78.62 2.63a2 2 0 0 1-.45 2.11L8 9.73a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.85.29 1.73.5 2.63.62A2 2 0 0 1 22 16.92Z"/></svg></span>
        <span>${escapeHTML(phone)}</span>
      </a>`
    : '<span class="adminOrderPhone adminOrderPhoneMissing">No phone number</span>';

  return `
    <article class="adminOrderCard" data-order-id="${escapeAttr(String(order.id || ''))}">
      <div class="adminOrderHead">
        <div class="adminOrderIdentity">
          <span class="adminOrderEyebrow">Order record</span>
          <span class="adminOrderNumber">Order #${escapeHTML(String(orderNumber))}</span>
        </div>
        <time class="adminOrderTime">${escapeHTML(formatOrderCreatedAt(order.created_at))}</time>
      </div>

      <div class="adminOrderCustomer">
        <span class="adminOrderCustomerIcon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>
        </span>
        <div class="adminOrderCustomerBody">
          <span class="adminOrderSectionLabel">Customer</span>
          <strong>${escapeHTML(String(order.customer_name || 'Customer'))}</strong>
          ${phoneHTML}
        </div>
      </div>

      <div class="adminOrderChips">
        <span class="adminOrderChip adminOrderChipPrimary">${order.order_type === 'delivery' ? 'Delivery' : 'Pick-up'}</span>
        <span class="adminOrderChip">${paymentState}</span>
        <span class="adminOrderChip">${Number(order.item_count) || 0} item${Number(order.item_count) === 1 ? '' : 's'}</span>
      </div>

      <div class="adminOrderFulfillment">
        <div class="orderDetailRow">
          <span class="orderDetailIcon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
          </span>
          <span>${escapeHTML(formatOrderSchedule(order.scheduled_date, order.scheduled_time))}</span>
        </div>
        ${orderAddressHTML(order)}
        <button type="button" class="adminOrderItemsToggle" data-order-items-toggle aria-expanded="false" aria-controls="${escapeAttr(itemsPanelId)}">
          <span class="adminOrderItemsToggleLabel">View more</span>
          <strong>${Number(order.item_count) || 0}</strong>
          <svg class="adminOrderItemsChevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
        </button>
      </div>

      <div class="adminOrderItems" id="${escapeAttr(itemsPanelId)}" hidden>
        ${itemsHTML || '<p class="adminOrderNoItems">No item details</p>'}
        <div class="adminOrderTotal">
          <span>Total</span>
          <span class="adminOrderTotalValues">
            <strong>$${orderTotal.toFixed(2)}</strong>
            <small>${formatAdminRiel(orderTotal)}</small>
          </span>
        </div>
      </div>

      ${order.payment_transaction_id ? `<p class="adminOrderTransaction">ABA transaction: ${escapeHTML(String(order.payment_transaction_id))}</p>` : ''}
    </article>`;
}

function renderOrders() {
  if (!ordersList || !ordersCount) return;
  ordersCount.textContent = `${orders.length} order${orders.length === 1 ? '' : 's'} · ${formatOrderPeriodLabel()}`;
  ordersList.innerHTML = orders.length
    ? orders.map(orderCardHTML).join('')
    : `<p class="ordersEmpty">No orders found for ${escapeHTML(formatOrderPeriodLabel().toLowerCase())}.</p>`;
}

async function loadOrders() {
  if (!ordersList || !ordersCount) return;
  ordersCount.textContent = 'Loading orders…';
  ordersRefreshBtn?.classList.add('loading');

  let query = supabase
    .from('orders')
    .select('*')
    .order('created_at', { ascending: false });

  const dateBounds = orderPeriodBounds(activeOrderPeriod, selectedOrderDate);
  if (dateBounds) {
    const { start, end } = dateBounds;
    query = query.gte('created_at', start).lt('created_at', end);
  } else {
    query = query.limit(200);
  }

  const { data, error } = await query;

  ordersRefreshBtn?.classList.remove('loading');
  if (error) {
    console.error('[L&K admin] Could not load orders:', error);
    ordersCount.textContent = 'Orders unavailable';
    ordersList.innerHTML = '<p class="ordersEmpty ordersError">Could not load orders. Check the database setup and try again.</p>';
    return;
  }

  orders = data || [];
  renderOrders();
}

ordersRefreshBtn?.addEventListener('click', loadOrders);
ordersList?.addEventListener('click', event => {
  const button = event.target.closest('[data-order-items-toggle]');
  if (!button) return;
  const panel = document.getElementById(button.getAttribute('aria-controls'));
  if (!panel) return;
  const expanded = button.getAttribute('aria-expanded') === 'true';
  button.setAttribute('aria-expanded', String(!expanded));
  panel.hidden = expanded;
  const label = button.querySelector('.adminOrderItemsToggleLabel');
  if (label) label.textContent = expanded ? 'View more' : 'Hide items';
});
ordersPrevPeriod?.addEventListener('click', () => moveOrderPeriod(-1));
ordersNextPeriod?.addEventListener('click', () => moveOrderPeriod(1));
ordersDatePicker?.addEventListener('change', () => {
  if (!ordersDatePicker.value) return;
  selectedOrderDate = ordersDatePicker.value;
  activeOrderPeriod = 'day';
  setOrdersFilterOpen(false);
  syncOrderDateControls();
  loadOrders();
});
ordersWeekStrip?.addEventListener('click', event => {
  const button = event.target.closest('[data-order-date]');
  if (!button) return;
  selectedOrderDate = button.dataset.orderDate;
  activeOrderPeriod = 'day';
  syncOrderDateControls();
  loadOrders();
});
ordersFilterBtn?.addEventListener('click', event => {
  event.stopPropagation();
  setOrdersFilterOpen(!ordersFilterMenu?.classList.contains('open'));
});
ordersFilterMenu?.addEventListener('click', event => {
  const button = event.target.closest('[data-order-period]');
  if (!button) return;
  activeOrderPeriod = button.dataset.orderPeriod;
  setOrdersFilterOpen(false);
  syncOrderDateControls();
  loadOrders();
});
document.addEventListener('click', event => {
  if (!event.target.closest('.ordersPeriodFilter')) setOrdersFilterOpen(false);
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') setOrdersFilterOpen(false);
});
syncOrderDateControls();

function subscribeToOrderChanges() {
  if (ordersRealtimeChannel) return;
  ordersRealtimeChannel = supabase
    .channel('admin-order-records')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
      if (currentPage === 'orders') loadOrders();
    })
    .subscribe();
}

/* ---------- greeting ---------- */
function setGreeting() {
  const titleEl = document.getElementById('greetingTitle');
  const dateEl = document.getElementById('greetingDate');
  if (!titleEl && !dateEl) return;

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  if (titleEl) titleEl.textContent = greeting;

  if (dateEl) {
    dateEl.textContent = now.toLocaleDateString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric'
    });
  }
}

/* ---------- hero slideshow settings ---------- */
const heroSettingsGrid = document.getElementById('heroSettingsGrid');
const heroAddSlideBtn = document.getElementById('heroAddSlideBtn');
const heroAddSlideInput = document.getElementById('heroAddSlideInput');

function heroSlideNumber(key) {
  const match = String(key || '').match(/^hero_([1-9]\d*)$/);
  return match ? Number(match[1]) : 0;
}

function findHeroSlot(key) {
  return Array.from(heroSettingsGrid?.querySelectorAll('.heroSlot[data-hero-key]') || [])
    .find(slot => slot.dataset.heroKey === key) || null;
}

function createHeroSlot(key, imageUrl) {
  const slideNumber = heroSlideNumber(key);
  if (!slideNumber) return null;
  const slot = document.createElement('div');
  slot.className = 'heroSlot';
  slot.dataset.heroKey = key;
  slot.innerHTML = `
    <img id="heroPreview${slideNumber}" src="${escapeAttr(imageUrl)}" alt="Slide ${slideNumber}">
    <div class="heroSlotOverlay">Tap to replace</div>
    <input type="file" accept="image/*" data-hero-input="${escapeAttr(key)}">`;
  return slot;
}

function ensureHeroSlot(key, imageUrl) {
  let slot = findHeroSlot(key);
  if (!slot) {
    slot = createHeroSlot(key, imageUrl);
    if (slot && heroSettingsGrid) heroSettingsGrid.insertBefore(slot, heroAddSlideBtn || heroAddSlideInput || null);
  }
  const img = slot?.querySelector('img');
  if (img && imageUrl) img.src = imageUrl;
  return slot;
}

function nextHeroSlideNumber() {
  const numbers = Array.from(heroSettingsGrid?.querySelectorAll('.heroSlot[data-hero-key]') || [])
    .map(slot => heroSlideNumber(slot.dataset.heroKey));
  return Math.max(3, ...numbers) + 1;
}

async function uploadHeroSlide(file, key, slot) {
  if (!file || !key || !slot) return false;
  const uploading = document.createElement('div');
  uploading.className = 'heroSlotUploading';
  uploading.textContent = 'Uploading…';
  slot.appendChild(uploading);

  try {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `site/${key}-${Date.now()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(path, file, { upsert: true, cacheControl: '3600' });
    if (uploadError) throw uploadError;

    const { data: publicUrlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
    const publicUrl = publicUrlData.publicUrl;
    const { error: updateError } = await supabase
      .from('site_settings')
      .upsert({ key, value: publicUrl }, { onConflict: 'key' });
    if (updateError) throw updateError;

    const img = slot.querySelector('img');
    if (img) img.src = publicUrl;
    toast(`Slide ${heroSlideNumber(key)} updated`);
    return true;
  } catch (error) {
    toast('Could not upload slide: ' + (error?.message || 'Unknown error'), true);
    return false;
  } finally {
    uploading.remove();
  }
}

function bindHeroSettingsEditor() {
  if (!heroSettingsGrid || heroSettingsGrid.dataset.editorBound === 'true') return;
  heroSettingsGrid.dataset.editorBound = 'true';

  heroAddSlideBtn?.addEventListener('click', () => heroAddSlideInput?.click());
  heroSettingsGrid.addEventListener('change', async event => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== 'file') return;
    const file = input.files?.[0];
    if (!file) return;

    input.disabled = true;
    if (input === heroAddSlideInput) {
      const slideNumber = nextHeroSlideNumber();
      const key = `hero_${slideNumber}`;
      const temporaryUrl = URL.createObjectURL(file);
      const slot = ensureHeroSlot(key, temporaryUrl);
      const uploaded = await uploadHeroSlide(file, key, slot);
      URL.revokeObjectURL(temporaryUrl);
      if (!uploaded) slot?.remove();
    } else if (input.matches('[data-hero-input]')) {
      await uploadHeroSlide(file, input.dataset.heroInput, input.closest('.heroSlot'));
    }
    input.value = '';
    input.disabled = false;
  });
}

async function loadHeroSettings() {
  const { data, error } = await supabase.from('site_settings').select('key,value').like('key', 'hero_%');
  if (error) {
    console.warn('[L&K admin] Could not load hero settings:', error.message);
    return;
  }
  (data || [])
    .filter(row => heroSlideNumber(row.key) > 0 && row.value)
    .sort((a, b) => heroSlideNumber(a.key) - heroSlideNumber(b.key))
    .forEach(row => ensureHeroSlot(row.key, row.value));
}

/* ---------- settings page ---------- */
function getPublicSiteUrl() {
  const path = window.location.pathname;
  const dir = path.substring(0, path.lastIndexOf('/') + 1);
  return window.location.origin + dir + 'index.html';
}

async function setupSettingsPage() {
  bindHeroSettingsEditor();
  const emailEl = document.getElementById('settingsEmail');
  if (emailEl) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      emailEl.textContent = user?.email || '—';
    } catch {
      emailEl.textContent = '—';
    }
  }

  const publicUrl = getPublicSiteUrl();
  const qrImg = document.getElementById('qrImg');
  if (qrImg) {
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=520x520&margin=8&data=${encodeURIComponent(publicUrl)}`;
  }
}

document.getElementById('settingsViewSite')?.addEventListener('click', () => {
  window.open('index.html', '_blank');
});
document.getElementById('customerSiteBtn')?.addEventListener('click', () => {
  if (window.parent !== window) {
    window.parent.postMessage({ type: 'lk-admin-exit' }, window.location.origin);
  } else {
    window.location.href = 'index.html';
  }
});
document.getElementById('settingsLogout')?.addEventListener('click', () => {
  if (confirm('Log out of the admin panel?')) logout();
});
document.getElementById('copyLinkBtn')?.addEventListener('click', async () => {
  const url = getPublicSiteUrl();
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied');
  } catch {
    toast('Could not copy — long-press the link above to copy manually', true);
  }
});

/* ---------- toast ---------- */
const toastEl = document.getElementById('toast');
let toastTimer;
function toast(msg, isError = false) {
  toastEl.textContent = msg;
  toastEl.classList.toggle('error', isError);
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2400);
}

/* ---------- load + render ---------- */
async function loadProducts() {
  const loadingRow = document.getElementById('loadingRow');
  if (loadingRow) loadingRow.style.display = 'block';

  const { data, error } = await supabase
    .from('products')
    .select('*')
    .order('category', { ascending: true })
    .order('sort_order', { ascending: true });

  if (loadingRow) loadingRow.style.display = 'none';

  if (error) {
    toast('Failed to load products: ' + error.message, true);
    return;
  }
  products = data || [];
  if (currentPage === 'orders' && orders.length) renderOrders();
  await loadCategories();
  updateCategoryCounts();
  updateDashboardStats();
  render();
}

function titleFromSlug(slug) {
  return String(slug || '')
    .split('-')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function normalizeCategoryList(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.flatMap(item => {
    const slug = String(item?.slug || '').trim().toLowerCase();
    const name = String(item?.name || '').trim();
    const id = String(item?.id || '').trim().toUpperCase();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !name || seen.has(slug)) return [];
    seen.add(slug);
    return [{
      slug,
      ...(id ? { id } : {}),
      name,
      customerLabel: String(item?.customerLabel || name).trim() || name,
      hidden: Boolean(item?.hidden)
    }];
  });
}

function mergeProductCategories(savedCategories) {
  const merged = DEFAULT_CATEGORIES.map(category => ({ ...category }));
  savedCategories.forEach(category => {
    const existingIndex = merged.findIndex(item => item.slug === category.slug);
    if (existingIndex >= 0) {
      const defaultId = merged[existingIndex].id;
      merged[existingIndex] = { ...merged[existingIndex], ...category };
      if (defaultId) merged[existingIndex].id = defaultId;
    }
    else merged.push({ ...category });
  });
  const seen = new Set(merged.map(category => category.slug));
  products.forEach(product => {
    const slug = String(product.category || '').trim().toLowerCase();
    if (!slug || seen.has(slug)) return;
    seen.add(slug);
    const name = titleFromSlug(slug) || slug;
    merged.push({ slug, name, customerLabel: name, hidden: false });
  });
  return merged;
}

async function loadCategories() {
  const { data, error } = await supabase
    .from('site_settings')
    .select('value')
    .eq('key', CATEGORY_SETTING_KEY)
    .maybeSingle();

  let savedCategories = [];
  if (error) {
    console.warn('[L&K admin] Could not load menu categories:', error.message);
  } else if (data?.value) {
    try {
      savedCategories = normalizeCategoryList(JSON.parse(data.value));
    } catch (parseError) {
      console.warn('[L&K admin] Invalid menu category setting:', parseError);
    }
  }

  categories = mergeProductCategories(savedCategories);
  if (activeCategory !== 'all' && !categories.some(category => category.slug === activeCategory)) {
    activeCategory = 'all';
  }
  renderCategoryControls();
}

function renderCategoryControls() {
  const catFilter = document.getElementById('catFilter');
  const newCategorySelect = document.getElementById('newCategory');
  if (catFilter) {
    const controls = [{ slug: 'all', name: 'All', customerLabel: 'All' }, ...categories];
    catFilter.innerHTML = controls.map(category => `
      <button type="button" class="catBtn${activeCategory === category.slug ? ' active' : ''}" data-cat="${escapeAttr(category.slug)}">
        <span class="catDot" aria-hidden="true"></span>
        <span class="catLabel">${escapeHTML(category.customerLabel || category.name)}</span>
      </button>`).join('');
    window.requestAnimationFrame(() => {
      catFilter.querySelector('.catBtn.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  }
  if (newCategorySelect) {
    const selected = newCategorySelect.value;
    newCategorySelect.innerHTML = categories.map(category =>
      `<option value="${escapeAttr(category.slug)}">${escapeHTML(category.customerLabel || category.name)}${category.hidden ? ' (Hidden)' : ''}</option>`
    ).join('');
    if (categories.some(category => category.slug === selected)) newCategorySelect.value = selected;
  }
  renderCategoryManager();
}

function updateCategoryCounts() {
  const counts = { all: products.length };
  categories.forEach(category => { counts[category.slug] = 0; });
  products.forEach(p => {
    if (counts[p.category] !== undefined) counts[p.category]++;
  });
  document.querySelectorAll('.catBtn').forEach(button => {
    const cat = button.dataset.cat;
    const category = categories.find(item => item.slug === cat);
    const label = cat === 'all'
      ? 'All'
      : category?.customerLabel || category?.name || titleFromSlug(cat) || cat;
    const labelEl = button.querySelector('.catLabel');
    if (labelEl) labelEl.textContent = `${label} (${counts[cat] ?? 0})${category?.hidden ? ' · Hidden' : ''}`;
  });
}

function render() {
  const listEl = document.getElementById('productList');
  if (!listEl) return;

  renderCategoryManager();

  const filtered = products.filter(p => {
  const matchesCat = activeCategory === 'all' || p.category === activeCategory;
  const q = searchQuery.toLowerCase();
  const matchesSearch = !q || p.id.toLowerCase().includes(q) || (p.name || '').toLowerCase().includes(q);
  const matchesBestseller = !filterBestseller || p.is_bestseller;
  const matchesOutOfStock = !filterOutOfStock || p.is_out_of_stock;
  return matchesCat && matchesSearch && matchesBestseller && matchesOutOfStock;
});

  const resultsCountEl = document.getElementById('resultsCount');
  if (resultsCountEl) {
    resultsCountEl.textContent = `${filtered.length} item${filtered.length === 1 ? '' : 's'}`;
  }

  listEl.innerHTML = filtered.map(rowHTML).join('') || '<p class="loadingRow">No products match.</p>';

  filtered.forEach(p => wireRow(p.id));
}

const TRASH_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
const STAR_ICON = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14l-5-4.87 6.91-1.01L12 2z"/></svg>`;
const NO_ENTRY_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>`;

function rowHTML(p) {
  const priceValue = (p.price || '').replace(/^\$/, '');
  return `
    <div class="productRow" data-id="${escapeAttr(p.id)}">
      <div class="rowImg" data-role="imgTrigger">
        <img src="${p.image_url}" alt="${escapeAttr(p.name)}">
        <div class="imgOverlay">View photo</div>
      </div>

      <div class="rowFields">
        <div class="rowTopLine">
          <input type="text" class="nameInput" data-role="name" value="${escapeAttr(p.name)}" placeholder="Product name">
        </div>

        <div class="rowMeta">
          <span class="rowId">${escapeHTML(p.id)}</span>
          <span class="catTag">${escapeHTML(p.category)}</span>
          ${p.is_out_of_stock ? '<span class="stockTag">Out of Stock</span>' : ''}
          <span class="savedTick" data-role="savedTick">Saved ✓</span>
        </div>

        <div class="rowBottomLine">
          <div class="priceWrap">
            <span class="priceSign">$</span>
            <input type="text" class="priceInput" data-role="price" value="${escapeAttr(priceValue)}" placeholder="0.00">
          </div>

          <div class="rowActionsRight">
            <button type="button" class="bestBtn ${p.is_bestseller ? 'active' : ''}"
                    data-role="bestseller" data-active="${p.is_bestseller ? '1' : '0'}"
                    title="Show in Bestseller section">${STAR_ICON}</button>
            <button type="button" class="stockBtn ${p.is_out_of_stock ? 'active' : ''}"
                    data-role="outofstock" data-active="${p.is_out_of_stock ? '1' : '0'}"
                    title="Mark Out of Stock">${NO_ENTRY_ICON}</button>
            <button type="button" class="deleteIconBtn" data-role="deleteBtn" aria-label="Delete product">${TRASH_ICON}</button>
          </div>
        </div>
      </div>
    </div>`;
}

function escapeHTML(str) {
  return (str ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
function escapeAttr(str) { return escapeHTML(str); }

function wireRow(id) {
  const row = document.querySelector(`.productRow[data-id="${cssEscape(id)}"]`);
  if (!row) return;

  const nameEl = row.querySelector('[data-role="name"]');
  const priceEl = row.querySelector('[data-role="price"]');
  const bestBtn = row.querySelector('[data-role="bestseller"]');
  const stockBtn = row.querySelector('[data-role="outofstock"]');
  const savedTick = row.querySelector('[data-role="savedTick"]');
  const deleteBtn = row.querySelector('[data-role="deleteBtn"]');
  const imgTrigger = row.querySelector('[data-role="imgTrigger"]');

  async function saveField(patch) {
    const { error } = await supabase.from('products').update(patch).eq('id', id);
    if (error) {
      toast('Save failed: ' + error.message, true);
      return;
    }
    const local = products.find(p => p.id === id);
    if (local) Object.assign(local, patch);
    savedTick.classList.add('show');
    setTimeout(() => savedTick.classList.remove('show'), 1200);
  }

  nameEl.addEventListener('change', () => saveField({ name: nameEl.value.trim() }));
  priceEl.addEventListener('change', () => {
    const v = priceEl.value.trim();
    saveField({ price: v ? '$' + v.replace(/^\$/, '') : '' });
  });

  bestBtn.addEventListener('click', () => {
    const next = bestBtn.dataset.active !== '1';
    bestBtn.dataset.active = next ? '1' : '0';
    bestBtn.classList.toggle('active', next);
    saveField({ is_bestseller: next });
    updateDashboardStats();
  });

  stockBtn.addEventListener('click', () => {
    const next = stockBtn.dataset.active !== '1';
    stockBtn.dataset.active = next ? '1' : '0';
    stockBtn.classList.toggle('active', next);
    saveField({ is_out_of_stock: next });
    updateStockTagInPlace(row, next);
  });

  deleteBtn.addEventListener('click', async () => {
    if (!confirm(`Delete product ${id}? This cannot be undone.`)) return;
    const { error } = await supabase.from('products').delete().eq('id', id);
    if (error) {
      toast('Delete failed: ' + error.message, true);
      return;
    }
    products = products.filter(p => p.id !== id);
    toast(`${id} deleted`);
    updateCategoryCounts();
    updateDashboardStats();
    render();
  });

  imgTrigger.addEventListener('click', () => openPhotoModal(id));
}

function updateStockTagInPlace(row, isOut) {
  const rowMeta = row.querySelector('.rowMeta');
  let tag = rowMeta.querySelector('.stockTag');
  if (isOut && !tag) {
    tag = document.createElement('span');
    tag.className = 'stockTag';
    tag.textContent = 'Out of Stock';
    const savedTick = rowMeta.querySelector('[data-role="savedTick"]');
    rowMeta.insertBefore(tag, savedTick);
  } else if (!isOut && tag) {
    tag.remove();
  }
}

function cssEscape(str) {
  return str.replace(/["\\]/g, '\\$&');
}

/* ---------- photo lightbox modal ---------- */
const photoModalOverlay = document.getElementById('photoModalOverlay');
const photoModalImg = document.getElementById('photoModalImg');
const photoModalId = document.getElementById('photoModalId');
const photoModalUploading = document.getElementById('photoModalUploading');
const photoModalFileInput = document.getElementById('photoModalFileInput');
const photoChangeBtn = document.getElementById('photoChangeBtn');
const photoEditBtn = document.getElementById('photoEditBtn');
const photoDeleteBtn = document.getElementById('photoDeleteBtn');
const photoModalClose = document.getElementById('photoModalClose');
const photoModalView = document.getElementById('photoModalView');
const photoCropEditor = document.getElementById('photoCropEditor');
const photoCropCanvas = document.getElementById('photoCropCanvas');
const photoCropZoom = document.getElementById('photoCropZoom');
const photoCropCancelBtn = document.getElementById('photoCropCancelBtn');
const photoCropSaveBtn = document.getElementById('photoCropSaveBtn');
const photoCropHint = photoCropEditor?.querySelector('.photoCropHint');
const slideshowModalOverlay = document.getElementById('slideshowModalOverlay');
const slideshowModalClose = document.getElementById('slideshowModalClose');

document.getElementById('settingsEditSlideshow')?.addEventListener('click', () => {
  slideshowModalOverlay?.classList.add('open');
});
slideshowModalClose?.addEventListener('click', () => {
  slideshowModalOverlay?.classList.remove('open');
});
slideshowModalOverlay?.addEventListener('click', (e) => {
  if (e.target === slideshowModalOverlay) slideshowModalOverlay.classList.remove('open');
});

const photoModalReady = !!(photoModalOverlay && photoModalImg && photoModalId &&
  photoModalUploading && photoModalFileInput && photoChangeBtn && photoEditBtn && photoDeleteBtn &&
  photoModalClose && photoModalView && photoCropEditor && photoCropCanvas && photoCropZoom &&
  photoCropCancelBtn && photoCropSaveBtn);

if (!photoModalReady) {
  console.warn('[L&K admin] Photo lightbox elements not found in admin.html.');
}

function openPhotoModal(id) {
  if (!photoModalReady) return;
  const product = products.find(p => p.id === id);
  if (!product) return;
  currentPhotoProductId = id;
  photoModalImg.src = product.image_url;
  photoModalId.textContent = id;
  closePhotoCropEditor();
  photoModalOverlay.classList.add('open');
}

function closePhotoModal() {
  if (!photoModalReady) return;
  photoModalOverlay.classList.remove('open');
  closePhotoCropEditor();
  currentPhotoProductId = null;
}

const photoCropState = {
  image: null,
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  drag: null,
  objectUrl: '',
  loadToken: 0
};

function releasePhotoCropObjectUrl() {
  if (!photoCropState.objectUrl) return;
  URL.revokeObjectURL(photoCropState.objectUrl);
  photoCropState.objectUrl = '';
}

function closePhotoCropEditor() {
  if (!photoModalView || !photoCropEditor) return;
  photoModalView.hidden = false;
  photoCropEditor.hidden = true;
  photoCropState.loadToken += 1;
  photoCropState.image = null;
  photoCropState.drag = null;
  releasePhotoCropObjectUrl();
  if (photoModalFileInput) photoModalFileInput.value = '';
}

function clampPhotoCropOffsets() {
  const image = photoCropState.image;
  if (!image) return;
  const baseScale = Math.max(photoCropCanvas.width / image.naturalWidth, photoCropCanvas.height / image.naturalHeight);
  const scale = baseScale * photoCropState.zoom;
  const maxX = Math.max(0, (image.naturalWidth * scale - photoCropCanvas.width) / 2);
  const maxY = Math.max(0, (image.naturalHeight * scale - photoCropCanvas.height) / 2);
  photoCropState.offsetX = Math.max(-maxX, Math.min(maxX, photoCropState.offsetX));
  photoCropState.offsetY = Math.max(-maxY, Math.min(maxY, photoCropState.offsetY));
}

function drawPhotoCrop() {
  const image = photoCropState.image;
  if (!image) return;
  clampPhotoCropOffsets();
  const context = photoCropCanvas.getContext('2d');
  const baseScale = Math.max(photoCropCanvas.width / image.naturalWidth, photoCropCanvas.height / image.naturalHeight);
  const scale = baseScale * photoCropState.zoom;
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  const x = (photoCropCanvas.width - width) / 2 + photoCropState.offsetX;
  const y = (photoCropCanvas.height - height) / 2 + photoCropState.offsetY;
  context.clearRect(0, 0, photoCropCanvas.width, photoCropCanvas.height);
  context.fillStyle = '#fff';
  context.fillRect(0, 0, photoCropCanvas.width, photoCropCanvas.height);
  context.drawImage(image, x, y, width, height);
}

function openPhotoCropEditor(source, { objectUrl = '' } = {}) {
  if (!photoModalReady || !source) return;
  releasePhotoCropObjectUrl();
  photoCropState.objectUrl = objectUrl;
  photoCropState.image = null;
  photoCropState.zoom = 1;
  photoCropState.offsetX = 0;
  photoCropState.offsetY = 0;
  photoCropZoom.value = '1';
  photoModalView.hidden = true;
  photoCropEditor.hidden = false;
  if (photoCropHint) photoCropHint.textContent = 'Loading photo…';

  const loadToken = ++photoCropState.loadToken;
  const image = new Image();
  if (/^https?:/i.test(source)) image.crossOrigin = 'anonymous';
  image.onload = () => {
    if (loadToken !== photoCropState.loadToken) return;
    photoCropState.image = image;
    if (photoCropHint) photoCropHint.textContent = 'Drag to reposition';
    drawPhotoCrop();
  };
  image.onerror = () => {
    if (loadToken !== photoCropState.loadToken) return;
    closePhotoCropEditor();
    toast('Could not open this photo for cropping', true);
  };
  image.src = source;
}

async function uploadProductPhoto(file) {
  const id = currentPhotoProductId;
  if (!file || !id) return false;
  photoModalUploading.style.display = 'flex';

  const typeExtensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  const fileExtension = file.name?.split('.').pop()?.toLowerCase();
  const ext = fileExtension || typeExtensions[file.type] || 'jpg';
  const path = `${id}-${Date.now()}.${ext}`;
  const uploadOptions = { upsert: true, cacheControl: '3600' };
  if (file.type) uploadOptions.contentType = file.type;

  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, file, uploadOptions);

  if (uploadError) {
    photoModalUploading.style.display = 'none';
    toast('Upload failed: ' + uploadError.message, true);
    return false;
  }

  const { data: publicUrlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  const publicUrl = publicUrlData.publicUrl;
  const { error: updateError } = await supabase.from('products').update({ image_url: publicUrl }).eq('id', id);
  photoModalUploading.style.display = 'none';

  if (updateError) {
    toast('Saved photo but failed to link it: ' + updateError.message, true);
    return false;
  }

  photoModalImg.src = publicUrl;
  const local = products.find(product => product.id === id);
  if (local) local.image_url = publicUrl;
  const cardImg = document.querySelector(`.productRow[data-id="${cssEscape(id)}"] .rowImg img`);
  if (cardImg) cardImg.src = publicUrl;
  toast(`${id} photo updated`);
  return true;
}

if (photoModalReady) {
  photoModalClose.addEventListener('click', closePhotoModal);
  photoModalOverlay.addEventListener('click', (e) => {
    if (e.target === photoModalOverlay) closePhotoModal();
  });

  photoChangeBtn.addEventListener('click', () => {
    if (!currentPhotoProductId) return;
    photoModalFileInput.click();
  });

  photoEditBtn.addEventListener('click', () => {
    if (!currentPhotoProductId || !photoModalImg.src) return;
    openPhotoCropEditor(photoModalImg.src);
  });

  photoModalFileInput.addEventListener('change', () => {
    const file = photoModalFileInput.files[0];
    if (!file || !currentPhotoProductId) return;
    const objectUrl = URL.createObjectURL(file);
    openPhotoCropEditor(objectUrl, { objectUrl });
  });

  photoCropZoom.addEventListener('input', () => {
    photoCropState.zoom = Number(photoCropZoom.value) || 1;
    drawPhotoCrop();
  });

  photoCropCanvas.addEventListener('pointerdown', event => {
    if (!photoCropState.image) return;
    photoCropCanvas.setPointerCapture(event.pointerId);
    photoCropState.drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: photoCropState.offsetX,
      offsetY: photoCropState.offsetY
    };
  });

  photoCropCanvas.addEventListener('pointermove', event => {
    const drag = photoCropState.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const rect = photoCropCanvas.getBoundingClientRect();
    const ratio = photoCropCanvas.width / rect.width;
    photoCropState.offsetX = drag.offsetX + (event.clientX - drag.startX) * ratio;
    photoCropState.offsetY = drag.offsetY + (event.clientY - drag.startY) * ratio;
    drawPhotoCrop();
  });

  const stopPhotoCropDrag = event => {
    if (photoCropState.drag?.pointerId === event.pointerId) photoCropState.drag = null;
  };
  photoCropCanvas.addEventListener('pointerup', stopPhotoCropDrag);
  photoCropCanvas.addEventListener('pointercancel', stopPhotoCropDrag);

  photoCropCancelBtn.addEventListener('click', closePhotoCropEditor);
  photoCropSaveBtn.addEventListener('click', async () => {
    if (!photoCropState.image || !currentPhotoProductId) return;
    photoCropSaveBtn.disabled = true;
    photoCropSaveBtn.textContent = 'Saving…';
    try {
      const croppedBlob = await new Promise((resolve, reject) => {
        try {
          photoCropCanvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('The crop could not be created.')), 'image/jpeg', 0.9);
        } catch (error) {
          reject(error);
        }
      });
      closePhotoCropEditor();
      await uploadProductPhoto(croppedBlob);
    } catch (error) {
      toast('Could not save crop. Try choosing the photo again.', true);
    } finally {
      photoCropSaveBtn.disabled = false;
      photoCropSaveBtn.textContent = 'Save Crop';
    }
  });

  photoDeleteBtn.addEventListener('click', async () => {
    const id = currentPhotoProductId;
    if (!id) return;
    if (!confirm(`Remove the photo for ${id}? It will show a placeholder until you upload a new one.`)) return;

    const { error } = await supabase.from('products').update({ image_url: PLACEHOLDER_IMAGE }).eq('id', id);
    if (error) {
      toast('Could not delete photo: ' + error.message, true);
      return;
    }

    const local = products.find(p => p.id === id);
    if (local) local.image_url = PLACEHOLDER_IMAGE;

    photoModalImg.src = PLACEHOLDER_IMAGE;
    const cardImg = document.querySelector(`.productRow[data-id="${cssEscape(id)}"] .rowImg img`);
    if (cardImg) cardImg.src = PLACEHOLDER_IMAGE;

    toast(`${id} photo removed`);
  });
}

/* ---------- visible menu filters ---------- */
const menuFilterBtn = document.getElementById('menuFilterBtn');
const filterPopover = document.getElementById('filterPopover');
const filterBestsellerBtn = document.getElementById('filterBestseller');
const filterOutOfStockBtn = document.getElementById('filterOutOfStock');
const clearFiltersBtn = document.getElementById('clearFiltersBtn');

function setFilterPopoverOpen(open) {
  filterPopover?.classList.toggle('open', open);
  menuFilterBtn?.classList.toggle('active', open);
  menuFilterBtn?.setAttribute('aria-expanded', String(open));
}

function refreshFilterControls() {
  filterBestsellerBtn?.classList.toggle('active', filterBestseller);
  filterBestsellerBtn?.setAttribute('aria-pressed', String(filterBestseller));
  filterOutOfStockBtn?.classList.toggle('active', filterOutOfStock);
  filterOutOfStockBtn?.setAttribute('aria-pressed', String(filterOutOfStock));
  menuFilterBtn?.classList.toggle('hasFilters', filterBestseller || filterOutOfStock);
  if (clearFiltersBtn) clearFiltersBtn.hidden = !filterBestseller && !filterOutOfStock;
}

function applyVisibleFilters() {
  refreshFilterControls();
  render();
  setFilterPopoverOpen(false);
}

menuFilterBtn?.addEventListener('click', event => {
  event.stopPropagation();
  setFilterPopoverOpen(!filterPopover?.classList.contains('open'));
});

document.addEventListener('click', event => {
  if (!filterPopover?.classList.contains('open')) return;
  if (!filterPopover.contains(event.target) && event.target !== menuFilterBtn) setFilterPopoverOpen(false);
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') setFilterPopoverOpen(false);
});

filterBestsellerBtn?.addEventListener('click', () => {
  const willEnable = !filterBestseller;
  filterBestseller = willEnable;
  if (willEnable) filterOutOfStock = false;
  applyVisibleFilters();
});

filterOutOfStockBtn?.addEventListener('click', () => {
  const willEnable = !filterOutOfStock;
  filterOutOfStock = willEnable;
  if (willEnable) filterBestseller = false;
  applyVisibleFilters();
});

clearFiltersBtn?.addEventListener('click', () => {
  filterBestseller = false;
  filterOutOfStock = false;
  applyVisibleFilters();
});


/* ---------- filters ---------- */
const adminSearchEl = document.getElementById('adminSearch');
const clearSearchBtn = document.getElementById('clearSearch');

adminSearchEl?.addEventListener('input', (e) => {
  searchQuery = e.target.value;
  clearSearchBtn?.classList.toggle('show', searchQuery.length > 0);
  render();
});

clearSearchBtn?.addEventListener('click', () => {
  adminSearchEl.value = '';
  searchQuery = '';
  clearSearchBtn.classList.remove('show');
  render();
  adminSearchEl.focus();
});

document.getElementById('catFilter')?.addEventListener('click', event => {
  const button = event.target.closest('.catBtn');
  if (!button) return;
  activeCategory = button.dataset.cat;
  document.querySelectorAll('.catBtn').forEach(categoryButton => {
    categoryButton.classList.toggle('active', categoryButton === button);
  });
  render();
});

/* ---------- create category ---------- */
const categoryForm = document.getElementById('categoryForm');
const newCategoryId = document.getElementById('newCategoryId');
const newCategoryName = document.getElementById('newCategoryName');
const saveCategoryBtn = document.getElementById('saveCategoryBtn');
const categoryManagerList = document.getElementById('categoryManagerList');
const categoryModalOverlay = document.getElementById('categoryModalOverlay');
const categoryModalClose = document.getElementById('categoryModalClose');
const cancelCategoryModal = document.getElementById('cancelCategoryModal');

function openCategoryModal() {
  if (!categoryModalOverlay) return;
  categoryModalOverlay.classList.add('open');
  categoryModalOverlay.setAttribute('aria-hidden', 'false');
  window.setTimeout(() => newCategoryName?.focus(), 120);
}

function closeCategoryModal({ reset = false } = {}) {
  if (!categoryModalOverlay) return;
  categoryModalOverlay.classList.remove('open');
  categoryModalOverlay.setAttribute('aria-hidden', 'true');
  if (reset) categoryForm?.reset();
}

categoryModalClose?.addEventListener('click', () => closeCategoryModal());
cancelCategoryModal?.addEventListener('click', () => closeCategoryModal());
categoryModalOverlay?.addEventListener('click', event => {
  if (event.target === categoryModalOverlay) closeCategoryModal();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && categoryModalOverlay?.classList.contains('open')) closeCategoryModal();
});

function slugifyCategory(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

function createUniqueCategorySlug(title) {
  const base = slugifyCategory(title) || `category-${Date.now().toString(36)}`;
  let slug = base;
  let suffix = 2;
  while (categories.some(category => category.slug === slug)) {
    slug = `${base.slice(0, Math.max(1, 32 - String(suffix).length - 1))}-${suffix}`;
    suffix += 1;
  }
  return slug;
}

const CATEGORY_ID_PREFIX = 'LK-';

function normalizeCategoryId(value) {
  const suffix = String(value || '')
    .trim()
    .replace(/^LK[\s-]*/i, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .toUpperCase();
  return suffix ? `${CATEGORY_ID_PREFIX}${suffix}` : '';
}

function seedCategoryIdPrefix() {
  if (!newCategoryId || newCategoryId.value.trim()) return;
  newCategoryId.value = CATEGORY_ID_PREFIX;
  newCategoryId.setSelectionRange(CATEGORY_ID_PREFIX.length, CATEGORY_ID_PREFIX.length);
}

newCategoryId?.addEventListener('focus', seedCategoryIdPrefix);
newCategoryId?.addEventListener('click', seedCategoryIdPrefix);

function isDefaultCategory(slug) {
  return DEFAULT_CATEGORIES.some(category => category.slug === slug);
}

async function persistCategories() {
  return supabase.from('site_settings').upsert({
    key: CATEGORY_SETTING_KEY,
    value: JSON.stringify(categories)
  }, { onConflict: 'key' });
}

function renderCategoryManager() {
  if (!categoryManagerList) return;
  const visibleCategory = categories.find(category => category.slug === activeCategory);
  if (!visibleCategory) {
    categoryManagerList.hidden = true;
    categoryManagerList.innerHTML = '';
    return;
  }

  categoryManagerList.hidden = false;
  categoryManagerList.innerHTML = [visibleCategory].map(category => {
    const isDefault = isDefaultCategory(category.slug);
    return `
      <div class="categoryManagerRow" data-category-slug="${escapeAttr(category.slug)}">
        <label class="categoryManagerField">
          <span class="categoryManagerId">ID: <strong>${escapeHTML(category.id || 'Not set')}</strong></span>
          <input type="text" data-category-field="title" value="${escapeAttr(category.customerLabel || category.name)}" maxlength="60" aria-label="Category title for ${escapeAttr(category.customerLabel || category.name)}">
        </label>
        <div class="categoryManagerActions">
          <button type="button" class="categoryManagerBtn save" data-category-action="save">Save</button>
          <button type="button" class="categoryManagerBtn${category.hidden ? ' isHidden' : ''}" data-category-action="toggle">
            ${category.hidden ? 'Show' : 'Hide'}
          </button>
          ${isDefault ? '' : `<button type="button" class="categoryManagerBtn delete" data-category-action="delete" aria-label="Delete ${escapeAttr(category.customerLabel || category.name)}" title="Delete category">${TRASH_ICON}</button>`}
        </div>
      </div>`;
  }).join('');
}

categoryManagerList?.addEventListener('click', async event => {
  const button = event.target.closest('[data-category-action]');
  const row = button?.closest('[data-category-slug]');
  const slug = row?.dataset.categorySlug;
  const category = categories.find(item => item.slug === slug);
  if (!button || !category) return;

  const action = button.dataset.categoryAction;
  if (action === 'delete' && isDefaultCategory(slug)) return;
  const previousCategories = categories.map(item => ({ ...item }));

  if (action === 'save') {
    const title = row.querySelector('[data-category-field="title"]')?.value.trim();
    if (!title) {
      toast('Enter a category title', true);
      return;
    }
    category.name = title;
    category.customerLabel = title;
  } else if (action === 'delete') {
    const productCount = products.filter(product => product.category === slug).length;
    if (productCount > 0) {
      toast(`Move or delete the ${productCount} product${productCount === 1 ? '' : 's'} in ${category.name} first`, true);
      return;
    }
    if (!confirm(`Delete the ${category.name} category?`)) return;
    categories = categories.filter(item => item.slug !== slug);
    if (activeCategory === slug) activeCategory = 'all';
  } else if (action === 'toggle') {
    category.hidden = !category.hidden;
  } else {
    return;
  }

  button.disabled = true;
  const { error } = await persistCategories();
  if (error) {
    categories = previousCategories;
    toast(`Could not ${action === 'delete' ? 'delete' : 'save'} category: ${error.message}`, true);
  } else {
    toast(action === 'delete'
      ? `${category.name} category deleted`
      : action === 'save'
        ? `${category.name} titles saved`
        : `${category.name} is now ${category.hidden ? 'hidden' : 'visible'}`);
  }
  renderCategoryControls();
  updateCategoryCounts();
  render();
});

categoryForm?.addEventListener('submit', async event => {
  event.preventDefault();
  const categoryId = normalizeCategoryId(newCategoryId?.value);
  const name = newCategoryName.value.trim();
  if (!categoryId) {
    toast('Enter the characters after LK-', true);
    return;
  }
  if (!name) {
    toast('Enter a category title', true);
    return;
  }
  if (categories.some(category => (category.customerLabel || category.name).toLocaleLowerCase() === name.toLocaleLowerCase())) {
    toast('That category title already exists', true);
    return;
  }
  if (categories.some(category => String(category.id || '').toLocaleUpperCase() === categoryId.toLocaleUpperCase())) {
    toast(`${categoryId} already exists`, true);
    return;
  }
  const slug = createUniqueCategorySlug(name);

  const previousCategories = categories.map(category => ({ ...category }));
  categories.push({ slug, id: categoryId, name, customerLabel: name, hidden: false });
  if (saveCategoryBtn) {
    saveCategoryBtn.disabled = true;
    saveCategoryBtn.textContent = 'Creating…';
  }

  const { error } = await persistCategories();

  if (saveCategoryBtn) {
    saveCategoryBtn.disabled = false;
    saveCategoryBtn.textContent = 'Create Category';
  }
  if (error) {
    categories = previousCategories;
    toast('Could not create category: ' + error.message, true);
    return;
  }

  activeCategory = slug;
  renderCategoryControls();
  const productCategorySelect = document.getElementById('newCategory');
  if (productCategorySelect) {
    productCategorySelect.value = slug;
    syncNewProductIdFromCategory({ force: true });
  }
  updateCategoryCounts();
  render();
  categoryForm.reset();
  closeCategoryModal();
  switchPage('menu');
  toast(`${name} category created`);
});

/* ---------- add product ---------- */
const addModalOverlay = document.getElementById('addModalOverlay');
const newProductIdInput = document.getElementById('newId');
const newProductCategorySelect = document.getElementById('newCategory');
let lastAutoFilledProductId = '';

function syncNewProductIdFromCategory({ force = false } = {}) {
  if (!newProductIdInput || !newProductCategorySelect) return;
  const category = categories.find(item => item.slug === newProductCategorySelect.value);
  const categoryId = String(category?.id || '').trim().toUpperCase();
  const currentId = newProductIdInput.value.trim();
  if (!force && currentId && currentId !== lastAutoFilledProductId) return;

  newProductIdInput.value = categoryId;
  lastAutoFilledProductId = categoryId;
  if (categoryId) {
    newProductIdInput.setSelectionRange(categoryId.length, categoryId.length);
  }
}

function openAddProductModal() {
  addModalOverlay.classList.add('open');
  syncNewProductIdFromCategory();
}

newProductCategorySelect?.addEventListener('change', () => syncNewProductIdFromCategory({ force: true }));
document.getElementById('addProductBtn').addEventListener('click', openAddProductModal);
document.getElementById('cancelAdd').addEventListener('click', () => addModalOverlay.classList.remove('open'));
addModalOverlay.addEventListener('click', (e) => { if (e.target === addModalOverlay) addModalOverlay.classList.remove('open'); });

document.getElementById('addForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('newId').value.trim();
  const category = document.getElementById('newCategory').value;
  const name = document.getElementById('newName').value.trim();
  const priceRaw = document.getElementById('newPrice').value.trim();
  const price = priceRaw ? '$' + priceRaw.replace(/^\$/, '') : '';
  const is_bestseller = document.getElementById('newBestseller').checked;

  if (!id || !name) return;

  const numMatch = id.match(/(\d+)\s*$/);
  const sort_order = numMatch
    ? parseInt(numMatch[1], 10)
    : products.filter(p => p.category === category).length + 1;

  const { error } = await supabase.from('products').insert({
    id, category, name, price, is_bestseller, sort_order,
    image_url: PLACEHOLDER_IMAGE
  });

  if (error) {
    toast('Could not create product: ' + error.message, true);
    return;
  }

  toast(`${id} created — now upload its photo`);
  addModalOverlay.classList.remove('open');
  document.getElementById('addForm').reset();
  loadProducts();
});

checkSession();
