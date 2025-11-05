LeeCoin Node.js backend (local dev)

This repository now includes a minimal Express server to centralize M-Pesa confirmations and admin operations.

Files added:
- server.js        : Express server with API endpoints
- package.json     : Node.js dependencies and start script
- db.json          : Simple file-based DB (submissions, balances, transfers)

Quick start (Windows PowerShell):

# install dependencies
npm install

# start server
npm start

The server listens on http://localhost:3000 and also serves the static HTML files in this folder.

API endpoints (basic):
- POST /api/submit
  body: { name, phone, usd, lee, txRef, screenshot }
  returns: { ok: true, id }

- POST /api/admin/login
  body: { email, password }
  returns: { ok: true, token, email }

- GET /api/admin/submissions  (requires Authorization: Bearer <token>)
- GET /api/admin/balances     (requires token)
- GET /api/admin/transfers    (requires token)
- POST /api/admin/verify      body: { id } (requires token)
- POST /api/admin/reject      body: { id } (requires token)

Security notes:
- This is a minimal demo. The admin credentials are hard-coded in server.js and compared in plaintext. The JWT secret is in code unless you set the environment variable JWT_SECRET.
- Do NOT use this as-is in production. If you want I can harden auth (hash password, environment variables, HTTPS) and deploy serverless.

Next steps I can implement for you:
- Harden auth (bcrypt + env secrets) and store admin account securely
- Deploy to a server (VPS) or serverless (Vercel/Netlify) and update client URLs
- Hook uploads (screenshots) to Cloudinary or S3
- Integrate with a real token contract or custodial ledger

Admin disabled by default
-------------------------
For safety the admin API and UI are disabled by default. To re-enable admin functionality set the environment variable `ADMIN_ENABLED=1` before starting the server. Example (PowerShell):

```powershell
$env:ADMIN_ENABLED='1'
npm start
```

If you just want the UI back, the original admin pages are backed up as `admin.html.disabled` and `admin-login.html.disabled` in the project root. Rename them back to `.html` and enable `ADMIN_ENABLED` to restore the previous admin console.

