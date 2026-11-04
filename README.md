# FitTrack — Gym Management System

A multi-role gym management mini project using Node.js, Express 5, EJS, Bootstrap 5, Vanilla JavaScript and MySQL (`mysql2/promise`). The project keeps the 12 business tables in the supplied ER diagram and adds two separate tables for Gym Owner platform billing.

## 1. Requirements

- Node.js 20 or newer
- MySQL 8.0 or newer (MySQL Workbench is optional)
- npm

## 2. Create the database

Open MySQL Workbench, open `sql/schema.sql`, and execute the complete script. It creates the `gym_db` database and the 12 application tables. The session middleware automatically creates one additional technical table named `sessions`; it stores signed-in sessions and is not an extra business entity in your ER diagram.

> The script uses `CREATE TABLE IF NOT EXISTS`, so it does not drop existing tables or dummy data. It will not alter a table that already exists; check that your existing columns and ENUM values match the application. If you already created the original 12 tables, do not rerun the base schema just for the new platform billing feature; run the migration described below.

## 3. Configure `.env`

Copy `.env.example` to `.env`, then fill in the values in `.env`. In PowerShell, run `Copy-Item .env.example .env`. Example for a local MySQL server:

```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=gym_db
SESSION_SECRET=paste_a_long_random_secret_here
PORT=8080
NODE_ENV=development
```

Generate a session secret in PowerShell:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Use the generated value for `SESSION_SECRET`. Do not commit `.env` to Git.

## 4. Install and start

From the project root (`gym-management-system`):

```powershell
npm install
npm run dev
```

Open `http://localhost:8080` in your browser. For a normal start without auto-reload, use `npm start`.

## 5. Create the first Super Admin

Public registration intentionally does not offer the Super Admin role. Create the first administrator from PowerShell:

```powershell
npm run create-admin -- superadmin admin@example.com "ChooseAStrongPassword123"
```

Sign in at `/login`. As Super Admin, approve Gym Owner registrations. A Gym Owner can then approve their own gym's pending Members and Trainers.

## 6. Registration and approval workflow

1. A Gym Owner registers with gym details. A pending user and linked `gyms` row are created in one database transaction.
2. Super Admin approves or rejects the Gym Owner. A rejected owner keeps the audit row in `users`, while the unapproved `gyms` profile is removed.
3. Only gyms whose owner account is `Approved` appear in the Member and Trainer registration dropdowns. The ER diagram has no `gym_status` column, so the linked owner's account status is used as the approval source of truth.
4. A Member or Trainer registers against one approved `gym_id`. The user and child profile are inserted in one transaction.
5. Gym Owner approval/rejection is restricted to pending Member/Trainer profiles linked to that owner's `gym_id`. Rejection removes the operational child row but retains the rejected `users` row for audit.

## 7. Main features

- **Super Admin:** review Gym Owners, view gyms and owner statuses, create/activate/deactivate Gym Owner platform subscription plans, view platform payment history and total platform subscription revenue.
- **Gym Owner:** purchase/renew a FitTrack platform subscription, view its active/expired period and payment history; approve Members/Trainers for their own gym, create membership plans and workout videos, review member payments and trainer attendance.
- **Trainer:** record daily clock-in/clock-out, review workout requests, accept/reject requests, and assign plans with exercises from the gym's video library.
- **Member:** view profile, buy/renew a plan, view recorded payments, request a trainer plan and view assigned exercises/videos.

## 8. Gym Owner platform subscriptions (new feature)

This is a platform-level subscription paid by a Gym Owner to the FitTrack platform. It is separate from `membership_plans` and `payments`, which are used for a gym's own members.

### Existing database: apply only the new migration

If your MySQL Workbench database already has the original 12 business tables and dummy data:

1. Open `sql/migrations/001_platform_subscriptions.sql` in MySQL Workbench.
2. Confirm the selected schema is `gym_db` (the script also contains `USE gym_db`).
3. Execute the script. It creates only `platform_subscription_plans` and `gym_owner_subscriptions`; it does not delete or modify your existing 12 tables or their records.
4. Restart the Node.js app with `npm run dev`.

The Super Admin can then create plans. Approved Gym Owners see active plans and can use the demo checkout. Super Admin sees total revenue from rows whose `payment_status` is `Paid`, active subscriptions, each gym's latest subscription status, and the payment history.

### Demo checkout limitation

The current checkout is deliberately a **demo transaction**: the server reads the price from the selected plan in MySQL and records a test payment as `Paid`. The browser does not choose the price. No real money is collected. Before real deployment, replace this demo endpoint with a payment gateway integration and verify the gateway's signed server-side payment confirmation/webhook before marking a subscription `Paid`.

## 9. Important implementation notes

- SQL operations use prepared statements (`?` placeholders). Table/column names are fixed in the source; user input is never interpolated into SQL identifiers.
- Passwords are stored as bcrypt hashes in `users.password_hash`.
- The browser stores a minimal `user` object in `localStorage` for display only. Authentication and role authorization are enforced by a server-side session cookie marked `HttpOnly`; editing local storage does not grant permissions.
- Member subscription checkout is a **demo payment record**, not a real payment gateway. The selected method is recorded as `Paid`; integrate a provider such as Razorpay/Stripe and verify its server-side payment signature before accepting real money.
- For production deployment, use HTTPS, a strong session secret, a least-privilege MySQL account, backups, environment-specific monitoring, input validation review, and a real payment provider. Configure secure cookies and trusted proxy settings for your hosting environment.

## 10. Project structure

```text
gym-management-system/
├── .env.example  # copy to .env and fill in local credentials
├── package.json
├── server.js
├── config/db.js
├── middleware/auth.js
├── routes/
│   ├── authRoutes.js
│   ├── adminRoutes.js
│   ├── ownerRoutes.js
│   ├── trainerRoutes.js
│   └── memberRoutes.js
├── controllers/
│   ├── authController.js
│   ├── adminController.js
│   ├── ownerController.js
│   ├── trainerController.js
│   └── memberController.js
├── views/
│   ├── login.ejs
│   ├── register.ejs
│   ├── superadmin.ejs
│   ├── owner.ejs
│   ├── trainer.ejs
│   ├── member.ejs
│   └── partials/nav.ejs
├── public/css/styles.css
├── public/js/app.js
├── sql/schema.sql
├── sql/migrations/001_platform_subscriptions.sql
├── .env.example
└── scripts/createSuperAdmin.js
```

## 11. Troubleshooting

- `ECONNREFUSED` or `ETIMEDOUT`: make sure MySQL Server is running, `DB_HOST` is correct, and MySQL is listening on `DB_PORT` (normally `3306`). Express `PORT=8080` is the web server port; it is not the MySQL port.
- `Unknown database 'gym_db'`: run `sql/schema.sql` first and check `DB_NAME`.
- `Access denied`: check `DB_USER`, `DB_PASSWORD`, and the MySQL user's privileges on `gym_db`.
- `SESSION_SECRET` error: fill it with a random value of at least 32 characters.
- If you change the MySQL schema, update the corresponding controller queries and keep the foreign-key relationships consistent.
