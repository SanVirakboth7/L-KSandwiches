import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabase-client.js";

const { createClient } = window.supabase || {};
if (typeof createClient !== 'function') throw new Error('Supabase browser client did not load.');
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const BRANCH_QUANTITY_SETTING_KEY = 'branch_menu_quantities';
const branchId = new URLSearchParams(window.location.search).get('branch') || 'branch-1';
const BRANCHES = {
  'branch-1': { label: 'Branch 1', name: 'ទីតាំងទី ១' },
  'branch-2': { label: 'Branch 2', name: 'ទីតាំងទី ២' },
  'branch-3': { label: 'Branch 3', name: 'ទីតាំងទី ៣' }
};
const branch = BRANCHES[branchId] || BRANCHES['branch-1'];
let products = [];
let categories = [];
let quantities = {};
let exchangeRate = 4000;

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>'"]/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[character]));
const price = value => Number.parseFloat(String(value || '').replace(/[^0-9.]/g, '')) || 0;

function setNotice(message, type = '') { const notice = $('workerNotice'); notice.textContent = message; notice.className = `workerNotice ${type}`; }
function selectedProducts() { return products.filter(product => Object.prototype.hasOwnProperty.call(quantities, product.id)); }
function renderSummary() {
  const selected = selectedProducts();
  const portions = selected.reduce((sum, product) => sum + Math.max(0, Number(quantities[product.id]) || 0), 0);
  $('workerItemCount').textContent = String(selected.length);
  $('workerPortionCount').textContent = String(portions);
  const saleInputs = [...document.querySelectorAll('[data-worker-qty]')];
  const saleCount = saleInputs.reduce((sum, input) => sum + Math.max(0, Number.parseInt(input.value, 10) || 0), 0);
  const saleTotal = saleInputs.reduce((sum, input) => sum + (Math.max(0, Number.parseInt(input.value, 10) || 0) * Number(input.dataset.workerPrice || 0)), 0);
  $('workerOrderSummary').textContent = saleCount ? `${saleCount} កញ្ចប់` : 'មិនទាន់ជ្រើសរើស';
  const rielTotal = Math.round(saleTotal * exchangeRate);
  $('workerOrderTotal').textContent = `សរុប ៛${rielTotal.toLocaleString('km-KH')} · $${saleTotal.toFixed(2)}`;
  $('workerSubmitBtn').disabled = saleCount < 1;
}
function workerInputFor(productId) {
  return [...document.querySelectorAll('[data-worker-qty]')].find(input => input.dataset.workerQty === productId);
}
function setWorkerQuantity(productId, nextValue) {
  const input = workerInputFor(productId);
  if (!input) return;
  const max = Number(input.max) || 0;
  input.value = String(Math.max(0, Math.min(max, nextValue)));
  renderSummary();
}
function renderMenu() {
  const groups = selectedProducts().reduce((map, product) => {
    const category = categories.find(item => item.slug === product.category);
    const label = category?.customerLabel || category?.name || product.category || 'Menu';
    (map[label] ||= []).push(product);
    return map;
  }, {});
  $('workerMenuList').innerHTML = Object.entries(groups).map(([category, items]) => `
    <div class="workerCategory">${esc(category)}</div>
    ${items.map(product => {
      const remaining = Math.max(0, Number(quantities[product.id]) || 0);
      return `<div class="workerItem${remaining === 0 ? ' is-empty' : ''}">
        <img src="${esc(product.image_url || 'img/placeholder.jpg')}" alt="" loading="lazy">
        <div class="workerItemName"><strong>${esc(product.name || product.id)}</strong><small>${esc(product.id)} · $${price(product.price).toFixed(2)}</small></div>
        <div class="workerItemStock"><strong>${remaining}</strong><span>${remaining ? 'នៅសល់' : 'អស់ហើយ'}</span><div class="workerQtyPill"><button type="button" data-worker-step="-1" data-worker-id="${esc(product.id)}" ${remaining ? '' : 'disabled'} aria-label="បន្ថយចំនួន">−</button><input class="workerQty" type="text" inputmode="numeric" readonly value="0" max="${remaining}" data-worker-qty="${esc(product.id)}" data-worker-price="${price(product.price)}" aria-label="ចំនួនលក់ ${esc(product.name || product.id)}" ${remaining ? '' : 'disabled'}><button type="button" data-worker-step="1" data-worker-id="${esc(product.id)}" ${remaining ? '' : 'disabled'} aria-label="បង្កើនចំនួន">+</button></div></div>
      </div>`;
    }).join('')}
  `).join('') || '<p class="workerEmpty">No menu is available for this branch today.</p>';
  renderSummary();
  $('workerUpdatedAt').textContent = `Updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}
async function loadData() {
  const [{ data: productRows, error: productError }, { data: categoryRow }, { data: quantityRow, error: quantityError }, { data: exchangeRow }] = await Promise.all([
    supabase.from('products').select('*').order('category', { ascending: true }).order('sort_order', { ascending: true }),
    supabase.from('site_settings').select('value').eq('key', 'menu_categories').maybeSingle(),
    supabase.from('site_settings').select('value').eq('key', BRANCH_QUANTITY_SETTING_KEY).maybeSingle(),
    supabase.from('site_settings').select('value').eq('key', 'exchange_rate_khr_per_usd').maybeSingle()
  ]);
  if (productError || quantityError) throw productError || quantityError;
  products = productRows || [];
  try { categories = categoryRow?.value ? JSON.parse(categoryRow.value) : []; } catch { categories = []; }
  try { const parsed = quantityRow?.value ? JSON.parse(quantityRow.value) : {}; quantities = parsed?.[branchId] || {}; } catch { quantities = {}; }
  const parsedRate = Number(exchangeRow?.value);
  exchangeRate = Number.isFinite(parsedRate) && parsedRate > 0 ? parsedRate : 4000;
  renderMenu();
}
function newId() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`; }
async function submitWorkerOrder() {
  const sales = [...document.querySelectorAll('[data-worker-qty]')].map(input => ({ id: input.dataset.workerQty, quantity: Math.max(0, Number.parseInt(input.value, 10) || 0) })).filter(item => item.quantity > 0);
  if (!sales.length) return;
  const latest = await supabase.from('site_settings').select('value').eq('key', BRANCH_QUANTITY_SETTING_KEY).maybeSingle();
  if (latest.error) throw latest.error;
  let shared; try { shared = latest.data?.value ? JSON.parse(latest.data.value) : {}; } catch { shared = {}; }
  const latestBranch = shared[branchId] || {};
  for (const sale of sales) if (!Object.prototype.hasOwnProperty.call(latestBranch, sale.id) || sale.quantity > Number(latestBranch[sale.id] || 0)) throw new Error('Stock changed. Refresh and try again.');
  sales.forEach(sale => { latestBranch[sale.id] = Math.max(0, Number(latestBranch[sale.id] || 0) - sale.quantity); });
  const { error: stockError } = await supabase.from('site_settings').upsert({ key: BRANCH_QUANTITY_SETTING_KEY, value: JSON.stringify(shared) }, { onConflict: 'key' });
  if (stockError) throw stockError;
  const orderItems = sales.map(sale => { const product = products.find(item => item.id === sale.id); const unitPrice = price(product?.price); return { id: sale.id, name: product?.name || sale.id, image_url: product?.image_url || '', order_channel: 'branch_daily', branch_id: branchId, branch_name: branch.name, quantity: sale.quantity, unit_price: unitPrice, line_total: Number((unitPrice * sale.quantity).toFixed(2)) }; });
  await supabase.from('orders').insert({ client_order_id: newId(), customer_name: `Walk-in · ${branch.label}`, customer_phone: '+855000000000', delivery_address: '', delivery_location_url: '', order_type: 'pickup', payment_method: 'cash', payment_status: 'cash_due', payment_transaction_id: null, scheduled_date: new Date().toISOString().slice(0, 10), scheduled_time: '', customer_notes: 'Worker stock adjustment', items: orderItems, item_count: sales.reduce((sum, item) => sum + item.quantity, 0), total: Number(orderItems.reduce((sum, item) => sum + item.line_total, 0).toFixed(2)), currency: 'USD', status: 'completed', telegram_sent: false });
  quantities = latestBranch;
  renderMenu();
  setNotice('Order submitted and stock updated for everyone.', 'success');
}
$('workerBranchName').textContent = `${branch.label} · ${branch.name}`;
$('workerRefreshBtn').addEventListener('click', () => loadData().catch(error => setNotice(error.message, 'error')));
$('workerMenuList').addEventListener('click', event => {
  const step = event.target.closest('[data-worker-step]');
  if (!step || step.disabled) return;
  const input = workerInputFor(step.dataset.workerId);
  setWorkerQuantity(step.dataset.workerId, (Number(input?.value) || 0) + Number(step.dataset.workerStep));
});
$('workerSubmitBtn').addEventListener('click', async () => { $('workerSubmitBtn').disabled = true; setNotice('Submitting…'); try { await submitWorkerOrder(); } catch (error) { setNotice(error.message || 'Could not submit order.', 'error'); renderSummary(); } });
supabase.channel(`worker-stock-${branchId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'site_settings' }, payload => { const key = payload.new?.key || payload.old?.key; if (key === BRANCH_QUANTITY_SETTING_KEY) loadData().catch(() => {}); }).subscribe();
async function startWorkerDashboard() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    document.querySelector('.workerShell')?.setAttribute('hidden', '');
    const auth = $('workerAuth');
    auth?.removeAttribute('hidden');
    $('workerAuthForm')?.addEventListener('submit', async event => {
      event.preventDefault();
      const button = $('workerAuthBtn');
      const errorEl = $('workerAuthError');
      button.disabled = true;
      errorEl.textContent = '';
      const { error } = await supabase.auth.signInWithPassword({ email: $('workerEmail').value.trim(), password: $('workerPassword').value });
      if (error) { errorEl.textContent = error.message || 'Could not sign in.'; button.disabled = false; return; }
      window.location.reload();
    });
    return;
  }
  document.querySelector('.workerShell')?.removeAttribute('hidden');
  loadData().catch(error => { $('workerMenuList').innerHTML = '<p class="workerEmpty">Could not load this branch menu.</p>'; setNotice(error.message || 'Could not load menu.', 'error'); });
}
startWorkerDashboard();
