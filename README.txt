Bor Reward App — safer test build

Files in repository root:
- package.json
- server.js
- index.html
- admin.html
- admin-login.html
- README.txt

Render settings:
- Build Command: npm install
- Start Command: npm start
- Keep the existing DATABASE_URL unchanged.
- Add ADMIN_PASSWORD: a long unique password for the administrator.
- Add SESSION_SECRET: a long random secret (at least 32 characters).
- Keep NODE_ENV=production if it is already set.

Admin:
- Login page: /admin/login
- Admin dashboard: /admin (requires login)
- Admin-only endpoints include statistics, user listing/details, transactions, manual rewards, and adding companies.
- Public users can still register and the public homepage can list companies.

Database safety:
- The app uses CREATE TABLE IF NOT EXISTS and does not drop existing tables.
- Do not delete or recreate the existing PostgreSQL database.
- Take a backup before deploying any update.

Important limitations:
- This build adds an administrator session gate; it does not yet implement individual user login/accounts.
- AdGem postback signature and payload assumptions must be verified against the exact AdGem integration settings/docs before real rewards are enabled. Do not claim real earnings until a verified test conversion succeeds.
- The postback currently expects a signed JSON body, a Signature header, data.player_id containing the numeric Bor user ID, data.conversion_id, and integer data.amount. Confirm these fields with AdGem before configuring the postback.
- Set ADMIN_PASSWORD and SESSION_SECRET in Render before using the admin page.
