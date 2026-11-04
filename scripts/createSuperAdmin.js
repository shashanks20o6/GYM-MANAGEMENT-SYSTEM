require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../config/db');

async function main() {
  const [username, emailArg, password] = process.argv.slice(2);
  if (!username || !emailArg || !password) {
    console.error('Usage: npm run create-admin -- <username> <email> <password>');
    process.exitCode = 1;
    return;
  }
  const email = emailArg.trim().toLowerCase();
  if (username.length > 50 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8 || password.length > 72) {
    console.error('Use a username up to 50 characters, a valid email, and a password between 8 and 72 characters.');
    process.exitCode = 1;
    return;
  }

  try {
    const [existing] = await db.execute('SELECT user_id FROM users WHERE username = ? OR email = ? LIMIT 1', [username, email]);
    if (existing.length) throw new Error('A user with this username or email already exists.');
    const hash = await bcrypt.hash(password, 12);
    const [result] = await db.execute(
      "INSERT INTO users (username, password_hash, email, role, account_status) VALUES (?, ?, ?, 'super_admin', 'Approved')",
      [username, hash, email]
    );
    console.log(`Super Admin created successfully. user_id=${result.insertId}`);
  } catch (error) {
    console.error('Could not create Super Admin:', error.message);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
}

main();
