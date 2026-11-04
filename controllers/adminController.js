const db = require('../config/db');

async function getOverview(req, res, next) {
  try {
    const [[{ totalGyms }]] = await db.execute('SELECT COUNT(*) AS totalGyms FROM gyms');
    const [[{ pendingOwners }]] = await db.execute(
      "SELECT COUNT(*) AS pendingOwners FROM users WHERE role = 'Gym_owners' AND account_status = 'Pending'"
    );
    const [[{ approvedOwners }]] = await db.execute(
      "SELECT COUNT(*) AS approvedOwners FROM users WHERE role = 'Gym_owners' AND account_status = 'Approved'"
    );
    const [gyms] = await db.execute(
      `SELECT g.gym_id, g.gym_name, g.location, g.contact_info,
              u.user_id AS owner_user_id, u.username AS owner_username,
              u.email AS owner_email, u.account_status AS owner_status
       FROM gyms g INNER JOIN users u ON u.user_id = g.owner_id
       ORDER BY g.gym_id DESC`
    );
    const [pendingOwnersList] = await db.execute(
      `SELECT u.user_id, u.username, u.email,
              g.gym_id, g.gym_name, g.location, g.contact_info
       FROM users u INNER JOIN gyms g ON g.owner_id = u.user_id
       WHERE u.role = 'Gym_owners' AND u.account_status = 'Pending'
       ORDER BY u.user_id ASC`
    );
    res.json({ stats: { totalGyms, pendingOwners, approvedOwners }, gyms, pendingOwners: pendingOwnersList });
  } catch (error) {
    next(error);
  }
}

async function reviewOwner(req, res, next) {
  const userId = Number(req.params.userId);
  const action = req.params.action;
  if (!Number.isInteger(userId) || userId <= 0 || !['approve', 'reject'].includes(action)) {
    return res.status(400).json({ message: 'Invalid owner review request.' });
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      "SELECT user_id FROM users WHERE user_id = ? AND role = 'Gym_owners' AND account_status = 'Pending' FOR UPDATE",
      [userId]
    );
    if (!rows.length) {
      await connection.rollback();
      return res.status(404).json({ message: 'Pending Gym Owner account was not found.' });
    }

    if (action === 'approve') {
      await connection.execute("UPDATE users SET account_status = 'Approved' WHERE user_id = ?", [userId]);
    } else {
      // A rejected owner must not leave an unapproved gym visible in the system.
      await connection.execute('DELETE FROM gyms WHERE owner_id = ?', [userId]);
      await connection.execute("UPDATE users SET account_status = 'Rejected' WHERE user_id = ?", [userId]);
    }
    await connection.commit();
    res.json({ message: action === 'approve' ? 'Gym Owner approved.' : 'Gym Owner rejected.' });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
}

module.exports = { getOverview, reviewOwner };
