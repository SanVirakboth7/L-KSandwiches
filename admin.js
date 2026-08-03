import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY, STORAGE_BUCKET } from "./supabase-config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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

const CATEGORY_LABELS = {
  all: 'All',
  sandwich: 'Sandwich',
  rice: 'Rice',
  dessert: 'Dessert',
  drink: 'Drink'
};

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
  await supabase.auth.signOut();
  showLogin();
}

/* ---------- tab navigation ---------- */
const pageTitleEl = document.getElementById('pageTitle');
const menuToolbar = document.getElementById('menuToolbar');
const fabBtn = document.getElementById('addProductBtn');
const pages = {
  dashboard: document.getElementById('page-dashboard'),
  menu: document.getElementById('page-menu'),
  settings: document.getElementById('page-settings')
};
const PAGE_TITLES = { dashboard: 'Dashboard', menu: 'Menu', settings: 'Settings' };

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
  if (fabBtn) fabBtn.style.display = name === 'settings' ? 'none' : 'flex';

  if (name === 'dashboard') updateDashboardStats();

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

  const elTotal = document.getElementById('statTotalItems');
  const elCats = document.getElementById('statCategories');
  const elFeatured = document.getElementById('statFeatured');
  if (elTotal) elTotal.textContent = totalItems;
  if (elCats) elCats.textContent = categoriesUsed;
  if (elFeatured) elFeatured.textContent = featured;
}

document.getElementById('quickAddItem')?.addEventListener('click', () => {
  addModalOverlay.classList.add('open');
});
document.getElementById('quickViewSite')?.addEventListener('click', () => {
  window.open('index.html', '_blank');
});

/* ---------- settings page ---------- */
function getPublicSiteUrl() {
  const path = window.location.pathname;
  const dir = path.substring(0, path.lastIndexOf('/') + 1);
  return window.location.origin + dir + 'index.html';
}

async function setupSettingsPage() {
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
  const qrUrlEl = document.getElementById('qrUrl');
  if (qrImg) {
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=${encodeURIComponent(publicUrl)}`;
  }
  if (qrUrlEl) qrUrlEl.textContent = publicUrl;
}

document.getElementById('settingsViewSite')?.addEventListener('click', () => {
  window.open('index.html', '_blank');
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
  updateCategoryCounts();
  updateDashboardStats();
  render();
}

function updateCategoryCounts() {
  const counts = { all: products.length, sandwich: 0, rice: 0, dessert: 0, drink: 0 };
  products.forEach(p => {
    if (counts[p.category] !== undefined) counts[p.category]++;
  });
  document.querySelectorAll('.catBtn').forEach(btn => {
    const cat = btn.dataset.cat;
    const label = CATEGORY_LABELS[cat] || cat;
    btn.textContent = `${label} (${counts[cat] ?? 0})`;
  });
}

function render() {
  const listEl = document.getElementById('productList');
  if (!listEl) return;

  const filtered = products.filter(p => {
    const matchesCat = activeCategory === 'all' || p.category === activeCategory;
    const q = searchQuery.toLowerCase();
    const matchesSearch = !q || p.id.toLowerCase().includes(q) || (p.name || '').toLowerCase().includes(q);
    return matchesCat && matchesSearch;
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

function rowHTML(p) {
  const priceValue = (p.price || '').replace(/^\$/, '');
  return `
    <div class="productRow" data-id="${p.id}">
      <div class="rowImg" data-role="imgTrigger">
        <img src="${p.image_url}" alt="${escapeAttr(p.name)}">
        <div class="imgOverlay">View photo</div>
      </div>

      <div class="rowFields">
        <div class="rowTopLine">
          <input type="text" class="nameInput" data-role="name" value="${escapeAttr(p.name)}" placeholder="Product name">
        </div>

        <div class="rowMeta">
          <span class="rowId">${p.id}</span>
          <span class="catTag">${p.category}</span>
          <span class="savedTick" data-role="savedTick">Saved ✓</span>
        </div>

        <div class="rowBottomLine">
          <div class="priceWrap">
            <span class="priceSign">$</span>
            <input type="text" class="priceInput" data-role="price" value="${escapeAttr(priceValue)}" placeholder="0.00">
          </div>

          <div class="rowActionsRight">
            <label class="bestBtn ${p.is_bestseller ? 'active' : ''}" title="Show in Bestseller section">
              <input type="checkbox" data-role="bestseller" ${p.is_bestseller ? 'checked' : ''} hidden>
              ${STAR_ICON}
            </label>
            <button class="deleteIconBtn" data-role="deleteBtn" type="button" aria-label="Delete product">${TRASH_ICON}</button>
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
  const bestsellerEl = row.querySelector('[data-role="bestseller"]');
  const bestBtnLabel = row.querySelector('.bestBtn');
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

  bestsellerEl.addEventListener('change', () => {
    bestBtnLabel.classList.toggle('active', bestsellerEl.checked);
    saveField({ is_bestseller: bestsellerEl.checked });
    updateDashboardStats();
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
const photoDeleteBtn = document.getElementById('photoDeleteBtn');
const photoModalClose = document.getElementById('photoModalClose');

const photoModalReady = !!(photoModalOverlay && photoModalImg && photoModalId &&
  photoModalUploading && photoModalFileInput && photoChangeBtn && photoDeleteBtn && photoModalClose);

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
  photoModalOverlay.classList.add('open');
}

function closePhotoModal() {
  if (!photoModalReady) return;
  photoModalOverlay.classList.remove('open');
  currentPhotoProductId = null;
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

  photoModalFileInput.addEventListener('change', async () => {
    const file = photoModalFileInput.files[0];
    const id = currentPhotoProductId;
    if (!file || !id) return;

    photoModalUploading.style.display = 'flex';

    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `${id}-${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(path, file, { upsert: true, cacheControl: '3600' });

    if (uploadError) {
      photoModalUploading.style.display = 'none';
      toast('Upload failed: ' + uploadError.message, true);
      return;
    }

    const { data: publicUrlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
    const publicUrl = publicUrlData.publicUrl;

    const { error: updateError } = await supabase.from('products').update({ image_url: publicUrl }).eq('id', id);
    photoModalUploading.style.display = 'none';
    photoModalFileInput.value = '';

    if (updateError) {
      toast('Saved photo but failed to link it: ' + updateError.message, true);
      return;
    }

    photoModalImg.src = publicUrl;
    const local = products.find(p => p.id === id);
    if (local) local.image_url = publicUrl;

    const cardImg = document.querySelector(`.productRow[data-id="${cssEscape(id)}"] .rowImg img`);
    if (cardImg) cardImg.src = publicUrl;

    toast(`${id} photo updated`);
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

document.querySelectorAll('.catBtn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.catBtn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeCategory = btn.dataset.cat;
    render();
  });
});

/* ---------- add product ---------- */
const addModalOverlay = document.getElementById('addModalOverlay');
document.getElementById('addProductBtn').addEventListener('click', () => addModalOverlay.classList.add('open'));
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