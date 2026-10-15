const $ = (s) => document.querySelector(s);
const state = { products: [], category: 'All', user: null, authMode: 'login' };
const money = (n) => `$${Number(n).toFixed(2).replace(/\.00$/, '')}`;
async function api(url, options = {}) {
  const res = await fetch(url, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
function node(tag, cls, value) { const el = document.createElement(tag); if (cls) el.className = cls; if (value !== undefined) el.textContent = value; return el; }
function productCard(p) {
  const card = node('article', 'product-card'); const visual = node('div', 'product-visual'); visual.style.backgroundColor = p.color;
  visual.append(node('span', 'product-tag', p.category)); visual.append(node('span', 'product-emoji', p.icon));
  const add = node('button', 'add-button', '+'); add.setAttribute('aria-label', `Add ${p.name} to bag`); add.onclick = async () => { try { await api('/api/cart', { method: 'POST', body: JSON.stringify({ productId: p.id, quantity: 1 }) }); toast(`${p.name} added to your bag`); await refreshCart(); } catch (e) { toast(e.message); if (e.message.includes('sign in')) openModal('auth-modal'); } }; visual.append(add);
  const info = node('div', 'product-info'); const detail = node('div'); detail.append(node('h3', '', p.name), node('p', '', p.description)); info.append(detail, node('span', 'price', money(p.price))); card.append(visual, info); return card;
}
function renderProducts() { const grid = $('#product-grid'); grid.replaceChildren(); state.products.filter(p => state.category === 'All' || p.category === state.category).forEach(p => grid.append(productCard(p))); }
async function loadProducts() { state.products = (await api('/api/products')).products; renderProducts(); }
function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 2500); }
function openModal(id) { closePanels(); $('#overlay').classList.add('show'); document.getElementById(id).classList.add('show'); }
function closePanels() { $('#overlay').classList.remove('show'); document.querySelectorAll('.modal.show,.drawer.open').forEach(x => x.classList.remove('show', 'open')); }
async function openCart() { if (!state.user) { openModal('auth-modal'); return; } closePanels(); $('#overlay').classList.add('show'); $('#cart-drawer').classList.add('open'); await refreshCart(); }
async function refreshCart() {
  if (!state.user) { $('#cart-count').textContent = '0'; $('#drawer-count').textContent = '(0)'; $('#cart-total').textContent = '$0'; $('#cart-items').replaceChildren(node('p', 'empty-cart', 'Your bag is waiting for something good.')); return; }
  const { items, total } = await api('/api/cart'); const host = $('#cart-items'); host.replaceChildren(); let count = 0;
  if (!items.length) host.append(node('p', 'empty-cart', 'Your bag is waiting for something good.'));
  for (const item of items) { count += item.quantity; const row = node('div', 'cart-row'); const thumb = node('div', 'cart-thumb'); thumb.style.backgroundColor = item.product.color; thumb.textContent = item.product.icon; const info = node('div'); info.append(node('h3', '', item.product.name), node('p', '', money(item.product.price))); const qty = node('div', 'qty'); const minus = node('button', '', '−'); minus.onclick = () => changeQty(item.product.id, item.quantity - 1); qty.append(minus, node('span', '', String(item.quantity))); const plus = node('button', '', '+'); plus.onclick = () => changeQty(item.product.id, item.quantity + 1); qty.append(plus); info.append(qty); row.append(thumb, info, node('strong', '', money(item.lineTotal))); host.append(row); }
  $('#cart-count').textContent = String(count); $('#drawer-count').textContent = `(${count})`; $('#cart-total').textContent = money(total);
}
async function changeQty(id, quantity) { try { await api(`/api/cart/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ quantity }) }); await refreshCart(); } catch (e) { toast(e.message); } }
async function refreshAccount() { const data = await api('/api/me'); state.user = data.user; if (state.user) { $('#account-name').textContent = `Hello, ${state.user.name}`; $('#account-email').textContent = state.user.email; const host = $('#account-orders'); host.replaceChildren(node('h3', '', 'Your orders')); if (!data.orders.length) host.append(node('p', 'muted', 'Your first good thing is still out there.')); for (const order of data.orders) { const card = node('div', 'order-card'); const head = node('strong'); head.append(node('span', '', order.id), node('span', '', money(order.total))); card.append(head, node('p', '', `${new Date(order.createdAt).toLocaleDateString()} · ${order.items.map(x => `${x.quantity} × ${x.name}`).join(', ')} · ${order.payment}`)); host.append(card); } } await refreshCart(); }
function authMode(mode) { state.authMode = mode; document.querySelectorAll('[data-auth]').forEach(b => b.classList.toggle('active', b.dataset.auth === mode)); const reg = mode === 'register'; $('#auth-title').textContent = reg ? 'Make room for good things.' : 'A place for your good things.'; $('#name-wrap').classList.toggle('hidden', !reg); $('#auth-submit').firstChild.textContent = reg ? 'Create account ' : 'Sign in '; $('#auth-form').elements.password.autocomplete = reg ? 'new-password' : 'current-password'; $('#auth-message').textContent = ''; }
async function submitAuth(event) { event.preventDefault(); const form = new FormData(event.currentTarget); const payload = Object.fromEntries(form.entries()); $('#auth-message').textContent = 'One moment…'; try { await api(`/api/${state.authMode}`, { method: 'POST', body: JSON.stringify(payload) }); closePanels(); event.currentTarget.reset(); await refreshAccount(); toast(state.authMode === 'register' ? 'Your account is ready' : 'Welcome back'); } catch (e) { $('#auth-message').textContent = e.message; } }
async function checkout() { if (!state.user) { openModal('auth-modal'); return; } const { items, total } = await api('/api/cart'); if (!items.length) { toast('Your bag is empty'); return; } const host = $('#checkout-summary'); host.replaceChildren(); for (const item of items) host.append(line(`${item.quantity} × ${item.product.name}`, money(item.lineTotal))); host.append(line('Total', money(total), true)); $('#checkout-message').textContent = ''; openModal('checkout-modal'); }
function line(label, amount, total = false) { const el = node('div', `checkout-line${total ? ' total' : ''}`); el.append(node('span', '', label), node('strong', '', amount)); return el; }
async function placeOrder() { const paymentMethod = document.querySelector('input[name="payment"]:checked').value; $('#place-order').disabled = true; try { const { order } = await api('/api/checkout', { method: 'POST', body: JSON.stringify({ paymentMethod }) }); closePanels(); toast(`Order ${order.id} placed · demo payment only`); await refreshAccount(); } catch (e) { $('#checkout-message').textContent = e.message; } finally { $('#place-order').disabled = false; } }
$('#cart-open').onclick = openCart;
$('#overlay').onclick = closePanels;
document.querySelectorAll('[data-close]').forEach(x => x.onclick = closePanels);
$('#account-link').onclick = () => { if (state.user) openModal('account-modal'); else { authMode('login'); openModal('auth-modal'); } };
$('#auth-form').addEventListener('submit', submitAuth);
document.querySelectorAll('[data-auth]').forEach(b => b.onclick = () => authMode(b.dataset.auth));
$('#checkout-open').onclick = checkout;
$('#place-order').onclick = placeOrder;
$('#sign-out').onclick = async () => { await api('/api/logout', { method: 'POST', body: '{}' }); state.user = null; closePanels(); await refreshCart(); toast('Signed out'); };
const filterGroup = document.querySelector('.filters');
const filterButtons = [...filterGroup.querySelectorAll('.filter')];
function moveFilterPill(button) {
  if (!button) return;
  const groupRect = filterGroup.getBoundingClientRect();
  const buttonRect = button.getBoundingClientRect();
  filterGroup.style.setProperty('--pill-x', `${buttonRect.left - groupRect.left}px`);
  filterGroup.style.setProperty('--pill-y', `${buttonRect.top - groupRect.top}px`);
  filterGroup.style.setProperty('--pill-width', `${buttonRect.width}px`);
  filterGroup.style.setProperty('--pill-height', `${buttonRect.height}px`);
}
const movePillToActive = () => moveFilterPill(filterGroup.querySelector('.filter.active'));
filterButtons.forEach(button => {
  button.addEventListener('pointerenter', () => moveFilterPill(button));
  button.addEventListener('focus', () => moveFilterPill(button));
  button.onclick = () => {
    state.category = button.dataset.filter;
    filterButtons.forEach(item => item.classList.toggle('active', item === button));
    moveFilterPill(button);
    renderProducts();
  };
});
filterGroup.addEventListener('pointerleave', movePillToActive);
filterGroup.addEventListener('focusout', event => {
  if (!filterGroup.contains(event.relatedTarget)) movePillToActive();
});
window.addEventListener('resize', movePillToActive);
requestAnimationFrame(movePillToActive);
$('#newsletter').onsubmit = (e) => { e.preventDefault(); e.currentTarget.reset(); toast('Thanks for stopping by'); };

Promise.all([loadProducts(), refreshAccount()]).catch(e => toast(e.message));
import('/jelly3d.js?v=layered-depth-2').then(({ createJellyScene }) => createJellyScene(document.querySelector('main'))).catch(error => console.error('The 3D soft-body cloud could not start:', error));


