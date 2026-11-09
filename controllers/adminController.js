const crypto = require('crypto');
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
         COALESCE(SUM(CASE WHEN payment_status IN ('Paid', 'Refunded') THEN amount ELSE 0 END), 0) AS grossCollected,
         COALESCE(SUM(CASE WHEN payment_status = 'Refunded' THEN amount ELSE 0 END), 0) AS totalRefunded,
         COALESCE(SUM(CASE WHEN payment_status = 'Paid' AND owner_review_status = 'Approved'
                                AND start_date <= CURDATE() AND end_date >= CURDATE() THEN 1 ELSE 0 END), 0) AS activeSubscriptions,
         COALESCE(SUM(CASE WHEN payment_status = 'Paid' THEN 1 ELSE 0 END), 0) AS paidPlatformPayments
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
                WHEN gos.owner_review_status = 'Pending' THEN 'Awaiting approval'
                WHEN gos.payment_status = 'Refunded' THEN 'Refunded'
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
              g.gym_id, g.gym_name, g.location, g.contact_info,
              s.owner_subscription_id, s.plan_name_snapshot, s.amount,
              s.payment_method, s.payment_status, s.transaction_reference,
              DATE_FORMAT(s.paid_at, '%Y-%m-%d %H:%i:%s') AS paid_at
       FROM users u
       INNER JOIN gyms g ON g.owner_id = u.user_id
       LEFT JOIN gym_owner_subscriptions s ON s.owner_subscription_id = (
         SELECT s2.owner_subscription_id FROM gym_owner_subscriptions s2
         WHERE s2.gym_id = g.gym_id ORDER BY s2.owner_subscription_id DESC LIMIT 1
       )
       WHERE u.role = 'Gym_owners' AND u.account_status = 'Pending'
       ORDER BY u.user_id ASC`
    );

    const [subscriptionPlans] = await db.execute(
      `SELECT p.platform_plan_id, p.plan_name, p.description, p.duration_months,
              p.price, p.is_active, p.created_at,
              (SELECT COUNT(*) FROM gym_owner_subscriptions s
               WHERE s.platform_plan_id = p.platform_plan_id AND s.payment_status IN ('Paid', 'Refunded')) AS purchase_count
       FROM platform_subscription_plans p
       ORDER BY p.is_active DESC, p.price ASC, p.platform_plan_id DESC`
    );

    const [platformPayments] = await db.execute(
      `SELECT s.owner_subscription_id, s.transaction_reference,
              s.plan_name_snapshot, s.amount, s.payment_status, s.payment_method,
              s.owner_review_status, s.refund_status, s.refund_reference,
              DATE_FORMAT(s.start_date, '%Y-%m-%d') AS start_date,
              DATE_FORMAT(s.end_date, '%Y-%m-%d') AS end_date,
              DATE_FORMAT(s.paid_at, '%Y-%m-%d %H:%i:%s') AS paid_at,
              DATE_FORMAT(s.refunded_at, '%Y-%m-%d %H:%i:%s') AS refunded_at,
              s.created_at, g.gym_name, u.username AS owner_username, u.email AS owner_email,
              CASE
                WHEN s.owner_review_status = 'Pending' THEN 'Awaiting approval'
                WHEN s.payment_status = 'Refunded' THEN 'Refunded'
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
        grossCollected: platformStats.grossCollected || 0,
        totalRefunded: platformStats.totalRefunded || 0,
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

    const [gymRows] = await connection.execute('SELECT gym_id FROM gyms WHERE owner_id = ? LIMIT 1 FOR UPDATE', [userId]);
    if (!gymRows.length) {
      await connection.rollback();
      return res.status(404).json({ message: 'Gym profile for this owner was not found.' });
    }
    const gymId = gymRows[0].gym_id;
    const [subscriptionRows] = await connection.execute(
      `SELECT owner_subscription_id, payment_status, duration_months_snapshot
       FROM gym_owner_subscriptions WHERE gym_id = ?
       ORDER BY owner_subscription_id DESC LIMIT 1 FOR UPDATE`,
      [gymId]
    );

    if (action === 'approve') {
      await connection.execute("UPDATE users SET account_status = 'Approved' WHERE user_id = ?", [userId]);
      if (subscriptionRows.length && subscriptionRows[0].payment_status === 'Paid') {
        await connection.execute(
          `UPDATE gym_owner_subscriptions
           SET owner_review_status = 'Approved',
               start_date = CURDATE(),
               end_date = DATE_SUB(DATE_ADD(CURDATE(), INTERVAL duration_months_snapshot MONTH), INTERVAL 1 DAY),
               refund_status = 'NotApplicable'
           WHERE owner_subscription_id = ?`,
          [subscriptionRows[0].owner_subscription_id]
        );
      }
    } else {
      // Keep the gym and payment row for audit and refund processing; do not delete a paid registration.
      await connection.execute("UPDATE users SET account_status = 'Rejected' WHERE user_id = ?", [userId]);
      if (subscriptionRows.length) {
        await connection.execute(
          `UPDATE gym_owner_subscriptions
           SET owner_review_status = 'Rejected',
               refund_status = CASE WHEN payment_status = 'Paid' THEN 'Available' ELSE 'NotApplicable' END
           WHERE owner_subscription_id = ?`,
          [subscriptionRows[0].owner_subscription_id]
        );
      }
    }

    await connection.commit();
    res.json({
      message: action === 'approve'
        ? 'Gym Owner approved. The paid platform subscription period starts today.'
        : 'Gym Owner rejected. The gym and payment have been retained for audit; a refund can now be recorded.'
    });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
}

async function recordOwnerRefund(req, res, next) {
  const subscriptionId = Number(req.params.subscriptionId);
  if (!Number.isInteger(subscriptionId) || subscriptionId <= 0) {
    return res.status(400).json({ message: 'Invalid platform subscription reference.' });
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT owner_subscription_id, payment_status, owner_review_status, refund_status
       FROM gym_owner_subscriptions WHERE owner_subscription_id = ? FOR UPDATE`,
      [subscriptionId]
    );
    if (!rows.length) {
      await connection.rollback();
      return res.status(404).json({ message: 'Platform subscription payment was not found.' });
    }
    const payment = rows[0];
    if (payment.owner_review_status !== 'Rejected' || payment.payment_status !== 'Paid' || payment.refund_status !== 'Available') {
      await connection.rollback();
      return res.status(409).json({ message: 'This payment is not eligible for a refund record. Only a paid, rejected owner registration can be refunded, and it can be refunded once.' });
    }

    const refundReference = `REF-DEMO-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    await connection.execute(
      `UPDATE gym_owner_subscriptions
       SET payment_status = 'Refunded', refund_status = 'Refunded',
           refund_reference = ?, refunded_at = NOW()
       WHERE owner_subscription_id = ?`,
      [refundReference, subscriptionId]
    );
    await connection.commit();
    res.json({
      message: 'Refund recorded in the demo system. Platform net revenue has been reduced. No money was transferred by a payment gateway.',
      refund_reference: refundReference
    });
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
  recordOwnerRefund,
  createSubscriptionPlan,
  setSubscriptionPlanStatus
};
