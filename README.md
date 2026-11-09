# FitTrack Gym Management System

A multi-role Gym Management System built with Node.js, Express, EJS, Bootstrap 5, vanilla JavaScript and MySQL (`mysql2/promise`).

## Existing database

This project uses the `gym_db` MySQL database. The original 12 gym-management tables remain in place. Do not drop the database or rerun a destructive schema script over existing data.

For an existing installation that already ran `sql/migrations/001_platform_subscriptions.sql`, run this new migration once in MySQL Workbench:

```text
sql/migrations/002_registration_refunds_and_trainer_payroll.sql
```

It adds approval/refund tracking fields to `gym_owner_subscriptions` and creates `trainer_salary_payments`.

## New workflows

### Gym Owner paid registration

1. Super Admin creates one or more platform subscription plans.
2. The Gym Owner selects a plan and a demo payment method during registration.
3. The system creates the user, gym and paid platform-subscription record in one database transaction.
4. The Gym Owner account remains `Pending`; they cannot log in until the Super Admin approves it.
5. On approval, the subscription term starts on the approval date.
6. On rejection, the gym and payment history are retained. The payment becomes eligible for a refund record.
7. The Super Admin can choose **Record refund** in platform payment history. The payment changes from `Paid` to `Refunded`, reducing net platform revenue.

### Trainer monthly salary

- Trainer registration captures a positive monthly `base_salary`.
- A Gym Owner can record that trainer's salary for a selected month.
- The server reads the salary from the trainer's saved database record; the browser cannot choose the amount.
- The unique key on `(train_id, salary_month)` prevents a duplicate payment for the same trainer and month.
- Gym net revenue is calculated as paid member payments minus recorded paid trainer salaries.

### Workout request and delivery

1. A member submits a request to an approved trainer.
2. The trainer must accept or reject the request.
3. Only an accepted request can receive a workout plan.
4. The trainer adds exercises, picks videos from the gym's video library, and specifies workout section, sets and reps.
5. Assignment marks the request `Completed`; the plan and linked video URLs appear in the member dashboard.

## Demo-payment limitation

Payments and refunds in this project are demo ledger records. Selecting UPI/Card/Net Banking/Cash does not move real funds. Before collecting real money, integrate a payment gateway, verify payment callbacks/webhooks on the server, and issue refunds through the gateway's refund API. Do not treat a client-side success response as proof of an actual payment.

## Environment

Copy `.env.example` to `.env` and fill in your own MySQL settings and a random session secret. Never commit `.env` to GitHub.

```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=gym_db
SESSION_SECRET=
PORT=8080
NODE_ENV=development
```

## Install and run

```powershell
npm install
npm run dev
```

Open `http://localhost:8080`.

## Super Admin

If a Super Admin has not already been created, use the project's setup script:

```powershell
npm run create-admin -- superadmin admin@example.com "StrongPassword123"
```

## Main test sequence

1. Sign in as Super Admin and create a platform subscription plan.
2. Register a new Gym Owner and select the plan/payment method.
3. Confirm the registration payment appears in Super Admin platform payments and net platform revenue.
4. Approve the owner; confirm the term begins on approval date and the owner can log in.
5. Register a second Gym Owner and reject that registration. Record a refund and confirm net platform revenue decreases by the refunded amount.
6. As the approved owner, approve a trainer with a positive base salary and a member.
7. Create a member membership plan; let the member purchase it.
8. Pay the trainer's salary for a month and verify net gym revenue = member payments - trainer salary payments.
9. Have the member submit a workout request; accept it as trainer; add exercises/videos and assign the plan. Refresh the member dashboard and confirm the plan appears.

## Key folders

- `config/` – MySQL connection pool
- `controllers/` – business logic and parameterized SQL
- `routes/` – Express API routes
- `middleware/` – authentication and role authorization
- `views/` – EJS pages
- `public/` – CSS and browser JavaScript
- `sql/migrations/` – incremental database changes
