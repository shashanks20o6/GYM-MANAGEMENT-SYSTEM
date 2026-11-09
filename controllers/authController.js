const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../config/db');

const PUBLIC_ROLES = ['Gym_owners', 'Trainers', 'Members'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PLATFORM_PAYMENT_METHODS = ['UPI', 'Card', 'NetBanking', 'Bank Transfer', 'Cash'];

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function requiredText(value, label, max = 255) {
  const text = clean(value);
  if (!text || text.length > max) throw new Error(`${label} is required and must be at most ${max} characters.`);
  return text;
}

async function getApprovedGyms(req, res, next) {
  try {
    const [gyms] = await db.execute(
      `SELECT g.gym_id, g.gym_name, g.location
       FROM gyms g
       INNER JOIN users owner ON owner.user_id = g.owner_id
       WHERE owner.role = 'Gym_owners' AND owner.account_status = 'Approved'
       ORDER BY g.gym_name`
    );
    res.json({ gyms });
  } catch (error) {
    next(error);
  }
}

async function getPublicPlatformPlans(req, res, next) {
  try {
    const [plans] = await db.execute(
      `SELECT platform_plan_id, plan_name, description, duration_months, price
       FROM platform_subscription_plans
       WHERE is_active = 1
       ORDER BY price ASC, duration_months ASC`
    );
    res.json({ plans });
  } catch (error) {
    next(error);
  }
}

async function register(req, res, next) {
  const connection = await db.getConnection();
  let transactionStarted = false;
  try {
    const role = clean(req.body.role);
    if (!PUBLIC_ROLES.includes(role)) {
      return res.status(400).json({ message: 'Choose Gym Owner, Trainer, or Member. Super Admin accounts are created privately.' });
    }

    const username = requiredText(req.body.username, 'Username', 50);
    const email = requiredText(req.body.email, 'Email', 255).toLowerCase();
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (!EMAIL_RE.test(email)) return res.status(400).json({ message: 'Enter a valid email address.' });
    if (password.length < 8 || password.length > 72) {
      return res.status(400).json({ message: 'Password must be between 8 and 72 characters.' });
    }

    const [existing] = await connection.execute(
      'SELECT user_id FROM users WHERE username = ? OR email = ? LIMIT 1',
      [username, email]
    );
    if (existing.length) return res.status(409).json({ message: 'That username or email is already registered.' });

    let gymId = null;
    let gymOwnerProfile = null;
    let selectedPlatformPlan = null;
    let platformPaymentMethod = null;

    if (role === 'Gym_owners') {
      gymOwnerProfile = {
        gymName: requiredText(req.body.gym_name, 'Gym name', 50),
        location: requiredText(req.body.location, 'Gym location', 255),
        contactInfo: clean(req.body.contact_info) || null
      };
      const platformPlanId = Number(req.body.platform_plan_id);
      platformPaymentMethod = clean(req.body.payment_method);
      if (!Number.isInteger(platformPlanId) || platformPlanId <= 0 || !PLATFORM_PAYMENT_METHODS.includes(platformPaymentMethod)) {
        return res.status(400).json({ message: 'Choose a platform subscription plan and a valid demo payment method.' });
      }
      const [planRows] = await connection.execute(
        `SELECT platform_plan_id, plan_name, duration_months, price
         FROM platform_subscription_plans
         WHERE platform_plan_id = ? AND is_active = 1`,
        [platformPlanId]
      );
      if (!planRows.length) return res.status(400).json({ message: 'The selected platform subscription plan is unavailable. Refresh and choose another plan.' });
      selectedPlatformPlan = planRows[0];
    }

    if (role === 'Members' || role === 'Trainers') {
      gymId = Number(req.body.gym_id);
      if (!Number.isInteger(gymId) || gymId <= 0) {
        return res.status(400).json({ message: 'Select an approved gym.' });
      }
      const [approvedGym] = await connection.execute(
        `SELECT g.gym_id FROM gyms g
         INNER JOIN users owner ON owner.user_id = g.owner_id
         WHERE g.gym_id = ? AND owner.role = 'Gym_owners' AND owner.account_status = 'Approved'`,
        [gymId]
      );
      if (!approvedGym.length) return res.status(400).json({ message: 'The selected gym is not available for registration.' });
    }

    let trainerProfile = null;
    if (role === 'Trainers') {
      const baseSalary = req.body.base_salary === '' || req.body.base_salary == null ? NaN : Number(req.body.base_salary);
      const commissionRate = req.body.commission_rate === '' || req.body.commission_rate == null ? 0 : Number(req.body.commission_rate);
      const expYears = req.body.exp_years === '' || req.body.exp_years == null ? 0 : Number(req.body.exp_years);
      if (!Number.isFinite(baseSalary) || baseSalary <= 0 || baseSalary > 99999999.99 ||
          !Number.isFinite(commissionRate) || commissionRate < 0 || commissionRate > 100 ||
          !Number.isInteger(expYears) || expYears < 0) {
        throw new Error('Enter a trainer base salary greater than zero, commission rate (0–100), and valid experience years.');
      }
      trainerProfile = {
        firstName: requiredText(req.body.first_name, 'First name', 50),
        lastName: requiredText(req.body.last_name, 'Last name', 50),
        baseSalary,
        commissionRate,
        expYears,
        empType: clean(req.body.emp_type) || 'Full-time',
        photoUrl: clean(req.body.photo_url) || null
      };
    }

    let memberProfile = null;
    if (role === 'Members') {
      memberProfile = {
        firstName: requiredText(req.body.first_name, 'First name', 50),
        lastName: requiredText(req.body.last_name, 'Last name', 50),
        phone: clean(req.body.phone) || null,
        dob: clean(req.body.dob) || null,
        address: clean(req.body.address) || null,
        medicalCondition: clean(req.body.medical_cond) || null,
        photo: clean(req.body.photo) || null
      };
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await connection.beginTransaction();
    transactionStarted = true;

    const [userResult] = await connection.execute(
      `INSERT INTO users (username, password_hash, email, role, account_status)
       VALUES (?, ?, ?, ?, 'Pending')`,
      [username, passwordHash, email, role]
    );
    const userId = userResult.insertId;

    if (role === 'Gym_owners') {
      const [gymResult] = await connection.execute(
        'INSERT INTO gyms (owner_id, gym_name, location, contact_info) VALUES (?, ?, ?, ?)',
        [userId, gymOwnerProfile.gymName, gymOwnerProfile.location, gymOwnerProfile.contactInfo]
      );
      const newGymId = gymResult.insertId;
      const transactionReference = `REG-DEMO-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
      await connection.execute(
        `INSERT INTO gym_owner_subscriptions
          (gym_id, platform_plan_id, plan_name_snapshot, duration_months_snapshot,
           amount, start_date, end_date, payment_status, payment_method,
           transaction_reference, paid_at, owner_review_status, refund_status)
         VALUES (?, ?, ?, ?, ?, CURDATE(),
                 DATE_SUB(DATE_ADD(CURDATE(), INTERVAL ? MONTH), INTERVAL 1 DAY),
                 'Paid', ?, ?, NOW(), 'Pending', 'NotApplicable')`,
        [
          newGymId,
          selectedPlatformPlan.platform_plan_id,
          selectedPlatformPlan.plan_name,
          selectedPlatformPlan.duration_months,
          selectedPlatformPlan.price,
          selectedPlatformPlan.duration_months,
          platformPaymentMethod,
          transactionReference
        ]
      );
    } else if (role === 'Members') {
      await connection.execute(
        `INSERT INTO members
          (user_id, gym_id, first_name, last_name, phone, email, dob, address, medical_cond, photo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, gymId, memberProfile.firstName, memberProfile.lastName,
          memberProfile.phone, email, memberProfile.dob, memberProfile.address,
          memberProfile.medicalCondition, memberProfile.photo]
      );
    } else if (role === 'Trainers') {
      await connection.execute(
        `INSERT INTO trainers
          (user_id, gym_id, first_name, last_name, email, emp_type, base_salary, commission_rate, exp_years, photo_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, gymId, trainerProfile.firstName, trainerProfile.lastName, email,
          trainerProfile.empType, trainerProfile.baseSalary, trainerProfile.commissionRate,
          trainerProfile.expYears, trainerProfile.photoUrl]
      );
    }

    await connection.commit();
    transactionStarted = false;

    const message = role === 'Gym_owners'
      ? 'Demo subscription payment recorded and Gym Owner registration submitted. The Super Admin must review your application; your account remains Pending until approval.'
      : 'Registration submitted successfully. Your account is Pending approval.';
    return res.status(201).json({ message, account_status: 'Pending' });
  } catch (error) {
    if (transactionStarted) await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'That username or email is already registered.' });
    if (error.message && !error.code && !error.sql) return res.status(400).json({ message: error.message });
    next(error);
  } finally {
    connection.release();
  }
}

async function login(req, res, next) {
  try {
    const identity = clean(req.body.identity);
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (!identity || !password) return res.status(400).json({ message: 'Enter your username/email and password.' });

    const [rows] = await db.execute(
      `SELECT user_id, username, email, password_hash, role, account_status
       FROM users WHERE username = ? OR email = ? LIMIT 1`,
      [identity, identity.toLowerCase()]
    );
    if (!rows.length) return res.status(401).json({ message: 'Invalid username/email or password.' });

    const account = rows[0];
    const passwordMatches = await bcrypt.compare(password, account.password_hash);
    if (!passwordMatches) return res.status(401).json({ message: 'Invalid username/email or password.' });
    if (account.account_status !== 'Approved') {
      const message = account.account_status === 'Pending'
        ? 'Your account is waiting for approval. If you registered as a Gym Owner, your demo payment is awaiting review.'
        : 'This account has been rejected. Contact the platform administrator.';
      return res.status(403).json({ message, account_status: account.account_status });
    }

    await new Promise((resolve, reject) => {
      req.session.regenerate((error) => error ? reject(error) : resolve());
    });

    const user = {
      user_id: account.user_id,
      username: account.username,
      email: account.email,
      role: account.role,
      account_status: account.account_status
    };
    req.session.user = user;
    await new Promise((resolve, reject) => req.session.save((error) => error ? reject(error) : resolve()));

    const redirectByRole = {
      super_admin: '/dashboard/super-admin',
      Gym_owners: '/dashboard/owner',
      Trainers: '/dashboard/trainer',
      Members: '/dashboard/member'
    };
    res.json({ message: 'Login successful.', user, redirect: redirectByRole[user.role] });
  } catch (error) {
    next(error);
  }
}

async function me(req, res) {
  if (!req.session || !req.session.user) return res.status(401).json({ message: 'Not logged in.' });
  res.json({ user: req.session.user });
}

async function logout(req, res, next) {
  if (!req.session) return res.json({ message: 'Logged out.' });
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie('gym.sid');
    res.json({ message: 'Logged out.' });
  });
}

module.exports = { getApprovedGyms, getPublicPlatformPlans, register, login, me, logout };
