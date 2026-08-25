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

const CATEGORY_SETTING_KEY = 'menu_categories';
const DEFAULT_CATEGORIES = [
  { slug: 'sandwich', name: 'Sandwich', customerLabel: 'សាំងវិច' },
  { slug: 'rice', name: 'Rice', customerLabel: 'បាយ' },
  { slug: 'dessert', name: 'Dessert', customerLabel: 'បង្អែម' },
  { slug: 'drink', name: 'Drink', customerLabel: 'ភេសជ្ជៈ' }
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
  addModalOverlay.classList.add('open');
});
document.getElementById('quickCreateCategory')?.addEventListener('click', () => setCategoryModalOpen(true));

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
async function loadHeroSettings() {
  const { data, error } = await supabase.from('site_settings').select('*').in('key', ['hero_1', 'hero_2', 'hero_3']);
  if (error) {
    console.warn('[L&K admin] Could not load hero settings:', error.message);
    return;
  }
  data.forEach(row => {
    const idNum = row.key.split('_')[1];
    const img = document.getElementById(`heroPreview${idNum}`);
    if (img && row.value) img.src = row.value;
  });
}

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

  document.querySelectorAll('[data-hero-input]').forEach(input => {
    input.addEventListener('change', async () => {
      const file = input.files[0];
      const key = input.dataset.heroInput;
      if (!file) return;

      const slot = input.closest('.heroSlot');
      const uploading = document.createElement('div');
      uploading.className = 'heroSlotUploading';
      uploading.textContent = 'Uploading…';
      slot.appendChild(uploading);

      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `site/${key}-${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(path, file, { upsert: true, cacheControl: '3600' });

      if (uploadError) {
        uploading.remove();
        toast('Upload failed: ' + uploadError.message, true);
        return;
      }

      const { data: publicUrlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
      const publicUrl = publicUrlData.publicUrl;

      const { error: updateError } = await supabase
        .from('site_settings')
        .upsert({ key, value: publicUrl }, { onConflict: 'key' });

      uploading.remove();
      input.value = '';

      if (updateError) {
        toast('Saved photo but failed to save it: ' + updateError.message, true);
        return;
      }

      const idNum = key.split('_')[1];
      const previewImg = document.getElementById(`heroPreview${idNum}`);
      if (previewImg) previewImg.src = publicUrl;

      toast(`Slide ${idNum} updated`);
    });
  });

  const publicUrl = getPublicSiteUrl();
  const qrImg = document.getElementById('qrImg');
  const qrUrlEl = document.getElementById('qrUrl');
  if (qrImg) {
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=520x520&margin=8&data=${encodeURIComponent(publicUrl)}`;
  }
  if (qrUrlEl) qrUrlEl.textContent = publicUrl;
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
    if (existingIndex >= 0) merged[existingIndex] = { ...merged[existingIndex], ...category, hidden: false };
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
    const controls = [{ slug: 'all', name: 'All' }, ...categories];
    catFilter.innerHTML = controls.map(category => `
      <button type="button" class="catBtn${activeCategory === category.slug ? ' active' : ''}" data-cat="${escapeAttr(category.slug)}">
        <span class="catDot" aria-hidden="true"></span>
        <span class="catLabel">${escapeHTML(category.name)}</span>
      </button>`).join('');
    window.requestAnimationFrame(() => {
      catFilter.querySelector('.catBtn.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  }
  if (newCategorySelect) {
    const selected = newCategorySelect.value;
    newCategorySelect.innerHTML = categories.map(category =>
      `<option value="${escapeAttr(category.slug)}">${escapeHTML(category.name)}${category.hidden ? ' (Hidden)' : ''}</option>`
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
      : category?.name || titleFromSlug(cat) || cat;
    const labelEl = button.querySelector('.catLabel');
    if (labelEl) labelEl.textContent = `${label} (${counts[cat] ?? 0})${category?.hidden ? ' · Hidden' : ''}`;
  });
}

function render() {
  const listEl = document.getElementById('productList');
  if (!listEl) return;

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
const photoDeleteBtn = document.getElementById('photoDeleteBtn');
const photoModalClose = document.getElementById('photoModalClose');
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
const categoryModalOverlay = document.getElementById('categoryModalOverlay');
const categoryForm = document.getElementById('categoryForm');
const newCategoryName = document.getElementById('newCategoryName');
const newCategorySlug = document.getElementById('newCategorySlug');
const saveCategoryBtn = document.getElementById('saveCategoryBtn');
const categoryManagerList = document.getElementById('categoryManagerList');
let categorySlugWasEdited = false;

function slugifyCategory(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

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
  const customCategories = categories.filter(category => !isDefaultCategory(category.slug));
  if (!customCategories.length) {
    categoryManagerList.innerHTML = '<p class="categoryManagerEmpty">No custom categories yet.</p>';
    return;
  }

  categoryManagerList.innerHTML = customCategories.map(category => {
    const productCount = products.filter(product => product.category === category.slug).length;
    return `
      <div class="categoryManagerRow" data-category-slug="${escapeAttr(category.slug)}">
        <div class="categoryManagerInfo">
          <span class="categoryManagerName">${escapeHTML(category.name)}</span>
          <span class="categoryManagerMeta">${productCount} product${productCount === 1 ? '' : 's'}${category.hidden ? ' · Hidden from customers' : ''}</span>
        </div>
        <button type="button" class="categoryManagerBtn${category.hidden ? ' isHidden' : ''}" data-category-action="toggle">
          ${category.hidden ? 'Show' : 'Hide'}
        </button>
        <button type="button" class="categoryManagerBtn delete" data-category-action="delete">Delete</button>
      </div>`;
  }).join('');
}

function setCategoryModalOpen(open) {
  categoryModalOverlay?.classList.toggle('open', open);
  if (open) {
    categorySlugWasEdited = false;
    window.setTimeout(() => newCategoryName?.focus(), 120);
  } else {
    categoryForm?.reset();
  }
}

document.getElementById('cancelCategory')?.addEventListener('click', () => setCategoryModalOpen(false));
categoryModalOverlay?.addEventListener('click', event => {
  if (event.target === categoryModalOverlay) setCategoryModalOpen(false);
});

categoryManagerList?.addEventListener('click', async event => {
  const button = event.target.closest('[data-category-action]');
  const row = button?.closest('[data-category-slug]');
  const slug = row?.dataset.categorySlug;
  const category = categories.find(item => item.slug === slug);
  if (!button || !category || isDefaultCategory(slug)) return;

  const action = button.dataset.categoryAction;
  const previousCategories = categories.map(item => ({ ...item }));

  if (action === 'delete') {
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
    toast(`Could not ${action === 'delete' ? 'delete' : 'update'} category: ${error.message}`, true);
  } else {
    toast(action === 'delete'
      ? `${category.name} category deleted`
      : `${category.name} is now ${category.hidden ? 'hidden' : 'visible'}`);
  }
  renderCategoryControls();
  updateCategoryCounts();
  render();
});

newCategoryName?.addEventListener('input', () => {
  if (!categorySlugWasEdited && newCategorySlug) newCategorySlug.value = slugifyCategory(newCategoryName.value);
});
newCategorySlug?.addEventListener('input', () => {
  categorySlugWasEdited = true;
  newCategorySlug.value = slugifyCategory(newCategorySlug.value);
});

categoryForm?.addEventListener('submit', async event => {
  event.preventDefault();
  const name = newCategoryName.value.trim();
  const slug = slugifyCategory(newCategorySlug.value);
  if (!name || !slug) {
    toast('Enter a category name and a valid category key', true);
    return;
  }
  if (categories.some(category => category.slug === slug)) {
    toast('That category already exists', true);
    return;
  }

  const previousCategories = categories.map(category => ({ ...category }));
  categories.push({ slug, name, customerLabel: name, hidden: false });
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
  if (productCategorySelect) productCategorySelect.value = slug;
  updateCategoryCounts();
  render();
  setCategoryModalOpen(false);
  toast(`${name} category created`);
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
