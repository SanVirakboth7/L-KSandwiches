import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabase-config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ---------- admin access from the customer logo ---------- */
const adminLogoTrigger = document.getElementById('adminLogoTrigger');
const adminLoginOverlay = document.getElementById('adminLoginOverlay');
const adminLoginClose = document.getElementById('adminLoginClose');
const customerAdminLoginForm = document.getElementById('customerAdminLoginForm');
const customerAdminEmail = document.getElementById('customerAdminEmail');
const customerAdminPassword = document.getElementById('customerAdminPassword');
const customerAdminPasswordToggle = document.getElementById('customerAdminPasswordToggle');
const customerAdminLoginSubmit = document.getElementById('customerAdminLoginSubmit');
const customerAdminLoginLabel = document.getElementById('customerAdminLoginLabel');
const customerAdminLoginError = document.getElementById('customerAdminLoginError');
const adminPortal = document.getElementById('adminPortal');
const adminPortalFrame = document.getElementById('adminPortalFrame');

function syncAdminLayerBody() {
  const hasOpenLayer = adminLoginOverlay?.classList.contains('open') || adminPortal?.classList.contains('open');
  document.body.classList.toggle('adminLayerOpen', Boolean(hasOpenLayer));
}

function setAdminLoginOpen(open) {
  if (!adminLoginOverlay) return;
  adminLoginOverlay.classList.toggle('open', open);
  adminLoginOverlay.setAttribute('aria-hidden', String(!open));
  if (!open) {
    if (customerAdminLoginError) customerAdminLoginError.textContent = '';
    if (customerAdminPassword) customerAdminPassword.value = '';
  }
  syncAdminLayerBody();
  if (open) window.setTimeout(() => customerAdminEmail?.focus(), 180);
}

function setAdminPortalOpen(open, refreshFrame = false) {
  if (!adminPortal || !adminPortalFrame) return;

  if (open) {
    const frameSource = adminPortalFrame.dataset.src || 'admin.html';
    if (!adminPortalFrame.getAttribute('src')) {
      adminPortalFrame.setAttribute('src', frameSource);
    } else if (refreshFrame) {
      adminPortalFrame.setAttribute('src', frameSource);
    }
  }

  adminPortal.classList.toggle('open', open);
  adminPortal.setAttribute('aria-hidden', String(!open));
  syncAdminLayerBody();
  if (!open) adminLogoTrigger?.focus();
}

async function openAdminAccess() {
  if (customerAdminLoginError) customerAdminLoginError.textContent = '';
  const { data: { session }, error } = await supabase.auth.getSession();

  if (!error && session) {
    setAdminPortalOpen(true);
    return;
  }

  setAdminLoginOpen(true);
}

adminLogoTrigger?.addEventListener('click', openAdminAccess);
adminLoginClose?.addEventListener('click', () => setAdminLoginOpen(false));
adminLoginOverlay?.addEventListener('click', (event) => {
  if (event.target === adminLoginOverlay) setAdminLoginOpen(false);
});

customerAdminPasswordToggle?.addEventListener('click', () => {
  if (!customerAdminPassword) return;
  const willShow = customerAdminPassword.type === 'password';
  customerAdminPassword.type = willShow ? 'text' : 'password';
  customerAdminPasswordToggle.textContent = willShow ? 'Hide' : 'Show';
  customerAdminPasswordToggle.setAttribute('aria-label', willShow ? 'Hide password' : 'Show password');
});

customerAdminLoginForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!customerAdminEmail || !customerAdminPassword) return;

  if (customerAdminLoginError) customerAdminLoginError.textContent = '';
  if (customerAdminLoginSubmit) customerAdminLoginSubmit.disabled = true;
  if (customerAdminLoginLabel) customerAdminLoginLabel.textContent = 'Signing in…';

  const { error } = await supabase.auth.signInWithPassword({
    email: customerAdminEmail.value.trim(),
    password: customerAdminPassword.value
  });

  if (customerAdminLoginSubmit) customerAdminLoginSubmit.disabled = false;
  if (customerAdminLoginLabel) customerAdminLoginLabel.textContent = 'Open Admin';

  if (error) {
    if (customerAdminLoginError) {
      customerAdminLoginError.textContent = error.message || 'Could not sign in. Check your email and password.';
    }
    return;
  }

  setAdminLoginOpen(false);
  setAdminPortalOpen(true, true);
});

async function refreshCustomerSiteAfterAdmin() {
  const results = await Promise.allSettled([
    loadProducts(),
    loadHeroImages()
  ]);

  results.forEach(result => {
    if (result.status === 'rejected') {
      console.warn('[L&K] Could not refresh customer data after leaving admin:', result.reason);
    }
  });
}

window.addEventListener('message', async (event) => {
  if (event.origin !== window.location.origin) return;
  if (event.data?.type === 'lk-admin-exit' || event.data?.type === 'lk-admin-signed-out') {
    setAdminPortalOpen(false);
    await refreshCustomerSiteAfterAdmin();
  }
});

window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (adminLoginOverlay?.classList.contains('open')) setAdminLoginOpen(false);
  else if (adminPortal?.classList.contains('open')) setAdminPortalOpen(false);
});

supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') setAdminPortalOpen(false);
});

/* ---------- category -> DOM ids ---------- */
const CATEGORY_MAP = {
  bestseller: { gridId: "grid-bestseller" },
  sandwich:   { gridId: "grid-sandwich" },
  rice:       { gridId: "grid-rice" },
  dessert:    { gridId: "grid-dessert" },
  drink:      { gridId: "grid-drinks" }
};
const CATEGORY_SETTING_KEY = 'menu_categories';
const DEFAULT_CATEGORIES = [
  { slug: 'sandwich', name: 'Sandwich', customerLabel: 'សាំងវិច' },
  { slug: 'rice', name: 'Rice', customerLabel: 'បាយ' },
  { slug: 'dessert', name: 'Dessert', customerLabel: 'បង្អែម' },
  { slug: 'drink', name: 'Drink', customerLabel: 'ភេសជ្ជៈ' }
];

const TELEGRAM_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/clever-processor`;
// Temporary pause: set this back to true when Telegram order delivery should resume.
const TELEGRAM_ORDER_SENDING_ENABLED = false;
const PAYWAY_PENDING_KEY = 'lk_payway_pending';
const ORDER_RECORD_PENDING_KEY = 'lk_pending_order_records';

let allProducts = [];
let menuCategories = DEFAULT_CATEGORIES.map(category => ({ ...category }));
let sectionObserver = null;

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
let pendingReceiptImage = null;
let verifiedPayWayTransactionId = '';

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
    orderType    : document.getElementById('orderTypeToggle')?.dataset.selected || '',
    paymentMethod: document.getElementById('paymentMethodToggle')?.dataset.selected || '',
    name         : document.getElementById('custName')?.value.trim() || '',
    phone        : document.getElementById('custPhone')?.value.trim() || '',
    address      : document.getElementById('custAddress')?.value.trim() || '',
    locationUrl  : selectedDeliveryLocationUrl || '',
    date         : document.getElementById('custDate')?.value || '',
    time         : document.getElementById('custTime')?.value || ''
  };
}
function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
}
function formatTime(t) {
  if (!t) return '';
  return t;
}
function paymentMethodLabel(method) {
  if (method === 'aba') return 'ABA PayWay';
  if (method === 'cash') return 'Cash on Delivery';
  return '—';
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
   Grid cards stay compact: "+" becomes a cart icon after the first add.
   The product detail modal is the only product view that shows the
   −/qty/+ quantity stepper. */
function addControlHTML(p, { showQuantity = false } = {}) {
  if (p.is_out_of_stock) {
    return `<p class="outOfStockText">Unavailable</p>`;
  }
  const qty = cart[p.id] || 0;
  if (qty > 0 && showQuantity) {
    return `
      <div class="stepper" data-id="${p.id}">
        <button type="button" class="stepBtn minus" data-action="dec" aria-label="Remove one">−</button>
        <span class="stepQty">${qty}</span>
        <button type="button" class="stepBtn plus" data-action="inc" aria-label="Add one">+</button>
      </div>`;
  }
  if (qty > 0) {
    return `
      <button type="button" class="cartAddedBtn" data-id="${p.id}" aria-label="View basket">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="20" r="1"/><circle cx="19" cy="20" r="1"/><path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 2-1.6L21 8H6"/></svg>
      </button>`;
  }
  return `
    <button type="button" class="addBtn" data-id="${p.id}" aria-label="Add to basket">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
    </button>`;
}

function refreshCardControl(id) {
  const product = allProducts.find(p => p.id === id);
  if (!product) return;
  document.querySelectorAll(`.addWrap[data-add-id="${id}"]`).forEach(wrap => {
    wrap.innerHTML = addControlHTML(product, {
      showQuantity: wrap.classList.contains('modalAddWrap')
    });
  });
}

function addToCart(id) {
  cart[id] = (cart[id] || 0) + 1;
  saveCart();
  refreshCardControl(id);
  updateCartBar();
  if (document.getElementById('cartPage')?.classList.contains('open')) renderCartModal();
}
function decFromCart(id) {
  if (!cart[id]) return;
  cart[id] -= 1;
  if (cart[id] <= 0) delete cart[id];
  saveCart();
  refreshCardControl(id);
  updateCartBar();
  if (document.getElementById('cartPage')?.classList.contains('open')) renderCartModal();
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

const KHR_PER_USD = 4000; // approximate exchange rate; adjust as needed

function formatRiel(usdAmount) {
  const riel = Math.round(usdAmount * KHR_PER_USD);
  return riel.toLocaleString('en-US') + ' ៛';
}

function updateCartBar() {
  const bar = document.getElementById('cartBar');
  if (!bar) return;
  const entries = cartEntries();
  const count = entries.reduce((s, [, q]) => s + q, 0);
  bar.style.display = count > 0 ? 'flex' : 'none';

  const countEl = document.getElementById('cartCount');
  const totalEl = document.getElementById('cartBarTotal');
  const rielEl = document.getElementById('cartBarRiel');

  const total = cartTotal();
  if (countEl) countEl.textContent = String(count);
  if (totalEl) totalEl.textContent = total.toFixed(2);
  if (rielEl) rielEl.textContent = formatRiel(total);
}

function buildQuoteText() {
  const entries = cartEntries();
  const { orderType, paymentMethod, name, phone, address, date, time } = getCustomerFields();
  const total = cartTotal();

  const divider = "────────────────";
  let text = "🧾News Order\n\n";
  text += `Order Type: ${orderType ? (orderType === 'delivery' ? 'Delivery' : 'Pickup') : '—'}\n`;
  text += `Name: ${name || '—'}\n`;
  text += `Phone Number: ${phone || '—'}\n`;
  if (orderType === 'delivery') {
    text += `Address: ${address || ''}\n`;
  }
  text += `Date: ${date ? formatDate(date) : '—'}\n`;
  text += `Time: ${time ? formatTime(time) : '—'}\n`;
  text += `Payment Method: ${paymentMethodLabel(paymentMethod)}\n`;
  if (verifiedPayWayTransactionId) text += `ABA Transaction: ${verifiedPayWayTransactionId}\n`;
  text += `${divider}\n`;
  text += `Items\n\n`;
  entries.forEach(([id, qty], i) => {
    const p = allProducts.find(pp => pp.id === id);
    if (!p) return;
    const line = priceNum(p) * qty;
    text += `${i + 1}. ${p.name} x${qty} — $${line.toFixed(2)}\n`;
  });
  text += `${divider}\n`;
  text += `Total : $${total.toFixed(2)}`;

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
          <div class="cartItemTop">
            <img src="${escapeAttr(p.image_url)}" alt="${escapeAttr(p.name)}">
            <div class="cartItemInfo">
              <p class="cartItemName">${escapeHTML(p.name)}</p>
              <p class="cartItemId">ID: ${p.id}</p>
              <p class="cartItemLineTotal">$${lineTotal}</p>
            </div>
            <div class="stepper" data-id="${id}">
              <button class="stepBtn minus" data-action="dec" aria-label="Remove one">−</button>
              <span class="stepQty">${qty}</span>
              <button class="stepBtn plus" data-action="inc" aria-label="Add one">+</button>
            </div>
          </div>
        </div>`;
    }).join('');
  }

  const subtotal = cartTotal();
  const subtotalEl = document.getElementById('cpSubtotal');
  const totalEl = document.getElementById('cartModalTotal');
  const totalRielEl = document.getElementById('cartModalRiel');
  if (subtotalEl) subtotalEl.textContent = '$' + subtotal.toFixed(2);
  if (totalEl) totalEl.textContent = '$' + subtotal.toFixed(2);
  if (totalRielEl) totalRielEl.textContent = formatRiel(subtotal);

  updateSendButtonState();
}

/* ---------- send order directly via Supabase Edge Function ----------*/
function updateSendButtonState() {
  const sendBtn = document.getElementById('sendOrderBtn');
  if (!sendBtn) return;
  const { orderType, paymentMethod, name, phone, address, locationUrl, date } = getCustomerFields();
  const items = cartEntries();
  const addressOk = orderType === 'delivery' ? !!(address || locationUrl) : true;
  const complete = items.length > 0 && orderType && paymentMethod && name && phone && addressOk && date;
  sendBtn.disabled = !complete;
}

/* Builds a readable receipt-style HTML summary for the confirm modal,
   as an alternative to the plain-text quote used for the Telegram
   message itself (buildQuoteText handles that one). */
function buildConfirmSummaryHTML() {
  const entries = cartEntries();
  const { orderType, paymentMethod, name, phone, address, date, time } = getCustomerFields();

  const itemsHTML = entries.map(([id, qty]) => {
    const p = allProducts.find(pp => pp.id === id);
    if (!p) return '';
    const lineTotal = (priceNum(p) * qty).toFixed(2);
    return `
      <div class="confirmItemRow">
        <span class="confirmItemQty">${qty}×</span>
        <span class="confirmItemName">${escapeHTML(p.name)}</span>
        <span class="confirmItemPrice">$${lineTotal}</span>
      </div>`;
  }).join('');

  const addressRow = orderType === 'delivery'
    ? `<div class="confirmDetailRow"><span>Address</span><span>${address ? escapeHTML(address) : ''}</span></div>`
    : '';

  return `
    <div class="confirmDetailRow"><span>Order Type</span><span>${orderType ? (orderType === 'delivery' ? 'Delivery' : 'Pickup') : '—'}</span></div>
    <div class="confirmDetailRow"><span>Name</span><span>${escapeHTML(name || '—')}</span></div>
    <div class="confirmDetailRow"><span>Phone</span><span>${escapeHTML(phone || '—')}</span></div>
    ${addressRow}
    <div class="confirmDetailRow"><span>Date</span><span>${date ? escapeHTML(formatDate(date)) : '—'}</span></div>
    <div class="confirmDetailRow"><span>Time</span><span>${time ? escapeHTML(formatTime(time)) : '—'}</span></div>
    <div class="confirmDetailRow"><span>Payment Method</span><span>${paymentMethodLabel(paymentMethod)}</span></div>
    ${verifiedPayWayTransactionId ? `<div class="confirmDetailRow"><span>ABA Transaction</span><span>${escapeHTML(verifiedPayWayTransactionId)}</span></div>` : ''}
    <div class="confirmDivider"></div>
    ${itemsHTML}
    <div class="confirmDivider"></div>
    <div class="confirmDetailRow confirmTotalRow"><span>Total</span><span>$${cartTotal().toFixed(2)}</span></div>
  `;
}

function buildReceiptHTML() {
  const entries = cartEntries();
  const { orderType, paymentMethod, name, phone, address, date, time } = getCustomerFields();
  const total = cartTotal();

  const itemsHTML = entries.map(([id, qty]) => {
    const p = allProducts.find(pp => pp.id === id);
    if (!p) return '';
    const lineTotal = (priceNum(p) * qty).toFixed(2);
    return `
      <div class="receiptItemRow">
        <span class="riQty">${qty}×</span>
        <span class="riName">${escapeHTML(p.name)}</span>
        <span class="riPrice">$${lineTotal}</span>
      </div>`;
  }).join('');

  const addressRow = orderType === 'delivery'
    ? `<div class="receiptRow"><span>Address</span><span>${address ? escapeHTML(address) : ''}</span></div>`
    : '';

  return `
    <div class="receiptHead">
      <div class="rShopName">L&K Sandwiches</div>
      <div class="rTagline">ធានាគុណភាព · អនាម័យ · តម្លៃ</div>
    </div>
    <div class="receiptBody">
      <div class="receiptRow"><span>Order Type</span><span>${orderType ? (orderType === 'delivery' ? 'Delivery' : 'Pickup') : '—'}</span></div>
      <div class="receiptRow"><span>Name</span><span>${escapeHTML(name || '—')}</span></div>
      <div class="receiptRow"><span>Phone</span><span>${escapeHTML(phone || '—')}</span></div>
      ${addressRow}
      <div class="receiptRow"><span>Date</span><span>${date ? escapeHTML(formatDate(date)) : '—'}</span></div>
      <div class="receiptRow"><span>Time</span><span>${time ? escapeHTML(formatTime(time)) : '—'}</span></div>
      <div class="receiptRow"><span>Payment Method</span><span>${paymentMethodLabel(paymentMethod)}</span></div>
      ${verifiedPayWayTransactionId ? `<div class="receiptRow"><span>ABA Transaction</span><span>${escapeHTML(verifiedPayWayTransactionId)}</span></div>` : ''}
      <div class="receiptDivider"></div>
      <div class="receiptItemsTitle">Order Items</div>
      ${itemsHTML}
      <div class="receiptDivider"></div>
      <div class="receiptTotalRow"><span>Total</span><span class="rTotalUsd">$${total.toFixed(2)}</span></div>
      <div class="receiptSubTotal">≈ ${formatRiel(total)}</div>
    </div>
    <div class="receiptFooter">Thank you for your order! </div>
  `;
}

async function generateReceiptImageBase64() {
  const template = document.getElementById('receiptTemplate');
  if (!template || typeof html2canvas === 'undefined') return null;

  template.innerHTML = buildReceiptHTML();

  const canvas = await html2canvas(template, {
    backgroundColor: null,
    scale: 2 // sharper image for Telegram
  });

  // Strip the "data:image/png;base64," prefix — the edge function decodes
  // the raw base64 itself when building the multipart request to Telegram.
  return canvas.toDataURL('image/png').split(',')[1];
}

/* Opens the confirmation modal instead of sending right away, so the
   customer gets one last look at their order before it goes out. */
function openConfirmModal() {
  const sendBtn = document.getElementById('sendOrderBtn');
  if (!sendBtn || sendBtn.disabled) return;

  const confirmSendBtn = document.getElementById('confirmSendBtn');
  if (confirmSendBtn) {
    confirmSendBtn.textContent = getCustomerFields().paymentMethod === 'aba'
      ? 'Pay with ABA'
      : 'Confirm Order';
  }

  const summaryEl = document.getElementById('confirmSummary');
  if (summaryEl) summaryEl.innerHTML = buildConfirmSummaryHTML();

  document.getElementById('confirmOverlay')?.classList.add('open');

  pendingReceiptImage = null;
  if (!TELEGRAM_ORDER_SENDING_ENABLED) return;
  const caption = `🧾 New Order`;

  generateReceiptImageBase64()
    .then(base64 => {
      pendingReceiptImage = base64 ? { base64, caption } : null;
    })
    .catch(err => {
      console.warn('[L&K] Background receipt generation failed:', err);
      pendingReceiptImage = null;
    });
}

function closeConfirmModal() {
  document.getElementById('confirmOverlay')?.classList.remove('open');
  pendingReceiptImage = null;
}

function openOrderSuccessModal() {
  const overlay = document.getElementById('orderSuccessOverlay');
  overlay?.classList.add('open');
  overlay?.setAttribute('aria-hidden', 'false');
  window.setTimeout(() => document.getElementById('orderSuccessDoneBtn')?.focus(), 120);
}

function closeOrderSuccessModal() {
  const overlay = document.getElementById('orderSuccessOverlay');
  overlay?.classList.remove('open');
  overlay?.setAttribute('aria-hidden', 'true');
}

function showPayWayStatus(message, type = 'info') {
  let status = document.getElementById('paywayStatus');
  if (!status) {
    status = document.createElement('div');
    status.id = 'paywayStatus';
    status.className = 'paywayStatus';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    document.body.appendChild(status);
  }
  status.className = `paywayStatus show ${type}`;
  status.textContent = message;
}

function clearPayWayReturnParams() {
  const url = new URL(window.location.href);
  url.searchParams.delete('payway');
  url.searchParams.delete('tran_id');
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

function buildPayWayOrderPayload() {
  const { orderType, name, phone, address, locationUrl, date, time } = getCustomerFields();
  return {
    orderType,
    customer: { name, phone, address: address || locationUrl },
    schedule: { date, time },
    items: cartEntries().map(([id, quantity]) => ({ id, quantity }))
  };
}

async function startPayWayCheckout() {
  const sendBtn = document.getElementById('sendOrderBtn');
  const confirmSendBtn = document.getElementById('confirmSendBtn');
  const originalLabel = sendBtn?.textContent || 'Send Order';
  const originalConfirmLabel = confirmSendBtn?.textContent || 'Pay with ABA';

  if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = 'Opening ABA…'; }
  if (confirmSendBtn) { confirmSendBtn.disabled = true; confirmSendBtn.textContent = 'Opening ABA…'; }

  try {
    if (!storageAvailable) throw new Error('Browser storage is required to safely complete an ABA payment.');
    const response = await fetch('/api/payway/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPayWayOrderPayload())
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not start ABA PayWay.');

    localStorage.setItem(PAYWAY_PENDING_KEY, JSON.stringify({
      tranId: result.tranId,
      amount: Number(result.amount),
      createdAt: Date.now()
    }));

    const form = document.createElement('form');
    form.method = 'POST';
    form.action = result.gatewayUrl;
    form.style.display = 'none';
    Object.entries(result.fields || {}).forEach(([name, value]) => {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      input.value = String(value ?? '');
      form.appendChild(input);
    });
    document.body.appendChild(form);
    form.submit();
  } catch (error) {
    console.error('[L&K] Could not start PayWay:', error);
    alert(error instanceof Error ? error.message : 'Could not start ABA PayWay.');
    if (sendBtn) { sendBtn.textContent = originalLabel; sendBtn.disabled = false; }
    if (confirmSendBtn) { confirmSendBtn.textContent = originalConfirmLabel; confirmSendBtn.disabled = false; }
  }
}

async function handlePayWayReturn() {
  const params = new URLSearchParams(window.location.search);
  const returnState = params.get('payway');
  if (!returnState) return;

  if (returnState === 'cancelled') {
    localStorage.removeItem(PAYWAY_PENDING_KEY);
    showPayWayStatus('ABA payment was cancelled. Your basket is still saved.', 'warning');
    clearPayWayReturnParams();
    return;
  }
  if (returnState !== 'return') return;

  const tranId = params.get('tran_id') || '';
  let pending = null;
  try { pending = JSON.parse(localStorage.getItem(PAYWAY_PENDING_KEY) || 'null'); }
  catch { pending = null; }

  if (!pending || pending.tranId !== tranId) {
    showPayWayStatus('Payment returned, but this order could not be recovered. Please contact L&K.', 'error');
    return;
  }

  showPayWayStatus('Checking your ABA payment…');
  try {
    const response = await fetch(`/api/payway/check?tran_id=${encodeURIComponent(tranId)}`, {
      headers: { Accept: 'application/json' }
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not verify payment.');
    if (!result.approved) {
      showPayWayStatus(`ABA payment status: ${result.status || 'Processing'}. Please refresh to check again.`, 'warning');
      return;
    }
    if (result.currency !== 'USD' || Math.abs(Number(result.amount) - Number(pending.amount)) > 0.001) {
      throw new Error('The verified payment amount does not match this order. Please contact L&K.');
    }

    prefillCustomerFields();
    setPaymentMethod('aba', { allowDisabled: true });
    renderCartModal();
    verifiedPayWayTransactionId = tranId;
    updateSendButtonState();

    if (document.getElementById('sendOrderBtn')?.disabled) {
      throw new Error('Your paid order is missing checkout details. Please contact L&K.');
    }

    showPayWayStatus('ABA payment approved. Saving your order…', 'success');
    await submitOrder({ paymentVerifiedTranId: tranId });
  } catch (error) {
    console.error('[L&K] PayWay verification failed:', error);
    showPayWayStatus(error instanceof Error ? error.message : 'Could not verify ABA payment.', 'error');
  }
}

function newClientOrderId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
    const random = Math.floor(Math.random() * 16);
    const value = character === 'x' ? random : ((random & 3) | 8);
    return value.toString(16);
  });
}

function buildOrderRecord(paymentVerifiedTranId = '', telegramSent = false) {
  const { orderType, paymentMethod, name, phone, address, locationUrl, date, time } = getCustomerFields();
  const items = cartEntries().flatMap(([id, quantity]) => {
    const product = allProducts.find(item => item.id === id);
    if (!product) return [];
    const unitPrice = priceNum(product);
    return [{
      id: product.id,
      name: product.name,
      image_url: product.image_url || '',
      quantity,
      unit_price: unitPrice,
      line_total: Number((unitPrice * quantity).toFixed(2))
    }];
  });

  return {
    client_order_id: newClientOrderId(),
    customer_name: name,
    customer_phone: phone,
    delivery_address: orderType === 'delivery' ? (address || locationUrl) : '',
    order_type: orderType,
    payment_method: paymentMethod,
    payment_status: paymentMethod === 'aba' ? 'paid' : 'cash_due',
    payment_transaction_id: paymentMethod === 'aba' ? paymentVerifiedTranId : null,
    scheduled_date: date,
    scheduled_time: time,
    items,
    item_count: items.reduce((sum, item) => sum + item.quantity, 0),
    total: Number(cartTotal().toFixed(2)),
    currency: 'USD',
    status: 'new',
    telegram_sent: telegramSent
  };
}

function loadPendingOrderRecords() {
  if (!storageAvailable) return [];
  try {
    const value = JSON.parse(localStorage.getItem(ORDER_RECORD_PENDING_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function savePendingOrderRecords(records) {
  if (!storageAvailable) return;
  if (records.length) localStorage.setItem(ORDER_RECORD_PENDING_KEY, JSON.stringify(records));
  else localStorage.removeItem(ORDER_RECORD_PENDING_KEY);
}

function queueOrderRecord(record) {
  if (!storageAvailable) return;
  const records = loadPendingOrderRecords();
  if (!records.some(item => item.client_order_id === record.client_order_id)) records.push(record);
  savePendingOrderRecords(records.slice(-10));
}

async function insertOrderRecord(record) {
  const { error } = await supabase.from('orders').insert(record);
  if (error && error.code !== '23505') throw error;
}

async function flushPendingOrderRecords() {
  const records = loadPendingOrderRecords();
  if (!records.length) return;

  const remaining = [];
  for (const record of records) {
    try {
      await insertOrderRecord(record);
    } catch (error) {
      console.warn('[L&K] Pending admin order record could not sync:', error.message || error);
      remaining.push(record);
    }
  }
  savePendingOrderRecords(remaining);
}

async function submitOrder({ paymentVerifiedTranId = '' } = {}) {
  const sendBtn = document.getElementById('sendOrderBtn');
  const confirmSendBtn = document.getElementById('confirmSendBtn');
  if (!sendBtn || sendBtn.disabled) return;

  if (getCustomerFields().paymentMethod === 'aba' && !paymentVerifiedTranId) {
    await startPayWayCheckout();
    return;
  }

  if (paymentVerifiedTranId) verifiedPayWayTransactionId = paymentVerifiedTranId;

  const originalLabel = sendBtn.textContent;
  const originalConfirmLabel = confirmSendBtn?.textContent;
  sendBtn.disabled = true;
  sendBtn.textContent = 'Saving…';
  if (confirmSendBtn) { confirmSendBtn.disabled = true; confirmSendBtn.textContent = 'Saving…'; }

  try {
    let telegramSent = false;

    if (TELEGRAM_ORDER_SENDING_ENABLED) {
      let payload;

      if (pendingReceiptImage) {
        payload = { image: pendingReceiptImage.base64, caption: pendingReceiptImage.caption };
      } else {
        const { name } = getCustomerFields();
        const total = cartTotal();
        const caption = `🧾 New Order — ${name || 'Customer'} — $${total.toFixed(2)} (${formatRiel(total)})`;
        try {
          const imageBase64 = await generateReceiptImageBase64();
          if (!imageBase64) throw new Error('html2canvas unavailable or produced no image');
          payload = { image: imageBase64, caption };
        } catch (imgErr) {
          console.warn('[L&K] Receipt image generation failed, falling back to text:', imgErr);
          payload = { text: buildQuoteText() };
        }
      }

      const res = await fetch(TELEGRAM_FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to send order');
      telegramSent = true;
    }

    const orderRecord = buildOrderRecord(paymentVerifiedTranId, telegramSent);
    try {
      await insertOrderRecord(orderRecord);
    } catch (recordError) {
      queueOrderRecord(orderRecord);
      console.warn('[L&K] The admin order record was queued for retry:', recordError.message || recordError);
    }

    closeConfirmModal();
    openOrderSuccessModal();
    sendBtn.textContent = 'Order Saved ✓';
    if (paymentVerifiedTranId) {
      localStorage.removeItem(PAYWAY_PENDING_KEY);
      clearPayWayReturnParams();
      showPayWayStatus('Payment approved and order saved to L&K.', 'success');
    }
    setTimeout(() => {
      clearCart();
      closeCartPage();
      pendingReceiptImage = null;
      verifiedPayWayTransactionId = '';
      sendBtn.textContent = originalLabel;
      sendBtn.disabled = false;
      if (confirmSendBtn) { confirmSendBtn.textContent = originalConfirmLabel; confirmSendBtn.disabled = false; }
    }, 1200);
  } catch (err) {
    console.error('[L&K] Failed to save order:', err);
    alert('Could not save your order. Please check your connection and try again.');
    sendBtn.textContent = originalLabel;
    sendBtn.disabled = false;
    if (confirmSendBtn) { confirmSendBtn.textContent = originalConfirmLabel; confirmSendBtn.disabled = false; }
  }
}

/* Single delegated listener handles every "+" button, every "Remove"
   button, and every stepper button, whether it's inside a product card,
   the detail modal, or the basket page — they all re-use the same
   .addBtn / .cartItemRemove / .stepBtn markup.
   (Previously this listener was accidentally nested inside itself,
   which registered a brand-new duplicate listener on every single
   click — fixed by flattening it into one handler.) */
document.addEventListener('click', (e) => {
  const cartAddedBtn = e.target.closest('.cartAddedBtn');
  if (cartAddedBtn) {
    e.stopPropagation();
    openCartPage();
    return;
  }
  const addBtn = e.target.closest('.addBtn');
  if (addBtn) {
    e.stopPropagation();
    addToCart(addBtn.dataset.id);
    return;
  }
  const removeBtn = e.target.closest('.cartItemRemove');
  if (removeBtn) {
    e.stopPropagation();
    const id = removeBtn.dataset.removeId;
    if (id) {
      delete cart[id];
      saveCart();
      refreshCardControl(id);
      updateCartBar();
      renderCartModal();
    }
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
  await loadMenuCategories();
  renderCategoryUI();
  renderAll(allProducts);
  initCardClicks();
  updateCartBar();
  if (document.getElementById('cartPage')?.classList.contains('open')) renderCartModal();
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
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !name || seen.has(slug)) return [];
    seen.add(slug);
    return [{
      slug,
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
    if (existingIndex >= 0) merged[existingIndex] = { ...merged[existingIndex], ...category };
    else merged.push({ ...category });
  });
  const seen = new Set(merged.map(category => category.slug));
  allProducts.forEach(product => {
    const slug = String(product.category || '').trim().toLowerCase();
    if (!slug || seen.has(slug)) return;
    seen.add(slug);
    const name = titleFromSlug(slug) || slug;
    merged.push({ slug, name, customerLabel: name, hidden: false });
  });
  return merged;
}

async function loadMenuCategories() {
  const { data, error } = await supabase
    .from('site_settings')
    .select('value')
    .eq('key', CATEGORY_SETTING_KEY)
    .maybeSingle();

  let savedCategories = [];
  if (error) {
    console.warn('[L&K menu] Could not load menu categories:', error.message);
  } else if (data?.value) {
    try {
      savedCategories = normalizeCategoryList(JSON.parse(data.value));
    } catch (parseError) {
      console.warn('[L&K menu] Invalid menu category setting:', parseError);
    }
  }
  menuCategories = mergeProductCategories(savedCategories);
}

function renderCategoryUI() {
  const defaultSlugs = new Set(DEFAULT_CATEGORIES.map(category => category.slug));
  Object.keys(CATEGORY_MAP).forEach(slug => {
    if (slug !== 'bestseller' && !defaultSlugs.has(slug)) delete CATEGORY_MAP[slug];
  });

  const chipRow = document.getElementById('chipRow');
  chipRow?.querySelectorAll('[data-dynamic-category]').forEach(chip => chip.remove());
  const locationChip = chipRow?.querySelector('[data-target="sec-locations"]');
  const dynamicSections = document.getElementById('dynamicCategorySections');
  if (dynamicSections) dynamicSections.innerHTML = '';

  DEFAULT_CATEGORIES.forEach(category => {
    const linkedCategory = menuCategories.find(item => item.slug === category.slug) || category;
    const isHidden = linkedCategory.hidden === true;
    const customerLabel = linkedCategory.customerLabel || linkedCategory.name || category.customerLabel;
    const cfg = CATEGORY_MAP[category.slug];
    const grid = cfg ? document.getElementById(cfg.gridId) : null;
    const section = grid?.previousElementSibling;
    const chip = section?.id ? chipRow?.querySelector(`[data-target="${section.id}"]`) : null;
    const sectionTitle = section?.querySelector('h3');
    if (section) section.style.display = isHidden ? 'none' : '';
    if (grid) grid.style.display = isHidden ? 'none' : '';
    if (sectionTitle) sectionTitle.textContent = customerLabel;
    if (chip) {
      chip.style.display = isHidden ? 'none' : '';
      chip.innerHTML = `<span class="dot"></span>${escapeHTML(customerLabel)}`;
    }
  });

  menuCategories.filter(category => !category.hidden).forEach(category => {
    if (defaultSlugs.has(category.slug)) return;
    const sectionId = `sec-${category.slug}`;
    const gridId = `grid-${category.slug}`;
    CATEGORY_MAP[category.slug] = { gridId };

    if (chipRow) {
      const chip = document.createElement('div');
      chip.className = 'chip';
      chip.dataset.target = sectionId;
      chip.dataset.dynamicCategory = category.slug;
      chip.innerHTML = `<span class="dot"></span>${escapeHTML(category.customerLabel || category.name)}`;
      chipRow.insertBefore(chip, locationChip || null);
    }

    if (dynamicSections) {
      dynamicSections.insertAdjacentHTML('beforeend', `
        <div class="sectionHead" id="${escapeAttr(sectionId)}" data-dynamic-category="${escapeAttr(category.slug)}">
          <h3>${escapeHTML(category.customerLabel || category.name)}</h3>
        </div>
        <div class="grid" id="${escapeAttr(gridId)}" data-dynamic-category="${escapeAttr(category.slug)}"></div>
      `);
    }
  });
  refreshSectionObserver();
}

function renderAll(products) {
  const visibleCategories = menuCategories.filter(category => !category.hidden);
  const visibleCategorySlugs = new Set(visibleCategories.map(category => category.slug));
  const visibleProducts = products.filter(product => visibleCategorySlugs.has(product.category));

  // group by visible category
  const byCategory = {};
  visibleProducts.forEach(p => {
    (byCategory[p.category] ||= []).push(p);
  });
  const bestsellers = visibleProducts.filter(p => p.is_bestseller);

  renderGrid("bestseller", bestsellers);
  visibleCategories.forEach(category => renderGrid(category.slug, byCategory[category.slug] || []));
}

function renderGrid(category, items) {
  const cfg = CATEGORY_MAP[category];
  if (!cfg) return;
  const gridEl = document.getElementById(cfg.gridId);
  if (gridEl) gridEl.innerHTML = items.map(cardHTML).join("");
}

/* ---------- chips / section nav ---------- */
document.getElementById('chipRow')?.addEventListener('click', event => {
  const chip = event.target.closest('.chip');
  if (!chip) return;
  const target = document.getElementById(chip.dataset.target);
  if (target) target.scrollIntoView({ behavior: 'smooth' });
});

// rootMargin's top offset should track the fixed header's real height so
// a section only counts as "current" once it clears the header, not a
// hardcoded guess.
function currentHeaderPx() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--header-h').trim();
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : 172;
}

function refreshSectionObserver() {
  sectionObserver?.disconnect();
  sectionObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      document.querySelectorAll('.chip').forEach(chip => {
        chip.classList.toggle('active', chip.dataset.target === entry.target.id);
      });
    });
  }, { rootMargin: `-${currentHeaderPx() + 20}px 0px -70% 0px`, threshold: 0 });
  document.querySelectorAll('.sectionHead').forEach(section => sectionObserver.observe(section));
}

/* ---------- hero slider ---------- */
const heroCarousel = document.getElementById('hero');
let heroSlides = Array.from(document.querySelectorAll('#hero .heroSlide'));
let heroIndex = 0;
let heroTimer;
let heroScrollTimer;

function showHeroSlide(i) {
  if (!heroCarousel || !heroSlides.length) return;
  heroIndex = ((i % heroSlides.length) + heroSlides.length) % heroSlides.length;
  const slide = heroSlides[heroIndex];
  const maxScroll = Math.max(0, heroCarousel.scrollWidth - heroCarousel.clientWidth);
  const targetLeft = Math.min(slide.offsetLeft - heroCarousel.offsetLeft, maxScroll);
  heroCarousel.scrollTo({ left: Math.max(0, targetLeft), behavior: 'smooth' });
}
function nextHeroSlide() { showHeroSlide((heroIndex + 1) % heroSlides.length); }
function syncHeroIndexFromScroll() {
  if (!heroCarousel || !heroSlides.length) return;
  const nearest = Array.from(heroSlides).reduce((best, slide, index) => {
    const distance = Math.abs((slide.offsetLeft - heroCarousel.offsetLeft) - heroCarousel.scrollLeft);
    return distance < best.distance ? { index, distance } : best;
  }, { index: 0, distance: Infinity });
  heroIndex = nearest.index;
}
function startHeroAutoplay() {
  clearInterval(heroTimer);
  if (heroSlides.length < 2) return;
  heroTimer = setInterval(nextHeroSlide, 4000);
}
heroCarousel?.addEventListener('pointerdown', () => clearInterval(heroTimer));
heroCarousel?.addEventListener('pointerup', () => {
  syncHeroIndexFromScroll();
  startHeroAutoplay();
});
heroCarousel?.addEventListener('pointercancel', () => {
  syncHeroIndexFromScroll();
  startHeroAutoplay();
});
heroCarousel?.addEventListener('scroll', () => {
  clearTimeout(heroScrollTimer);
  heroScrollTimer = setTimeout(() => {
    syncHeroIndexFromScroll();
    startHeroAutoplay();
  }, 180);
}, { passive: true });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) clearInterval(heroTimer);
  else startHeroAutoplay();
});
startHeroAutoplay();

/* ---------- search by product ID or name ---------- */
const searchInput = document.getElementById('searchInput');
if (searchInput) {
  searchInput.addEventListener('input', () => {
    const query = searchInput.value.trim().toLowerCase();
    const cards = document.querySelectorAll('.grid .card');

    cards.forEach(card => {
      const id = card.dataset.id || '';
      const product = allProducts.find(p => p.id === id);
      const idMatch = id.toLowerCase().includes(query);
      const nameMatch = product?.name ? product.name.toLowerCase().includes(query) : false;
      const matches = query === '' || idMatch || nameMatch;
      card.style.display = matches ? '' : 'none';
    });

    document.querySelectorAll('.sectionHead').forEach(sectionHead => {
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
  });
}

/* ---------- collapse/expand search into the chip row ---------- */
const toolRow = document.getElementById('toolRow');
const searchIconBtn = document.getElementById('searchIconBtn');
const searchCloseBtn = document.getElementById('searchCloseBtn');

if (searchIconBtn && toolRow) {
  searchIconBtn.addEventListener('click', () => {
    toolRow.classList.add('searchOpen');
    searchInput?.focus();
    setHeaderHeight(); // row height may change slightly, keep content offset accurate
  });
}
if (searchCloseBtn && toolRow) {
  searchCloseBtn.addEventListener('click', () => {
    toolRow.classList.remove('searchOpen');
    if (searchInput) {
      searchInput.value = '';
      searchInput.dispatchEvent(new Event('input')); // reset filtered grid back to "show all"
    }
    setHeaderHeight();
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
    addRow.innerHTML = addControlHTML(product, { showQuantity: true });
  }

  overlay.classList.add('open');
}
function closeModal() { overlay.classList.remove('open'); }

function initCardClicks() {
  document.querySelectorAll('.grid .card').forEach(card => {
    card.addEventListener('click', event => {
      // Add/quantity controls are actions of their own. Do not also open
      // the product detail modal when the customer taps one of them.
      if (event.target.closest('.addWrap')) return;
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

/* ---------- basket bar + cart page ---------- */
const cartPage = document.getElementById('cartPage');
const cartBarBtn = document.getElementById('cartBarBtn');
const cartPageBack = document.getElementById('cartPageBack');
const cartPageClear = document.getElementById('cartPageClear');
const addMoreBtn = document.getElementById('addMoreBtn');
const sendOrderBtn = document.getElementById('sendOrderBtn');
const custNameInput = document.getElementById('custName');
const custPhoneInput = document.getElementById('custPhone');
const custAddressInput = document.getElementById('custAddress');
const custAddressField = document.getElementById('custAddressField');
const deliveryAddressResult = document.getElementById('deliveryAddressResult');
const deliveryAddressEdit = document.getElementById('deliveryAddressEdit');
const addressEditorOverlay = document.getElementById('addressEditorOverlay');
const addressEditorClose = document.getElementById('addressEditorClose');
const addressCancelBtn = document.getElementById('addressCancelBtn');
const addressSaveBtn = document.getElementById('addressSaveBtn');
const useLocationBtn = document.getElementById('useLocationBtn');
const locationStatus = document.getElementById('locationStatus');
const addressLocationPreview = document.getElementById('addressLocationPreview');
const addressLocationMapEl = document.getElementById('addressLocationMap');
const addressLocationAccuracy = document.getElementById('addressLocationAccuracy');
const custDateInput = document.getElementById('custDate');
const custTimeInput = document.getElementById('custTime');
const orderTypeToggle = document.getElementById('orderTypeToggle');
const paymentMethodToggle = document.getElementById('paymentMethodToggle');
let addressBeforeEdit = '';
let locationBeforeEdit = '';
let selectedDeliveryLocationUrl = '';
let addressLocationMap = null;
let addressLocationMarker = null;
let addressLocationAccuracyCircle = null;

// Don't let a customer pick a date in the past.
if (custDateInput) custDateInput.min = new Date().toISOString().split('T')[0];

function setOrderType(type) {
  if (!orderTypeToggle) return;
  orderTypeToggle.dataset.selected = type;
  orderTypeToggle.querySelectorAll('.otBtn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.type === type);
  });
  // Address is only relevant (and required) for delivery.
  if (custAddressField) custAddressField.classList.toggle('hidden', type !== 'delivery');
}

if (orderTypeToggle) {
  orderTypeToggle.querySelectorAll('.otBtn').forEach(btn => {
    btn.addEventListener('click', () => {
      setOrderType(btn.dataset.type);
      saveCustomer(getCustomerFields());
      updateSendButtonState();
    });
  });
}

function setPaymentMethod(method, { allowDisabled = false } = {}) {
  if (!paymentMethodToggle) return;
  const paymentButtons = [...paymentMethodToggle.querySelectorAll('.pmBtn')];
  const requestedButton = paymentButtons.find(btn => btn.dataset.payment === method);
  const selectedMethod = requestedButton && (!requestedButton.disabled || allowDisabled) ? method : 'cash';
  paymentMethodToggle.dataset.selected = selectedMethod;
  paymentButtons.forEach(btn => {
    const isActive = btn.dataset.payment === selectedMethod;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', String(isActive));
  });
}

if (paymentMethodToggle) {
  paymentMethodToggle.querySelectorAll('.pmBtn').forEach(btn => {
    btn.addEventListener('click', () => {
      setPaymentMethod(btn.dataset.payment);
      saveCustomer(getCustomerFields());
      updateSendButtonState();
    });
  });
}

function displayAddressValue(address) {
  const locationMatch = String(address || '').match(/[?&]q=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (locationMatch) return `Current location (${locationMatch[1]}, ${locationMatch[2]})`;
  return String(address || '').trim();
}

function getAddressCoordinates(address) {
  const match = String(address || '').match(/[?&]q=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
}

function showAddressLocationPreview(latitude, longitude, accuracy = 0) {
  if (!addressLocationPreview || !addressLocationMapEl || !window.L) return;
  addressLocationPreview.hidden = false;

  if (!addressLocationMap) {
    addressLocationMap = L.map(addressLocationMapEl, {
      zoomControl: true,
      scrollWheelZoom: false,
      attributionControl: false
    });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 }).addTo(addressLocationMap);
  }

  const point = [latitude, longitude];
  if (!addressLocationMarker) addressLocationMarker = L.marker(point).addTo(addressLocationMap);
  else addressLocationMarker.setLatLng(point);

  if (addressLocationAccuracyCircle) addressLocationAccuracyCircle.remove();
  addressLocationAccuracyCircle = accuracy > 0
    ? L.circle(point, { radius: accuracy, color: '#723c10', weight: 1, fillColor: '#723c10', fillOpacity: .08 }).addTo(addressLocationMap)
    : null;

  addressLocationMap.setView(point, 17, { animate: false });
  if (addressLocationAccuracy) {
    addressLocationAccuracy.textContent = accuracy > 0 ? `± ${Math.round(accuracy)} m` : '';
  }
  window.setTimeout(() => addressLocationMap?.invalidateSize(), 80);
}

function syncAddressLocationPreview() {
  const coordinates = getAddressCoordinates(selectedDeliveryLocationUrl)
    || getAddressCoordinates(custAddressInput?.value);
  if (coordinates) {
    showAddressLocationPreview(coordinates.latitude, coordinates.longitude);
  } else if (addressLocationPreview) {
    addressLocationPreview.hidden = true;
  }
}

function syncDeliveryAddressResult() {
  if (!deliveryAddressResult) return;
  const address = custAddressInput?.value.trim() || '';
  const hasPinnedLocation = Boolean(selectedDeliveryLocationUrl);
  deliveryAddressResult.textContent = displayAddressValue(address)
    || (hasPinnedLocation ? 'Pinned location selected' : 'Add your delivery address');
  deliveryAddressResult.classList.toggle('empty', !address && !hasPinnedLocation);
}

function setLocationStatus(message = '', type = '') {
  if (!locationStatus) return;
  locationStatus.textContent = message;
  locationStatus.classList.toggle('success', type === 'success');
  locationStatus.classList.toggle('error', type === 'error');
}

function openAddressEditor() {
  if (!addressEditorOverlay || !custAddressInput) return;
  addressBeforeEdit = custAddressInput.value;
  locationBeforeEdit = selectedDeliveryLocationUrl;
  setLocationStatus();
  addressEditorOverlay.classList.add('open');
  addressEditorOverlay.setAttribute('aria-hidden', 'false');
  syncAddressLocationPreview();
  window.setTimeout(() => custAddressInput.focus(), 100);
}

function closeAddressEditor({ restore = false } = {}) {
  if (restore) {
    if (custAddressInput) custAddressInput.value = addressBeforeEdit;
    selectedDeliveryLocationUrl = locationBeforeEdit;
  }
  addressEditorOverlay?.classList.remove('open');
  addressEditorOverlay?.setAttribute('aria-hidden', 'true');
  setLocationStatus();
  syncDeliveryAddressResult();
  window.setTimeout(() => deliveryAddressEdit?.focus(), 60);
}

function saveEditedAddress() {
  if (!custAddressInput) return;
  custAddressInput.value = custAddressInput.value.trim();
  saveCustomer(getCustomerFields());
  updateSendButtonState();
  syncDeliveryAddressResult();
  closeAddressEditor();
}

function useCurrentDeliveryLocation() {
  if (!navigator.geolocation) {
    setLocationStatus('Location access is not supported by this browser.', 'error');
    return;
  }

  if (useLocationBtn) useLocationBtn.disabled = true;
  setLocationStatus('Requesting access to your location…');

  navigator.geolocation.getCurrentPosition(
    position => {
      const latitude = position.coords.latitude.toFixed(6);
      const longitude = position.coords.longitude.toFixed(6);
      selectedDeliveryLocationUrl = `https://www.google.com/maps?q=${latitude},${longitude}`;
      showAddressLocationPreview(Number(latitude), Number(longitude), position.coords.accuracy || 0);
      setLocationStatus('Current location added. Save to use it for delivery.', 'success');
      if (useLocationBtn) useLocationBtn.disabled = false;
    },
    error => {
      const messages = {
        1: 'Location permission was denied. You can enter the address manually.',
        2: 'Your current location could not be found. Please try again or enter it manually.',
        3: 'Location request timed out. Please try again.'
      };
      setLocationStatus(messages[error.code] || 'Could not access your location.', 'error');
      if (useLocationBtn) useLocationBtn.disabled = false;
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
  );
}

deliveryAddressEdit?.addEventListener('click', openAddressEditor);
addressEditorClose?.addEventListener('click', () => closeAddressEditor({ restore: true }));
addressCancelBtn?.addEventListener('click', () => closeAddressEditor({ restore: true }));
addressSaveBtn?.addEventListener('click', saveEditedAddress);
useLocationBtn?.addEventListener('click', useCurrentDeliveryLocation);
custAddressInput?.addEventListener('input', syncAddressLocationPreview);
addressEditorOverlay?.addEventListener('click', event => {
  if (event.target === addressEditorOverlay) closeAddressEditor({ restore: true });
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && addressEditorOverlay?.classList.contains('open')) {
    closeAddressEditor({ restore: true });
  }
});

function prefillCustomerFields() {
  const saved = loadCustomer();
  setOrderType(saved.orderType || 'pickup');
  setPaymentMethod(saved.paymentMethod || 'cash');
  if (custNameInput) custNameInput.value = saved.name || '';
  if (custPhoneInput) custPhoneInput.value = saved.phone || '';
  const savedAddress = String(saved.address || '').trim();
  const legacyMapUrl = getAddressCoordinates(savedAddress) ? savedAddress : '';
  selectedDeliveryLocationUrl = String(saved.locationUrl || legacyMapUrl || '').trim();
  if (custAddressInput) custAddressInput.value = legacyMapUrl ? '' : savedAddress;
  if (custDateInput) custDateInput.value = saved.date || '';
  if (custTimeInput) custTimeInput.value = saved.time || '';
  syncDeliveryAddressResult();
}

[custNameInput, custPhoneInput, custDateInput, custTimeInput].forEach(input => {
  if (!input) return;
  input.addEventListener('input', () => {
    saveCustomer(getCustomerFields());
    updateSendButtonState();
  });
});

function openCartPage() {
  prefillCustomerFields();
  renderCartModal();
  cartPage?.classList.add('open');
}
function closeCartPage() {
  if (addressEditorOverlay?.classList.contains('open')) closeAddressEditor({ restore: true });
  cartPage?.classList.remove('open');
}

if (cartBarBtn) cartBarBtn.addEventListener('click', openCartPage);
if (cartPageBack) cartPageBack.addEventListener('click', closeCartPage);
if (addMoreBtn) addMoreBtn.addEventListener('click', closeCartPage);
if (cartPageClear) cartPageClear.addEventListener('click', clearCart);
if (sendOrderBtn) sendOrderBtn.addEventListener('click', openConfirmModal);


/* ---------- confirm order modal ---------- */
const confirmOverlay = document.getElementById('confirmOverlay');
const confirmCancelBtn = document.getElementById('confirmCancelBtn');
const confirmSendBtn = document.getElementById('confirmSendBtn');
const orderSuccessOverlay = document.getElementById('orderSuccessOverlay');
const orderSuccessDoneBtn = document.getElementById('orderSuccessDoneBtn');

if (confirmCancelBtn) confirmCancelBtn.addEventListener('click', closeConfirmModal);
if (confirmSendBtn) confirmSendBtn.addEventListener('click', submitOrder);
if (confirmOverlay) confirmOverlay.addEventListener('click', (e) => { if (e.target === confirmOverlay) closeConfirmModal(); });
if (orderSuccessDoneBtn) orderSuccessDoneBtn.addEventListener('click', closeOrderSuccessModal);
if (orderSuccessOverlay) orderSuccessOverlay.addEventListener('click', (e) => { if (e.target === orderSuccessOverlay) closeOrderSuccessModal(); });

/* ---------- our locations map ---------- */
const locations = [
  { name: 'L&K - First Branch',  address: 'ABA Grand Phnom Penh Branch', lat: 11.629444, lng: 104.872917, url: 'https://maps.app.goo.gl/hN2KTEVes9xH4kVk7' },
  { name: 'L&K - Second Branch', address: 'The Westline school, Russey Keo (598)', lat: 11.632111, lng: 104.883500, url: 'https://maps.app.goo.gl/Qfq4Wr57AxrwQB8g6' },
  { name: 'L&K - Third Branch',  address: 'AEON Mall Sen Sok City (near Maybank)', lat: 11.60352624486013, lng: 104.88559800552896, url: 'https://www.google.com/maps?q=11.60352624486013,104.88559800552896' }
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
          background:#2b2118;color:#fff;font:700 10px 'Inter','Khmer OS Sans','Noto Sans Khmer',sans-serif;
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
      <div style="font-family:'Inter','Khmer OS Sans','Noto Sans Khmer',sans-serif;min-width:165px;padding:2px 0;">
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
  const { data, error } = await supabase.from('site_settings').select('key,value').like('key', 'hero_%');
  if (error) return;
  const rows = (data || []).flatMap(row => {
    const match = String(row.key || '').match(/^hero_([1-9]\d*)$/);
    return match && row.value ? [{ ...row, slideNumber: Number(match[1]) }] : [];
  }).sort((a, b) => a.slideNumber - b.slideNumber);

  rows.forEach(row => {
    let img = document.getElementById(`heroImg${row.slideNumber}`);
    if (!img && heroCarousel) {
      const slide = document.createElement('div');
      slide.className = 'heroSlide';
      img = document.createElement('img');
      img.id = `heroImg${row.slideNumber}`;
      img.alt = `Slideshow image ${row.slideNumber}`;
      slide.appendChild(img);
      heroCarousel.appendChild(slide);
    }
    if (img) img.src = row.value;
  });

  heroSlides = Array.from(document.querySelectorAll('#hero .heroSlide'));
  if (heroIndex >= heroSlides.length) heroIndex = 0;
  startHeroAutoplay();
}

/* ---------- go ---------- */
const productsReady = loadProducts();
loadHeroImages();
updateCartBar();
updateSendButtonState();
flushPendingOrderRecords();
productsReady
  .then(handlePayWayReturn)
  .catch(error => console.error('[L&K] Initial menu load failed:', error));

// Live updates: if the admin edits a product while someone has the site
// open, refresh the grids automatically.
supabase
  .channel('menu-changes')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => {
    loadProducts();
  })
  .on('postgres_changes', { event: '*', schema: 'public', table: 'site_settings' }, async payload => {
    const settingKey = payload.new?.key || payload.old?.key || '';
    if (settingKey === CATEGORY_SETTING_KEY) {
      await loadMenuCategories();
      renderCategoryUI();
      renderAll(allProducts);
      initCardClicks();
    } else if (/^hero_[1-9]\d*$/.test(settingKey)) {
      await loadHeroImages();
    }
  })
  .subscribe();
