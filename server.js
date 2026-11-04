require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const MySQLStoreFactory = require('express-mysql-session');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const db = require('./config/db');
const { requirePageRole } = require('./middleware/auth');

const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const ownerRoutes = require('./routes/ownerRoutes');
const trainerRoutes = require('./routes/trainerRoutes');
const memberRoutes = require('./routes/memberRoutes');

const app = express();
const PORT = Number(process.env.PORT || 8080);
const sessionSecret = process.env.SESSION_SECRET;

if (!sessionSecret || sessionSecret.length < 32) {
  throw new Error('Set SESSION_SECRET in .env to a random value with at least 32 characters.');
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');
app.set('trust proxy', process.env.NODE_ENV === 'production' ? 1 : false);

app.use(helmet());
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor/bootstrap', express.static(path.join(__dirname, 'node_modules/bootstrap/dist')));

const MySQLStore = MySQLStoreFactory(session);
const sessionStore = new MySQLStore({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME,
  clearExpired: true,
  checkExpirationInterval: 15 * 60 * 1000,
  expiration: 24 * 60 * 60 * 1000,
  createDatabaseTable: true,
  schema: { tableName: 'sessions' }
});

app.use(session({
  name: 'gym.sid',
  secret: sessionSecret,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Too many login attempts. Try again after 15 minutes.' }
});
const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Too many registration attempts. Please try again later.' }
});

app.use('/api/auth/login', loginLimiter);
app.use('/api/auth/register', registrationLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/owner', ownerRoutes);
app.use('/api/trainer', trainerRoutes);
app.use('/api/member', memberRoutes);

function redirectForUser(user) {
  if (!user) return '/login';
  const routes = {
    super_admin: '/dashboard/super-admin',
    Gym_owners: '/dashboard/owner',
    Trainers: '/dashboard/trainer',
    Members: '/dashboard/member'
  };
  return routes[user.role] || '/login';
}

app.get('/', (req, res) => res.redirect(redirectForUser(req.session.user)));
app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect(redirectForUser(req.session.user));
  res.render('login', { title: 'Login' });
});
app.get('/register', (req, res) => {
  if (req.session.user) return res.redirect(redirectForUser(req.session.user));
  res.render('register', { title: 'Create account' });
});
app.get('/dashboard', (req, res) => res.redirect(redirectForUser(req.session.user)));
app.get('/dashboard/super-admin', requirePageRole('super_admin'), (req, res) => res.render('superadmin', { title: 'Super Admin Dashboard', currentUser: req.user }));
app.get('/dashboard/owner', requirePageRole('Gym_owners'), (req, res) => res.render('owner', { title: 'Gym Owner Dashboard', currentUser: req.user }));
app.get('/dashboard/trainer', requirePageRole('Trainers'), (req, res) => res.render('trainer', { title: 'Trainer Dashboard', currentUser: req.user }));
app.get('/dashboard/member', requirePageRole('Members'), (req, res) => res.render('member', { title: 'Member Dashboard', currentUser: req.user }));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ message: 'API endpoint not found.' });
  res.status(404).render('login', { title: 'Page not found', pageError: 'The page you requested was not found.' });
});

app.use((error, req, res, next) => {
  // Keep SQL details and stack traces in the server log, never in the browser response.
  console.error('[Application error]', error);
  if (res.headersSent) return next(error);
  const status = error.statusCode || 500;
  res.status(status).json({ message: status === 500 ? 'An unexpected server error occurred.' : error.message });
});

async function start() {
  await db.query('SELECT 1');
  await sessionStore.onReady();
  app.listen(PORT, () => {
    console.log(`Gym Management System running at http://localhost:${PORT}`);
  });
}

start().catch((error) => {
  console.error('Could not start Gym Management System:', error.message);
  process.exit(1);
});

module.exports = app;
