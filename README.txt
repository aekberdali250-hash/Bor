Bor Reward App — Multilingual Homepage Build
===========================================

What is included
- Responsive Arabic RTL homepage with navy/gold visual design.
- Language selector for Arabic, French, English, Spanish, and German.
- Remembers the selected language on the same device.
- Automatically switches page direction for Arabic (RTL) and other languages (LTR).
- Registration form connected to the existing POST /api/users endpoint.
- Active partner list connected to GET /api/companies.
- AdGem offerwall link for a registered Bor user (app ID 33787), shown only when AdGem is active.
- Clear, cautious wording: no guaranteed earnings or claims that cash withdrawals are already enabled.
- Existing server.js, admin pages, and package.json retained from the supplied project.

IMPORTANT BEFORE DEPLOYMENT
This ZIP is an update to the existing Bor project, not a standalone APK and not a replacement database.
Do not delete the Render PostgreSQL database or create a new service just to install this homepage.

Recommended deployment method
1. Keep the existing GitHub repository aekberdali250-hash/Bor and branch Bormain.
2. Download and extract this ZIP on a computer or phone.
3. Replace only index.html in the existing repository with the index.html from this ZIP.
4. If you want to update documentation, replace README.txt too. Do not replace server.js or package.json unless you intentionally reviewed those files; this build preserves them for completeness.
5. Commit the change to branch Bormain. If Render is connected to that branch, wait for the automatic deploy to finish.
6. Open https://bor-1-434u.onrender.com and refresh. If an old cached page appears, reload the page or open it in a private tab.

Keep these Render settings
- DATABASE_URL: keep the existing value.
- ADMIN_PASSWORD: keep configured and private.
- SESSION_SECRET: keep configured and private.
- Build command: npm install (or the current working build command).
- Start command: npm start.
- Do not change the AdGem postback URL or signing secret based only on this homepage update.

Testing checklist after deployment
1. Confirm the homepage opens on phone and desktop.
2. Change language to French, English, Spanish, German, then Arabic; verify that selection persists after refresh.
3. Verify that Arabic uses RTL and the other languages use LTR.
4. Register with an email you have not used before; check duplicate-email handling with an existing email.
5. Confirm active companies load from the server.
6. Confirm AdGem opens only after the account is created and AdGem is active in admin.
7. Test admin login and the existing admin functions.
8. Do not advertise cash payouts until payout terms/methods are actually configured and tested.

Important limitations
- This update improves the public homepage and adds interface translations; it does not add secure user login, password-based accounts, account recovery, or a payout system.
- The current prototype stores the Bor user ID in localStorage. That is not secure authentication and should be improved before public-scale launch.
- The AdGem postback payload/signature and real reward crediting must be verified against AdGem's current integration requirements, including a successful test conversion, before treating rewards as live.
- Availability of offers depends on partner approval, user eligibility, and country.
