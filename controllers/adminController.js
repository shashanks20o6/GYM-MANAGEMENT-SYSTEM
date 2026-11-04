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
    const [[platformStats]] = await db.execute(
      `SELECT
         COALESCE(SUM(CASE WHEN payment_status = 'Paid' THEN amount ELSE 0 END), 0) AS platformRevenue,
         SUM(CASE WHEN payment_status = 'Paid' AND start_date <= CURDATE() AND end_date >= CURDATE() THEN 1 ELSE 0 END) AS activeSubscriptions,
         SUM(CASE WHEN payment_status = 'Paid' THEN 1 ELSE 0 END) AS paidPlatformPayments
       FROM gym_owner_subscriptions`
    );

    const [gyms] = await db.execute(
      `SELECT g.gym_id, g.gym_name, g.location, g.contact_info,
              u.user_id AS owner_user_id, u.username AS owner_username,
              u.email AS owner_email, u.account_status AS owner_status,
              gos.plan_name_snapshot AS subscription_plan,
              DATE_FORMAT(gos.end_date, '%Y-%m-%d') AS subscription_end_date,
              CASE
                WHEN gos.owner_subscription_id IS NULL THEN 'Not subscribed'
                WHEN gos.payment_status <> 'Paid' THEN gos.payment_status
                WHEN CURDATE() BETWEEN gos.start_date AND gos.end_date THEN 'Active'
                ELSE 'Expired'
              END AS subscription_status
       FROM gyms g
       INNER JOIN users u ON u.user_id = g.owner_id
       LEFT JOIN gym_owner_subscriptions gos ON gos.owner_subscription_id = (
         SELECT gos2.owner_subscription_id
         FROM gym_owner_subscriptions gos2
         WHERE gos2.gym_id = g.gym_id
         ORDER BY gos2.owner_subscription_id DESC
         LIMIT 1
       )
       ORDER BY g.gym_id DESC`
    );

    const [pendingOwnersList] = await db.execute(
      `SELECT u.user_id, u.username, u.email,
              g.gym_id, g.gym_name, g.location, g.contact_info
       FROM users u INNER JOIN gyms g ON g.owner_id = u.user_id
       WHERE u.role = 'Gym_owners' AND u.account_status = 'Pending'
       ORDER BY u.user_id ASC`
    );

    const [subscriptionPlans] = await db.execute(
      `SELECT p.platform_plan_id, p.plan_name, p.description, p.duration_months,
              p.price, p.is_active, p.created_at,
              (SELECT COUNT(*) FROM gym_owner_subscriptions s
               WHERE s.platform_plan_id = p.platform_plan_id AND s.payment_status = 'Paid') AS purchase_count
       FROM platform_subscription_plans p
       ORDER BY p.is_active DESC, p.price ASC, p.platform_plan_id DESC`
    );

    const [platformPayments] = await db.execute(
      `SELECT s.owner_subscription_id, s.transaction_reference,
              s.plan_name_snapshot, s.amount, s.payment_status, s.payment_method,
              DATE_FORMAT(s.start_date, '%Y-%m-%d') AS start_date,
              DATE_FORMAT(s.end_date, '%Y-%m-%d') AS end_date,
              DATE_FORMAT(s.paid_at, '%Y-%m-%d %H:%i:%s') AS paid_at, s.created_at,
              g.gym_name, u.username AS owner_username, u.email AS owner_email,
              CASE
                WHEN s.payment_status <> 'Paid' THEN s.payment_status
                WHEN CURDATE() BETWEEN s.start_date AND s.end_date THEN 'Active'
                ELSE 'Expired'
              END AS subscription_status
       FROM gym_owner_subscriptions s
       INNER JOIN gyms g ON g.gym_id = s.gym_id
       INNER JOIN users u ON u.user_id = g.owner_id
       ORDER BY s.created_at DESC, s.owner_subscription_id DESC
       LIMIT 100`
    );

    res.json({
      stats: {
        totalGyms,
        pendingOwners,
        approvedOwners,
        platformRevenue: platformStats.platformRevenue || 0,
        activeSubscriptions: platformStats.activeSubscriptions || 0,
        paidPlatformPayments: platformStats.paidPlatformPayments || 0
      },
      gyms,
      pendingOwners: pendingOwnersList,
      subscriptionPlans,
      platformPayments
    });
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

async function createSubscriptionPlan(req, res, next) {
  try {
    const name = String(req.body.plan_name || '').trim();
    const description = String(req.body.description || '').trim();
    const duration = Number(req.body.duration_months);
    const price = Number(req.body.price);

    if (!name || name.length > 100 || description.length > 255 ||
        !Number.isInteger(duration) || duration < 1 || duration > 120 ||
        !Number.isFinite(price) || price <= 0 || price > 99999999.99) {
      return res.status(400).json({
        message: 'Enter a plan name, description up to 255 characters, duration from 1–120 months, and a price greater than zero.'
      });
    }

    const [result] = await db.execute(
      `INSERT INTO platform_subscription_plans
         (plan_name, description, duration_months, price, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [name, description || null, duration, price, req.user.user_id]
    );
    res.status(201).json({ message: 'Gym Owner subscription plan created.', platform_plan_id: result.insertId });
  } catch (error) {
    next(error);
  }
}

async function setSubscriptionPlanStatus(req, res, next) {
  const planId = Number(req.params.planId);
  const input = req.body.is_active;
  const isActive = input === true || input === 1 || input === '1' || input === 'true';
  const isInactive = input === false || input === 0 || input === '0' || input === 'false';

  if (!Number.isInteger(planId) || planId <= 0 || (!isActive && !isInactive)) {
    return res.status(400).json({ message: 'Provide a valid plan ID and is_active value.' });
  }

  try {
    const [result] = await db.execute(
      'UPDATE platform_subscription_plans SET is_active = ? WHERE platform_plan_id = ?',
      [isActive ? 1 : 0, planId]
    );
    if (!result.affectedRows) return res.status(404).json({ message: 'Subscription plan was not found.' });
    res.json({ message: isActive ? 'Subscription plan activated.' : 'Subscription plan deactivated.' });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getOverview,
  reviewOwner,
  createSubscriptionPlan,
  setSubscriptionPlanStatus
};
