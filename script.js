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

let allProducts = [];

function cardHTML(p) {
  const badge = p.badge ? `<span class="badge">${escapeHTML(p.badge)}</span>` : "";
  const price = p.price ? `<p class="price">${escapeHTML(p.price)}</p>` : "";
  return `
    <div class="card" data-id="${p.id}">
      <div class="cardArt">
        ${badge}
        <img src="${escapeAttr(p.image_url)}" alt="${escapeAttr(p.name)}">
      </div>
      <div class="cardBody">
        <p class="id">ID: ${p.id}</p>
        <p class="name">${escapeHTML(p.name)}</p>
        ${price}
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

const sectionObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      chips.forEach(c => c.classList.toggle('active', c.dataset.target === entry.target.id));
    }
  });
}, { rootMargin: '-140px 0px -70% 0px', threshold: 0 });
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

/* ---------- chat button click feedback ---------- */
const chatBtn = document.querySelector('.orderBar button');
if (chatBtn) {
  chatBtn.addEventListener('click', () => {
    chatBtn.classList.remove('pop');
    void chatBtn.offsetWidth;
    chatBtn.classList.add('pop');
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
  document.getElementById('modalPrice').textContent = product.price ? ('$' + product.price.replace(/^\$/, '')) : '';
  modalImg.src = product.image_url;
  modalImg.alt = product.name || 'N/A';
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

  function makeIcon(n) {
    const svg = `<svg width="30" height="38" viewBox="0 0 34 42" xmlns="http://www.w3.org/2000/svg">
      <filter id="lkds${n}"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="rgba(43,33,24,0.3)"/></filter>
      <path d="M17 0C7.6 0 0 7.6 0 17c0 12.7 17 25 17 25S34 29.7 34 17C34 7.6 26.4 0 17 0z" fill="#2b2118" filter="url(#lkds${n})"/>
      <circle cx="17" cy="16" r="9" fill="#d9a030"/>
      <text x="17" y="21" font-family="Inter,sans-serif" font-size="11" font-weight="700" fill="#fff" text-anchor="middle">${n}</text>
    </svg>`;
    return L.divIcon({ html: svg, className: '', iconSize: [30, 38], iconAnchor: [15, 38], popupAnchor: [0, -40] });
  }

  markers = locations.map((loc, i) => {
    const m = L.marker([loc.lat, loc.lng], { icon: makeIcon(i + 1) }).addTo(map);
    m.bindPopup(`
      <div style="font-family:'Inter',sans-serif;min-width:165px;padding:2px 0;">
        <div style="font-weight:700;font-size:13px;color:#2b2118;margin-bottom:3px;">${loc.name}</div>
        <div style="font-size:11px;color:#6b5f52;margin-bottom:10px;line-height:1.4;">${loc.address}</div>
        <a href="${loc.url}" target="_blank" rel="noopener"
           style="display:inline-flex;align-items:center;gap:6px;background:#2b2118;color:#fff;
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

  const openHour = 7;
  const closeHour = 17;
  const hour = now.getHours();
  const isOpen = !isWeekend && hour >= openHour && hour < closeHour;

  const statusEl = document.getElementById("openStatus");
  if (statusEl) statusEl.textContent = isOpen ? "Open now" : "Closed now";
})();

/* ---------- go ---------- */
loadProducts();

// Live updates: if the admin edits a product while someone has the site
// open, refresh the grids automatically.
supabase
  .channel('products-changes')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => {
    loadProducts();
  })
  .subscribe();
