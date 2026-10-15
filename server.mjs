import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const scrypt = promisify(scryptCallback);
const root = path.dirname(fileURLToPath(import.meta.url));
const requestedPort = process.env.PORT ? Number(process.env.PORT) : 3000;
const autoSelectPort = !process.env.PORT;
const products = [
  { id: 'mug', name: 'Studio ceramic mug', category: 'Home', price: 24, description: 'A sturdy, glazed stoneware mug for slow mornings.', color: '#e6b98c', icon: '☕' },
  { id: 'tote', name: 'Everyday canvas tote', category: 'Accessories', price: 32, description: 'Roomy recycled cotton canvas, made for daily carry.', color: '#a5b7a0', icon: '👜' },
  { id: 'lamp', name: 'Pebble table lamp', category: 'Home', price: 86, description: 'Soft ambient light with a sculptural, quiet profile.', color: '#d9a58f', icon: '💡' },
  { id: 'bottle', name: 'Trail bottle', category: 'Accessories', price: 38, description: 'Double-wall stainless steel keeps drinks just right.', color: '#9fb4c4', icon: '🧴' },
  { id: 'notebook', name: 'Field notes set', category: 'Stationery', price: 18, description: 'Three pocket notebooks for ideas worth keeping.', color: '#d5c58e', icon: '📓' },
  { id: 'throw', name: 'Woven cotton throw', category: 'Home', price: 74, description: 'An easy layer in soft, breathable cotton.', color: '#b39caf', icon: '🧶' },
];
const users = new Map();
const sessions = new Map();
const orders = new Map();
const carts = new Map();
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const vendorFiles = new Map([
  ['/vendor/three.module.js', path.join(root, 'node_modules', 'three', 'build', 'three.module.js')],
  ['/vendor/three.core.js', path.join(root, 'node_modules', 'three', 'build', 'three.core.js')],
]);
const hash = (s) => createHash('sha256').update(s).digest('hex');
const json = (res, status, data, extra = {}) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'", 'Referrer-Policy': 'no-referrer', ...extra }); res.end(JSON.stringify(data)); };
const safeUser = (u) => ({ id: u.id, email: u.email, name: u.name });
async function body(req) {
  let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 100_000) throw new Error('Request too large'); }
  try { return JSON.parse(raw || '{}'); } catch { throw new Error('Invalid JSON'); }
}
async function passwordHash(password, salt = randomBytes(16).toString('hex')) { return { salt, digest: (await scrypt(password, salt, 64)).toString('hex') }; }
function session(req) {
  const cookie = req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith('sid='));
  const token = cookie?.slice(4); const record = token && sessions.get(hash(token));
  if (!record || record.expires < Date.now()) { if (record) sessions.delete(hash(token)); return null; }
  return { ...record.user, token };
}
function requireUser(req, res) { const user = session(req); if (!user) { json(res, 401, { error: 'Please sign in.' }); return null; } return user; }
function cartFor(uid) { return carts.get(uid) || []; }
function cartView(uid) { return cartFor(uid).map(({ productId, quantity }) => { const p = products.find(x => x.id === productId); return p ? { product: p, quantity, lineTotal: p.price * quantity } : null; }).filter(Boolean); }
function totalOf(lines) { return lines.reduce((n, x) => n + x.lineTotal, 0); }
const routes = async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && url.pathname === '/api/products') {
    const q = (url.searchParams.get('q') || '').slice(0, 80).toLocaleLowerCase();
    return json(res, 200, { products: products.filter(p => `${p.name} ${p.category} ${p.description}`.toLocaleLowerCase().includes(q)) });
  }
  if (req.method === 'GET' && url.pathname.startsWith('/api/products/')) { const p = products.find(x => x.id === url.pathname.split('/').pop()); return p ? json(res, 200, { product: p }) : json(res, 404, { error: 'Product not found.' }); }
  if (req.method === 'POST' && url.pathname === '/api/register') {
    const b = await body(req); const email = String(b.email || '').trim().toLowerCase(); const name = String(b.name || '').trim().slice(0, 60); const password = String(b.password || '');
    if (!/^\S+@\S+\.\S+$/.test(email) || name.length < 1 || password.length < 10 || password.length > 200) return json(res, 400, { error: 'Enter a name, valid email, and password (10–200 characters).' });
    if (users.has(email)) return json(res, 409, { error: 'An account with that email already exists.' });
    const credentials = await passwordHash(password); const user = { id: randomBytes(16).toString('hex'), email, name, ...credentials }; users.set(email, user); orders.set(user.id, []); carts.set(user.id, []);
    const token = randomBytes(32).toString('base64url'); sessions.set(hash(token), { user: safeUser(user), expires: Date.now() + 8 * 60 * 60 * 1000 });
    return json(res, 201, { user: safeUser(user) }, { 'Set-Cookie': `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800` });
  }
  if (req.method === 'POST' && url.pathname === '/api/login') {
    const b = await body(req); const email = String(b.email || '').trim().toLowerCase(); const user = users.get(email); const password = String(b.password || '');
    const candidate = user ? Buffer.from((await scrypt(password, user.salt, 64)).toString('hex'), 'hex') : Buffer.alloc(64);
    const expected = user ? Buffer.from(user.digest, 'hex') : Buffer.alloc(64);
    if (!user || !timingSafeEqual(candidate, expected)) return json(res, 401, { error: 'Email or password is incorrect.' });
    const token = randomBytes(32).toString('base64url'); sessions.set(hash(token), { user: safeUser(user), expires: Date.now() + 8 * 60 * 60 * 1000 });
    return json(res, 200, { user: safeUser(user) }, { 'Set-Cookie': `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800` });
  }
  if (req.method === 'POST' && url.pathname === '/api/logout') { const u = session(req); if (u) sessions.delete(hash(u.token)); return json(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' }); }
  if (req.method === 'GET' && url.pathname === '/api/me') { const u = session(req); return u ? json(res, 200, { user: safeUser(u), orders: orders.get(u.id) || [] }) : json(res, 200, { user: null, orders: [] }); }
  if (req.method === 'GET' && url.pathname === '/api/cart') { const u = requireUser(req, res); if (!u) return; const items = cartView(u.id); return json(res, 200, { items, total: totalOf(items) }); }
  if (req.method === 'POST' && url.pathname === '/api/cart') { const u = requireUser(req, res); if (!u) return; const b = await body(req); const p = products.find(x => x.id === b.productId); const quantity = Number(b.quantity ?? 1); if (!p || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) return json(res, 400, { error: 'Choose a valid product and quantity (1–20).' }); const cart = cartFor(u.id); const entry = cart.find(x => x.productId === p.id); if (entry) entry.quantity = Math.min(20, entry.quantity + quantity); else cart.push({ productId: p.id, quantity }); const items = cartView(u.id); return json(res, 200, { items, total: totalOf(items) }); }
  if (req.method === 'PATCH' && url.pathname.startsWith('/api/cart/')) { const u = requireUser(req, res); if (!u) return; const id = url.pathname.split('/').pop(); const b = await body(req); const q = Number(b.quantity); const cart = cartFor(u.id); const entry = cart.find(x => x.productId === id); if (!entry) return json(res, 404, { error: 'Cart item not found.' }); if (!Number.isInteger(q) || q < 0 || q > 20) return json(res, 400, { error: 'Quantity must be 0–20.' }); if (q === 0) carts.set(u.id, cart.filter(x => x.productId !== id)); else entry.quantity = q; const items = cartView(u.id); return json(res, 200, { items, total: totalOf(items) }); }
  if (req.method === 'POST' && url.pathname === '/api/checkout') { const u = requireUser(req, res); if (!u) return; const items = cartView(u.id); if (!items.length) return json(res, 400, { error: 'Your cart is empty.' }); const b = await body(req); if (!['mock-card', 'mock-wallet'].includes(b.paymentMethod)) return json(res, 400, { error: 'Choose a supported mock payment method.' }); const order = { id: `ORD-${randomBytes(4).toString('hex').toUpperCase()}`, createdAt: new Date().toISOString(), items: items.map(x => ({ productId: x.product.id, name: x.product.name, quantity: x.quantity, unitPrice: x.product.price, lineTotal: x.lineTotal })), total: totalOf(items), payment: 'Mock payment approved' }; orders.get(u.id).unshift(order); carts.set(u.id, []); return json(res, 201, { order }); }
  json(res, 404, { error: 'Not found.' });
};
const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/api/')) return await routes(req, res);
    const pathname = new URL(req.url, 'http://localhost').pathname; const file = pathname === '/' ? 'index.html' : pathname.slice(1);
    const vendorPath = vendorFiles.get(pathname);
    if (!vendorPath && !['index.html', 'app.js', 'style.css', 'jelly3d.js'].includes(file)) { res.writeHead(404); return res.end('Not found'); }
    const data = await readFile(vendorPath || path.join(root, 'public', file)); res.writeHead(200, { 'Content-Type': mime[path.extname(file)], 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'", 'Referrer-Policy': 'no-referrer' }); res.end(data);
  } catch (e) { json(res, e.message === 'Request too large' ? 413 : 400, { error: e.message || 'Request failed.' }); }
});
let activePort = requestedPort;
server.on('error', (error) => {
  if (autoSelectPort && error.code === 'EADDRINUSE' && activePort < requestedPort + 100) {
    activePort += 1;
    server.listen(activePort);
    return;
  }
  console.error(`Could not start Workshop Market on port ${activePort}: ${error.message}`);
  process.exitCode = 1;
});
server.listen(activePort, () => console.log(`Workshop Market listening at http://localhost:${server.address().port}`));

