const bcrypt = require('bcryptjs');
const db = require('../config/db');

const PUBLIC_ROLES = ['Gym_owners', 'Trainers', 'Members'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

async function register(req, res, next) {
  const connection = await db.getConnection();
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

    const passwordHash = await bcrypt.hash(password, 12);
    await connection.beginTransaction();

    const [userResult] = await connection.execute(
      `INSERT INTO users (username, password_hash, email, role, account_status)
       VALUES (?, ?, ?, ?, 'Pending')`,
      [username, passwordHash, email, role]
    );
    const userId = userResult.insertId;

    if (role === 'Gym_owners') {
      const gymName = requiredText(req.body.gym_name, 'Gym name', 50);
      const location = requiredText(req.body.location, 'Gym location', 255);
      const contactInfo = clean(req.body.contact_info) || null;
      await connection.execute(
        'INSERT INTO gyms (owner_id, gym_name, location, contact_info) VALUES (?, ?, ?, ?)',
        [userId, gymName, location, contactInfo]
      );
    } else if (role === 'Members') {
      const firstName = requiredText(req.body.first_name, 'First name', 50);
      const lastName = requiredText(req.body.last_name, 'Last name', 50);
      await connection.execute(
        `INSERT INTO members
          (user_id, gym_id, first_name, last_name, phone, email, dob, address, medical_cond, photo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          userId, gymId, firstName, lastName,
          clean(req.body.phone) || null,
          email,
          clean(req.body.dob) || null,
          clean(req.body.address) || null,
          clean(req.body.medical_cond) || null,
          clean(req.body.photo) || null
        ]
      );
    } else if (role === 'Trainers') {
      const firstName = requiredText(req.body.first_name, 'First name', 50);
      const lastName = requiredText(req.body.last_name, 'Last name', 50);
      const baseSalary = req.body.base_salary === '' || req.body.base_salary == null ? 0 : Number(req.body.base_salary);
      const commissionRate = req.body.commission_rate === '' || req.body.commission_rate == null ? 0 : Number(req.body.commission_rate);
      const expYears = req.body.exp_years === '' || req.body.exp_years == null ? 0 : Number(req.body.exp_years);
      if (!Number.isFinite(baseSalary) || baseSalary < 0 || !Number.isFinite(commissionRate) || commissionRate < 0 || commissionRate > 100 || !Number.isInteger(expYears) || expYears < 0) {
        throw new Error('Enter valid salary, commission rate (0–100), and experience years.');
      }
      await connection.execute(
        `INSERT INTO trainers
          (user_id, gym_id, first_name, last_name, email, emp_type, base_salary, commission_rate, exp_years, photo_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          userId, gymId, firstName, lastName, email,
          clean(req.body.emp_type) || 'Full-time',
          baseSalary, commissionRate, expYears,
          clean(req.body.photo_url) || null
        ]
      );
    }

    await connection.commit();
    return res.status(201).json({
      message: 'Registration submitted successfully. Your account is Pending approval.',
      account_status: 'Pending'
    });
  } catch (error) {
    await connection.rollback();
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
        ? 'Your account is waiting for approval.'
        : 'This account has been rejected. Contact the gym administrator.';
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

module.exports = { getApprovedGyms, register, login, me, logout };
