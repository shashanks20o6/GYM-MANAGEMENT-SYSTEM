const db = require('../config/db');
const crypto = require('crypto');

const PLATFORM_PAYMENT_METHODS = ['UPI', 'Card', 'NetBanking', 'Bank Transfer', 'Cash'];
const SALARY_PAYMENT_METHODS = ['Cash', 'UPI', 'Card', 'Bank Transfer'];

async function getOwnerGymId(userId, executor = db) {
  const [rows] = await executor.execute('SELECT gym_id FROM gyms WHERE owner_id = ? LIMIT 1', [userId]);
  return rows[0]?.gym_id || null;
}

async function getPlatformSubscriptionSummary(gymId, executor = db) {
  const [activeRows] = await executor.execute(
    `SELECT s.owner_subscription_id, s.plan_name_snapshot AS plan_name,
            s.duration_months_snapshot AS duration_months, s.amount,
            DATE_FORMAT(s.start_date, '%Y-%m-%d') AS start_date,
            DATE_FORMAT(s.end_date, '%Y-%m-%d') AS end_date,
            s.payment_method, s.transaction_reference, s.payment_status,
            'Active' AS subscription_status
     FROM gym_owner_subscriptions s
     WHERE s.gym_id = ? AND s.payment_status = 'Paid' AND s.owner_review_status = 'Approved'
       AND CURDATE() BETWEEN s.start_date AND s.end_date
     ORDER BY s.end_date DESC, s.owner_subscription_id DESC
     LIMIT 1`,
    [gymId]
  );
  const [availablePlans] = await executor.execute(
    `SELECT platform_plan_id, plan_name, description, duration_months, price
     FROM platform_subscription_plans
     WHERE is_active = 1
     ORDER BY price ASC, duration_months ASC`
  );
  const [history] = await executor.execute(
    `SELECT s.owner_subscription_id, s.plan_name_snapshot AS plan_name,
            s.duration_months_snapshot AS duration_months, s.amount,
            DATE_FORMAT(s.start_date, '%Y-%m-%d') AS start_date,
            DATE_FORMAT(s.end_date, '%Y-%m-%d') AS end_date,
            s.payment_method, s.transaction_reference, s.payment_status,
            s.owner_review_status, s.refund_status,
            DATE_FORMAT(s.paid_at, '%Y-%m-%d %H:%i:%s') AS paid_at,
            CASE
              WHEN s.owner_review_status = 'Pending' THEN 'Awaiting approval'
              WHEN s.payment_status <> 'Paid' THEN s.payment_status
              WHEN CURDATE() BETWEEN s.start_date AND s.end_date THEN 'Active'
              ELSE 'Expired'
            END AS subscription_status
     FROM gym_owner_subscriptions s
     WHERE s.gym_id = ?
     ORDER BY s.created_at DESC, s.owner_subscription_id DESC
     LIMIT 30`,
    [gymId]
  );

  return { current: activeRows[0] || null, availablePlans, history };
}

async function getDashboard(req, res, next) {
  try {
    const gymId = await getOwnerGymId(req.user.user_id);
    if (!gymId) return res.status(404).json({ message: 'No gym profile is linked to this owner account.' });

    const [[memberCount]] = await db.execute('SELECT COUNT(*) AS total FROM members WHERE gym_id = ?', [gymId]);
    const [[trainerCount]] = await db.execute(
      `SELECT COUNT(*) AS total FROM trainers t INNER JOIN users u ON u.user_id = t.user_id
       WHERE t.gym_id = ? AND u.account_status = 'Approved'`, [gymId]
    );
    const [[grossRevenue]] = await db.execute(
      `SELECT COALESCE(SUM(p.amount), 0) AS total
       FROM payments p INNER JOIN members m ON m.mem_id = p.mem_id
       WHERE m.gym_id = ? AND p.pay_status = 'Paid'`, [gymId]
    );
    const [[salaryOutflow]] = await db.execute(
      `SELECT COALESCE(SUM(amount_paid), 0) AS total
       FROM trainer_salary_payments WHERE gym_id = ? AND payment_status = 'Paid'`, [gymId]
    );
    const netRevenue = Number(grossRevenue.total || 0) - Number(salaryOutflow.total || 0);
    const [[pendingCount]] = await db.execute(
      `SELECT COUNT(*) AS total FROM users u
       LEFT JOIN members m ON m.user_id = u.user_id
       LEFT JOIN trainers t ON t.user_id = u.user_id
       WHERE u.account_status = 'Pending' AND (m.gym_id = ? OR t.gym_id = ?)` ,
      [gymId, gymId]
    );
    const [gymRows] = await db.execute('SELECT * FROM gyms WHERE gym_id = ?', [gymId]);
    const [pendingUsers] = await db.execute(
      `SELECT u.user_id, u.username, u.email,
              CASE WHEN m.mem_id IS NOT NULL THEN 'Members' ELSE 'Trainers' END AS role,
              COALESCE(m.first_name, t.first_name) AS first_name,
              COALESCE(m.last_name, t.last_name) AS last_name,
              COALESCE(m.email, t.email, u.email) AS profile_email
       FROM users u
       LEFT JOIN members m ON m.user_id = u.user_id AND m.gym_id = ?
       LEFT JOIN trainers t ON t.user_id = u.user_id AND t.gym_id = ?
       WHERE u.account_status = 'Pending'
         AND (m.mem_id IS NOT NULL OR t.train_id IS NOT NULL)
       ORDER BY u.user_id ASC`,
      [gymId, gymId]
    );
    const [plans] = await db.execute(
      'SELECT plan_id, plan_name, plan_duration, price FROM membership_plans WHERE gym_id = ? ORDER BY plan_id DESC',
      [gymId]
    );
    const [payments] = await db.execute(
      `SELECT p.payment_id, p.amount, p.pay_date, p.pay_method, p.pay_status,
              m.first_name, m.last_name, s.sub_id, mp.plan_name
       FROM payments p
       INNER JOIN members m ON m.mem_id = p.mem_id
       INNER JOIN member_subscriptions s ON s.sub_id = p.sub_id
       INNER JOIN membership_plans mp ON mp.plan_id = s.plan_id
       WHERE m.gym_id = ? ORDER BY p.pay_date DESC LIMIT 100`,
      [gymId]
    );
    const [attendance] = await db.execute(
      `SELECT a.trainatt_id, a.date, a.check_in, a.check_out,
              t.first_name, t.last_name
       FROM trainer_attendance a INNER JOIN trainers t ON t.train_id = a.train_id
       WHERE t.gym_id = ? ORDER BY a.date DESC, a.check_in DESC LIMIT 100`,
      [gymId]
    );
    const [videos] = await db.execute(
      'SELECT video_id, workout_name, target_muscle_group, video_url FROM workout_videos WHERE gym_id = ? ORDER BY video_id DESC',
      [gymId]
    );
    const [trainers] = await db.execute(
      `SELECT t.train_id, t.first_name, t.last_name, t.email, t.emp_type,
              t.base_salary, t.commission_rate, u.account_status
       FROM trainers t INNER JOIN users u ON u.user_id = t.user_id
       WHERE t.gym_id = ? AND u.account_status = 'Approved'
       ORDER BY t.first_name, t.last_name`,
      [gymId]
    );
    const [salaryPayments] = await db.execute(
      `SELECT sp.salary_payment_id, sp.train_id, sp.salary_month,
              sp.base_salary_snapshot, sp.amount_paid, sp.pay_date,
              sp.pay_method, sp.payment_status, sp.transaction_reference,
              t.first_name, t.last_name
       FROM trainer_salary_payments sp
       INNER JOIN trainers t ON t.train_id = sp.train_id
       WHERE sp.gym_id = ?
       ORDER BY sp.salary_month DESC, sp.pay_date DESC
       LIMIT 100`,
      [gymId]
    );
    const platformSubscription = await getPlatformSubscriptionSummary(gymId);

    res.json({
      gym: gymRows[0],
      stats: {
        members: memberCount.total,
        trainers: trainerCount.total,
        grossRevenue: grossRevenue.total || 0,
        trainerSalaryPaid: salaryOutflow.total || 0,
        revenue: netRevenue,
        pendingApprovals: pendingCount.total
      },
      pendingUsers, plans, payments, attendance, videos, trainers, salaryPayments, platformSubscription
    });
  } catch (error) {
    next(error);
  }
}

async function reviewUser(req, res, next) {
  const userId = Number(req.params.userId);
  const action = req.params.action;
  if (!Number.isInteger(userId) || userId <= 0 || !['approve', 'reject'].includes(action)) {
    return res.status(400).json({ message: 'Invalid account review request.' });
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const gymId = await getOwnerGymId(req.user.user_id, connection);
    if (!gymId) {
      await connection.rollback();
      return res.status(404).json({ message: 'No gym is linked to this owner.' });
    }

    const [members] = await connection.execute(
      `SELECT u.user_id FROM users u INNER JOIN members m ON m.user_id = u.user_id
       WHERE u.user_id = ? AND u.role = 'Members' AND u.account_status = 'Pending' AND m.gym_id = ? FOR UPDATE`,
      [userId, gymId]
    );
    const [trainers] = await connection.execute(
      `SELECT u.user_id FROM users u INNER JOIN trainers t ON t.user_id = u.user_id
       WHERE u.user_id = ? AND u.role = 'Trainers' AND u.account_status = 'Pending' AND t.gym_id = ? FOR UPDATE`,
      [userId, gymId]
    );
    const isMember = members.length > 0;
    const isTrainer = trainers.length > 0;
    if (!isMember && !isTrainer) {
      await connection.rollback();
      return res.status(404).json({ message: 'Pending member or trainer was not found in your gym.' });
    }

    if (action === 'approve') {
      await connection.execute("UPDATE users SET account_status = 'Approved' WHERE user_id = ?", [userId]);
    } else {
      if (isMember) {
        await connection.execute('DELETE FROM members WHERE user_id = ? AND gym_id = ?', [userId, gymId]);
      } else {
        await connection.execute('DELETE FROM trainers WHERE user_id = ? AND gym_id = ?', [userId, gymId]);
      }
      await connection.execute("UPDATE users SET account_status = 'Rejected' WHERE user_id = ?", [userId]);
    }

    await connection.commit();
    res.json({ message: action === 'approve' ? 'Account approved.' : 'Account rejected and profile removed.' });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
}

async function payPlatformSubscription(req, res, next) {
  const platformPlanId = Number(req.body.platform_plan_id);
  const paymentMethod = String(req.body.payment_method || '').trim();
  if (!Number.isInteger(platformPlanId) || platformPlanId <= 0 || !PLATFORM_PAYMENT_METHODS.includes(paymentMethod)) {
    return res.status(400).json({ message: 'Choose a valid platform subscription plan and payment method.' });
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [ownerRows] = await connection.execute(
      `SELECT g.gym_id
       FROM gyms g INNER JOIN users u ON u.user_id = g.owner_id
       WHERE u.user_id = ? AND u.role = 'Gym_owners' AND u.account_status = 'Approved'
       LIMIT 1 FOR UPDATE`,
      [req.user.user_id]
    );
    if (!ownerRows.length) {
      await connection.rollback();
      return res.status(403).json({ message: 'Only an approved Gym Owner with a registered gym can purchase a platform subscription.' });
    }
    const gymId = ownerRows[0].gym_id;
    await connection.execute('SELECT gym_id FROM gyms WHERE gym_id = ? FOR UPDATE', [gymId]);
    const [planRows] = await connection.execute(
      `SELECT platform_plan_id, plan_name, duration_months, price
       FROM platform_subscription_plans WHERE platform_plan_id = ? AND is_active = 1 FOR UPDATE`,
      [platformPlanId]
    );
    if (!planRows.length) {
      await connection.rollback();
      return res.status(404).json({ message: 'This subscription plan is unavailable. Refresh the page and choose an active plan.' });
    }
    const plan = planRows[0];
    const [[dateRow]] = await connection.execute(
      `SELECT DATE_FORMAT(
                GREATEST(CURDATE(), COALESCE(DATE_ADD(MAX(end_date), INTERVAL 1 DAY), CURDATE())),
                '%Y-%m-%d'
              ) AS start_date
       FROM gym_owner_subscriptions
       WHERE gym_id = ? AND payment_status = 'Paid' AND owner_review_status = 'Approved'`,
      [gymId]
    );
    const startDate = dateRow.start_date;
    const transactionReference = `DEMO-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const [result] = await connection.execute(
      `INSERT INTO gym_owner_subscriptions
         (gym_id, platform_plan_id, plan_name_snapshot, duration_months_snapshot,
          amount, start_date, end_date, payment_status, payment_method,
          transaction_reference, paid_at, owner_review_status, refund_status)
       VALUES (?, ?, ?, ?, ?, ?,
               DATE_SUB(DATE_ADD(?, INTERVAL ? MONTH), INTERVAL 1 DAY),
               'Paid', ?, ?, NOW(), 'Approved', 'NotApplicable')`,
      [gymId, plan.platform_plan_id, plan.plan_name, plan.duration_months,
        plan.price, startDate, startDate, plan.duration_months, paymentMethod, transactionReference]
    );

    await connection.commit();
    res.status(201).json({
      message: 'Demo payment recorded successfully. No real money was transferred.',
      owner_subscription_id: result.insertId,
      transaction_reference: transactionReference
    });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
}

async function payTrainerSalary(req, res, next) {
  const trainerId = Number(req.params.trainId);
  const salaryMonthText = String(req.body.salary_month || '').trim();
  const paymentMethod = String(req.body.payment_method || '').trim();
  if (!Number.isInteger(trainerId) || trainerId <= 0 || !/^\d{4}-(0[1-9]|1[0-2])$/.test(salaryMonthText) || !SALARY_PAYMENT_METHODS.includes(paymentMethod)) {
    return res.status(400).json({ message: 'Choose a valid trainer, salary month and payment method.' });
  }

  const salaryMonth = `${salaryMonthText}-01`;
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [[monthCheck]] = await connection.execute("SELECT DATE_FORMAT(CURDATE(), '%Y-%m') AS current_month");
    if (salaryMonthText > monthCheck.current_month) {
      await connection.rollback();
      return res.status(400).json({ message: 'Salary cannot be paid for a future month.' });
    }
    const gymId = await getOwnerGymId(req.user.user_id, connection);
    if (!gymId) {
      await connection.rollback();
      return res.status(404).json({ message: 'No gym is linked to this owner.' });
    }

    const [trainerRows] = await connection.execute(
      `SELECT t.train_id, t.base_salary, t.first_name, t.last_name
       FROM trainers t INNER JOIN users u ON u.user_id = t.user_id
       WHERE t.train_id = ? AND t.gym_id = ? AND u.account_status = 'Approved'
       FOR UPDATE`,
      [trainerId, gymId]
    );
    if (!trainerRows.length) {
      await connection.rollback();
      return res.status(404).json({ message: 'Approved trainer was not found in your gym.' });
    }
    const trainer = trainerRows[0];
    const salary = Number(trainer.base_salary);
    if (!Number.isFinite(salary) || salary <= 0) {
      await connection.rollback();
      return res.status(400).json({ message: 'This trainer has no positive base salary recorded. Update the trainer salary before paying.' });
    }

    const transactionReference = `SAL-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    await connection.execute(
      `INSERT INTO trainer_salary_payments
         (gym_id, train_id, salary_month, base_salary_snapshot, amount_paid,
          pay_date, pay_method, payment_status, transaction_reference)
       VALUES (?, ?, ?, ?, ?, NOW(), ?, 'Paid', ?)`,
      [gymId, trainerId, salaryMonth, salary, salary, paymentMethod, transactionReference]
    );
    await connection.commit();
    res.status(201).json({
      message: `Salary of ₹${salary.toFixed(2)} recorded for ${salaryMonthText}. It has been deducted from gym net revenue.`,
      amount_paid: salary,
      transaction_reference: transactionReference
    });
  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Salary for this trainer and month has already been paid.' });
    }
    next(error);
  } finally {
    connection.release();
  }
}

async function createMembershipPlan(req, res, next) {
  try {
    const gymId = await getOwnerGymId(req.user.user_id);
    if (!gymId) return res.status(404).json({ message: 'No gym is linked to this owner.' });
    const name = String(req.body.plan_name || '').trim();
    const duration = Number(req.body.plan_duration);
    const price = Number(req.body.price);
    if (!name || name.length > 100 || !Number.isInteger(duration) || duration < 1 || duration > 120 || !Number.isFinite(price) || price < 0) {
      return res.status(400).json({ message: 'Enter a plan name, duration (1–120 months), and a valid non-negative price.' });
    }
    const [result] = await db.execute(
      'INSERT INTO membership_plans (gym_id, plan_name, plan_duration, price) VALUES (?, ?, ?, ?)',
      [gymId, name, duration, price]
    );
    res.status(201).json({ message: 'Membership plan created.', plan_id: result.insertId });
  } catch (error) {
    next(error);
  }
}

async function createWorkoutVideo(req, res, next) {
  try {
    const gymId = await getOwnerGymId(req.user.user_id);
    if (!gymId) return res.status(404).json({ message: 'No gym is linked to this owner.' });
    const name = String(req.body.workout_name || '').trim();
    const muscleGroup = String(req.body.target_muscle_group || '').trim();
    const url = String(req.body.video_url || '').trim();
    if (!name || name.length > 150 || !url || url.length > 255) {
      return res.status(400).json({ message: 'Workout name and video URL are required.' });
    }
    let parsedUrl;
    try { parsedUrl = new URL(url); } catch { return res.status(400).json({ message: 'Enter a valid video URL.' }); }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) return res.status(400).json({ message: 'Video URL must use HTTP or HTTPS.' });

    const [result] = await db.execute(
      'INSERT INTO workout_videos (gym_id, workout_name, target_muscle_group, video_url) VALUES (?, ?, ?, ?)',
      [gymId, name, muscleGroup || null, url]
    );
    res.status(201).json({ message: 'Workout video added.', video_id: result.insertId });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getDashboard,
  reviewUser,
  payPlatformSubscription,
  payTrainerSalary,
  createMembershipPlan,
  createWorkoutVideo
};
