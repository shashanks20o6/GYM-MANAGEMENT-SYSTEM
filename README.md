# FitTrack — Gym Management System

A multi-role gym management mini project using Node.js, Express 5, EJS, Bootstrap 5, Vanilla JavaScript and MySQL (`mysql2/promise`). The project follows the 12 business tables in the supplied ER diagram.

## 1. Requirements

- Node.js 20 or newer
- MySQL 8.0 or newer (MySQL Workbench is optional)
- npm

## 2. Create the database

Open MySQL Workbench, open `sql/schema.sql`, and execute the complete script. It creates the `gym_db` database and the 12 application tables. The session middleware automatically creates one additional technical table named `sessions`; it stores signed-in sessions and is not an extra business entity in your ER diagram.

> The script uses `CREATE TABLE IF NOT EXISTS`, so it does not drop existing tables or dummy data. It will not alter a table that already exists; check that your existing columns and ENUM values match the application.

## 3. Configure `.env`

Fill in the empty values in the included `.env` file. Example for a local MySQL server:

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

- **Super Admin:** review Gym Owners, view gyms and owner statuses.
- **Gym Owner:** approve Members/Trainers for their own gym, create membership plans and workout videos, review payments and trainer attendance.
- **Trainer:** record daily clock-in/clock-out, review workout requests, accept/reject requests, and assign plans with exercises from the gym's video library.
- **Member:** view profile, buy/renew a plan, view recorded payments, request a trainer plan and view assigned exercises/videos.

## 8. Important implementation notes

- SQL operations use prepared statements (`?` placeholders). Table/column names are fixed in the source; user input is never interpolated into SQL identifiers.
- Passwords are stored as bcrypt hashes in `users.password_hash`.
- The browser stores a minimal `user` object in `localStorage` for display only. Authentication and role authorization are enforced by a server-side session cookie marked `HttpOnly`; editing local storage does not grant permissions.
- Member subscription checkout is a **demo payment record**, not a real payment gateway. The selected method is recorded as `Paid`; integrate a provider such as Razorpay/Stripe and verify its server-side payment signature before accepting real money.
- For production deployment, use HTTPS, a strong session secret, a least-privilege MySQL account, backups, environment-specific monitoring, input validation review, and a real payment provider. Configure secure cookies and trusted proxy settings for your hosting environment.

## 9. Project structure

```text
gym-management-system/
├── .env
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
└── scripts/createSuperAdmin.js
```

## 10. Troubleshooting

- `ECONNREFUSED` or `ETIMEDOUT`: make sure MySQL Server is running, `DB_HOST` is correct, and MySQL is listening on `DB_PORT` (normally `3306`). Express `PORT=8080` is the web server port; it is not the MySQL port.
- `Unknown database 'gym_db'`: run `sql/schema.sql` first and check `DB_NAME`.
- `Access denied`: check `DB_USER`, `DB_PASSWORD`, and the MySQL user's privileges on `gym_db`.
- `SESSION_SECRET` error: fill it with a random value of at least 32 characters.
- If you change the MySQL schema, update the corresponding controller queries and keep the foreign-key relationships consistent.
