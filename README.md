# Workshop Market · E-Commerce Security Challenge

A small e-commerce demo and local security lab. The API uses Node.js built-in modules, the storefront uses Three.js for its interactive 3D jelly hero, and checkout is mock-only. No real payment details or credentials are needed. Account and order data resets when the server stops.

## Run it

Requires Node.js 20 or later.

```sh
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000). Create an account with a made-up email and a password of at least 10 characters. Shop, update your bag, check out with **Mock card** or **Mock wallet**, then open Account to see order history.

Move your cursor over any soft-body form to make it wobble, and drag forms independently. Each cross and orb has its own spring, damping, gravity, and release momentum. As you scroll through the storefront, the forms drift like a cloud and grow at different rates. The scene is confined to the storefront page and remains behind its glass panels and dialogs.

Run the local security checks with `npm test`. The checks start their own server on a random local port and stop it afterward.

## Security challenge results

All exploit attempts below target only this local demo. The app is shipped in its fixed state; the strings illustrate the attacker inputs that the checks send and the hardened result.

| Area | Demonstration and result | Impact if vulnerable | Fix and retest |
|---|---|---|---|
| SQL injection | `POST /api/login` with email `' OR '1'='1` and any password returns `401`; registration with the same malformed email returns `400`. | A query assembled from attacker-controlled text can expose accounts or bypass login. | No SQL is built from request data: the in-memory account map uses an exact normalized email key, input is validated, and password verification is required. The local checks repeat both payloads and confirm no account/session is returned. |
| Reflected/stored XSS | `GET /api/products?q=%3Cscript%3Ealert(1)%3C/script%3E` returns an empty product list. If user text appears in the UI, the renderer assigns it with `textContent`; there is no `innerHTML` sink. | Script execution in another shopper’s browser can steal accessible data or perform actions as that shopper. | Text is created as text nodes; a restrictive CSP disallows inline script and external script sources. Retest checks the encoded payload result, rendering sinks, and CSP response header. |
| Broken authentication/session handling | An unauthenticated `GET /api/cart` returns `401`; a wrong password returns the same generic `401` as an unknown login. Registration/login set an opaque, random, HttpOnly, SameSite=Strict cookie; logout expires the server-side session. | Login bypass, credential disclosure, or stolen/reusable sessions can take over an account. | Passwords use per-user random salts and scrypt; comparison uses a constant-time function; session tokens are random and only their SHA-256 hashes are stored server-side, with an 8-hour expiry. Retest confirms invalid login, cookie flags, and logout revocation. |
| Broken access control | The account endpoint derives orders solely from the authenticated session. The check creates Alice’s order, signs in as Bob, and verifies Bob receives an empty order history. | A user could read or modify another customer’s profile, cart, or orders. | There is no caller-supplied user ID on account/cart routes; each route scopes data to the session user. Retest verifies isolation across two accounts. |
| Price manipulation | Add a mug while submitting `price: 0.01` and `total: 0.02`; the returned total remains `$48` for quantity two. Checkout with `total: 0.01` creates an order for `$48`. | A client could pay less than the advertised price or alter order records. | Cart stores only product IDs and quantities. The server reads catalog prices and recalculates every line and order total at checkout. Retest tampers with both add-to-cart and checkout payloads. |
| Sensitive data exposure | Registration response contains only safe profile fields; the check asserts that neither `salt` nor `digest` is present. Checkout rejects unsupported payment methods and ignores card fields. | Password verifiers, session tokens, or payment details could leak through API responses or logs. | Password material stays server-side; cookies are HttpOnly; only mock payment identifiers are accepted; card fields are neither needed nor stored. Retest checks response fields and rejection of a real-looking card submission. |

## Evidence

`npm test` prints one `PASS:` line for each retest and ends with a passed-check count. This is request/response evidence generated against the local server, not a screenshot. The test script is [security-checks.mjs](./security-checks.mjs); application behavior is in [server.mjs](./server.mjs) and [public/app.js](./public/app.js).

## Scope and limitations

This is a learning demo, not a production commerce backend. It has no database, persistent storage, email verification, rate limiting, CSRF token, HTTPS termination, or real payment integration. Keep it bound to a trusted local environment; do not use real credentials or payment details. Add durable storage, deployment controls, rate limits, and a reviewed CSRF strategy before exposing an application publicly.

