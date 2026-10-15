import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { readFile } from 'node:fs/promises';

const port = 3100 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
const cookieFrom = (r) => r.headers.get('set-cookie')?.split(';')[0];
const req = (path, options = {}) => fetch(`${base}${path}`, options);
const post = (path, body, cookie) => req(path, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
let checks = 0;
function check(condition, message) { checks++; if (!condition) throw new Error(`FAIL: ${message}`); console.log(`PASS: ${message}`); }
try {
  let ready = false;
  for (let i = 0; i < 40; i++) { try { if ((await req('/api/products')).ok) { ready = true; break; } } catch {} await delay(100); }
  check(ready, 'local app starts and serves the catalog');

  let r = await post('/api/register', { name: 'Alice Sample', email: 'alice@example.test', password: 'correct horse battery staple' });
  check(r.status === 201, 'registration accepts a valid demo account');
  const aliceCookie = cookieFrom(r); const aliceBody = await r.json();
  check(Boolean(aliceCookie) && /HttpOnly/.test(r.headers.get('set-cookie')) && /SameSite=Strict/i.test(r.headers.get('set-cookie')), 'session cookie is HttpOnly and SameSite=Strict');
  check(!JSON.stringify(aliceBody).includes('digest') && !JSON.stringify(aliceBody).includes('salt'), 'registration response exposes no password hash or salt');
  r = await post('/api/register', { name: 'Eve', email: "' OR '1'='1", password: 'correct horse battery staple' });
  check(r.status === 400, 'SQL injection shaped registration input is rejected as invalid email');
  r = await post('/api/login', { email: "' OR '1'='1", password: 'anything' });
  check(r.status === 401, 'SQL injection shaped login input does not bypass authentication');
  r = await post('/api/login', { email: 'alice@example.test', password: 'wrong password' });
  check(r.status === 401, 'incorrect credentials are rejected');

  r = await req('/api/products?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E'); const search = await r.json();
  check(r.ok && search.products.length === 0, 'XSS payload in search remains inert data and matches no catalog product');
  const appSource = await readFile(new URL('./public/app.js', import.meta.url), 'utf8');
  check(appSource.includes('textContent') && !appSource.includes('.innerHTML'), 'browser rendering uses textContent and does not parse attacker data as HTML');
  r = await req('/');
  check(r.headers.get('content-security-policy')?.includes("script-src 'self'") && r.headers.get('x-content-type-options') === 'nosniff', 'browser response sets restrictive CSP and nosniff headers');

  r = await req('/api/cart'); check(r.status === 401, 'unauthenticated cart access is denied');
  r = await post('/api/cart', { productId: 'mug', quantity: 2, price: 0.01, total: 0.02 }, aliceCookie);
  check(r.ok, 'signed-in user can add a catalog item');
  let cart = await r.json(); check(cart.total === 48 && cart.items[0].product.price === 24, 'client-supplied price and total are ignored; server catalog price is authoritative');
  r = await post('/api/checkout', { paymentMethod: 'real-card', cardNumber: '4111111111111111' }, aliceCookie);
  check(r.status === 400, 'checkout rejects unsupported payment providers without accepting card data');
  r = await post('/api/checkout', { paymentMethod: 'mock-card', total: 0.01 }, aliceCookie);
  check(r.status === 201, 'checkout completes through mock payment'); const order = (await r.json()).order;
  check(order.total === 48 && order.payment === 'Mock payment approved', 'order total is recalculated server-side and payment is explicitly mock');

  r = await post('/api/register', { name: 'Bob Sample', email: 'bob@example.test', password: 'another safe password' });
  const bobCookie = cookieFrom(r); check(r.status === 201, 'a second isolated demo account can register');
  r = await req('/api/me', { headers: { cookie: bobCookie } }); const bob = await r.json();
  check(bob.orders.length === 0 && !JSON.stringify(bob).includes(order.id), 'second account cannot see the first user’s order history');
  r = await post('/api/logout', {}, aliceCookie);
  check(r.ok && /Max-Age=0/.test(r.headers.get('set-cookie')), 'logout invalidates the session and clears the cookie');
  r = await req('/api/cart', { headers: { cookie: aliceCookie } });
  check(r.status === 401, 'logged-out session token no longer authorizes requests');

  console.log(`\n${checks} security checks passed.`);
} catch (e) { console.error(e); process.exitCode = 1; }
finally { child.kill(); }

