const db = require('../config/db');

async function getMemberProfile(userId, executor = db) {
  const [rows] = await executor.execute(
    `SELECT mem_id, gym_id, first_name, last_name, phone, email, dob, address, medical_cond, photo
     FROM members WHERE user_id = ? LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

async function getDashboard(req, res, next) {
  try {
    const member = await getMemberProfile(req.user.user_id);
    if (!member) return res.status(404).json({ message: 'Member profile was not found.' });

    const [plans] = await db.execute(
      'SELECT plan_id, plan_name, plan_duration, price FROM membership_plans WHERE gym_id = ? ORDER BY price ASC',
      [member.gym_id]
    );
    const [subscriptions] = await db.execute(
      `SELECT s.sub_id, s.start_date, s.end_date, s.auto_pay_status,
              p.plan_name, p.plan_duration, p.price,
              CASE WHEN s.end_date >= CURDATE() THEN 'Active' ELSE 'Expired' END AS subscription_status
       FROM member_subscriptions s INNER JOIN membership_plans p ON p.plan_id = s.plan_id
       WHERE s.mem_id = ? ORDER BY s.start_date DESC`,
      [member.mem_id]
    );
    const [payments] = await db.execute(
      `SELECT payment_id, sub_id, amount, pay_date, pay_method, pay_status
       FROM payments WHERE mem_id = ? ORDER BY pay_date DESC LIMIT 100`,
      [member.mem_id]
    );
    const [trainers] = await db.execute(
      `SELECT t.train_id, t.first_name, t.last_name, t.email, t.exp_years, t.emp_type
       FROM trainers t INNER JOIN users u ON u.user_id = t.user_id
       WHERE t.gym_id = ? AND u.account_status = 'Approved'
       ORDER BY t.first_name, t.last_name`,
      [member.gym_id]
    );
    const [requests] = await db.execute(
      `SELECT r.request_id, r.request_date, r.member_notes, r.status,
              t.first_name AS trainer_first_name, t.last_name AS trainer_last_name,
              p.plan_id AS assigned_plan_id, p.plan_title
       FROM workout_requests r INNER JOIN trainers t ON t.train_id = r.train_id
       LEFT JOIN assigned_workout_plans p ON p.request_id = r.request_id
       WHERE r.mem_id = ? ORDER BY r.request_date DESC`,
      [member.mem_id]
    );
    const [exerciseRows] = await db.execute(
      `SELECT p.plan_id, p.plan_title, p.assigned_date,
              e.plan_exercise_id, e.workout_section, e.display_order, e.sets, e.reps,
              v.workout_name, v.target_muscle_group, v.video_url
       FROM assigned_workout_plans p
       INNER JOIN workout_requests r ON r.request_id = p.request_id
       INNER JOIN assigned_workout_exercises e ON e.plan_id = p.plan_id
       INNER JOIN workout_videos v ON v.video_id = e.video_id
       WHERE r.mem_id = ? ORDER BY p.assigned_date DESC, e.display_order ASC`,
      [member.mem_id]
    );

    const workoutPlansMap = new Map();
    for (const row of exerciseRows) {
      if (!workoutPlansMap.has(row.plan_id)) {
        workoutPlansMap.set(row.plan_id, {
          plan_id: row.plan_id,
          plan_title: row.plan_title,
          assigned_date: row.assigned_date,
          exercises: []
        });
      }
      workoutPlansMap.get(row.plan_id).exercises.push({
        workout_section: row.workout_section,
        display_order: row.display_order,
        sets: row.sets,
        reps: row.reps,
        workout_name: row.workout_name,
        target_muscle_group: row.target_muscle_group,
        video_url: row.video_url
      });
    }

    res.json({
      member,
      gym: { gym_id: member.gym_id },
      plans,
      subscriptions,
      payments,
      trainers,
      requests,
      workoutPlans: [...workoutPlansMap.values()]
    });
  } catch (error) {
    next(error);
  }
}

async function purchaseSubscription(req, res, next) {
  const planId = Number(req.body.plan_id);
  const payMethod = String(req.body.pay_method || '');
  const allowedMethods = ['Cash', 'UPI', 'Card', 'NetBanking'];
  if (!Number.isInteger(planId) || planId <= 0 || !allowedMethods.includes(payMethod)) {
    return res.status(400).json({ message: 'Choose a membership plan and a valid payment method.' });
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const member = await getMemberProfile(req.user.user_id, connection);
    if (!member) {
      await connection.rollback();
      return res.status(404).json({ message: 'Member profile was not found.' });
    }
    const [planRows] = await connection.execute(
      'SELECT plan_id, plan_duration, price FROM membership_plans WHERE plan_id = ? AND gym_id = ? FOR UPDATE',
      [planId, member.gym_id]
    );
    if (!planRows.length) {
      await connection.rollback();
      return res.status(404).json({ message: 'Membership plan was not found in your gym.' });
    }
    const plan = planRows[0];

    const [latestRows] = await connection.execute(
      "SELECT DATE_FORMAT(MAX(end_date), '%Y-%m-%d') AS latest_end FROM member_subscriptions WHERE mem_id = ?",
      [member.mem_id]
    );
    const latestEnd = latestRows[0].latest_end;
    const [dateRows] = await connection.execute(
      `SELECT DATE_FORMAT(
         CASE WHEN ? IS NOT NULL AND CAST(? AS DATE) >= CURDATE()
              THEN DATE_ADD(CAST(? AS DATE), INTERVAL 1 DAY)
              ELSE CURDATE() END, '%Y-%m-%d'
       ) AS start_date`,
      [latestEnd, latestEnd, latestEnd]
    );
    const startDate = dateRows[0].start_date;

    const [subscriptionResult] = await connection.execute(
      `INSERT INTO member_subscriptions (mem_id, plan_id, start_date, end_date, auto_pay_status)
       VALUES (?, ?, ?, DATE_SUB(DATE_ADD(?, INTERVAL ? MONTH), INTERVAL 1 DAY), 0)`,
      [member.mem_id, planId, startDate, startDate, plan.plan_duration]
    );
    await connection.execute(
      `INSERT INTO payments (mem_id, sub_id, amount, pay_date, pay_method, pay_status)
       VALUES (?, ?, ?, NOW(), ?, 'Paid')`,
      [member.mem_id, subscriptionResult.insertId, plan.price, payMethod]
    );
    await connection.commit();
    res.status(201).json({
      message: 'Subscription and payment record created. This demo records the selected method; it does not process a real payment.',
      sub_id: subscriptionResult.insertId
    });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
}

async function createWorkoutRequest(req, res, next) {
  const trainerId = Number(req.body.train_id);
  const notes = String(req.body.member_notes || '').trim();
  if (!Number.isInteger(trainerId) || trainerId <= 0 || notes.length > 2000) {
    return res.status(400).json({ message: 'Choose a trainer and keep notes under 2,000 characters.' });
  }
  try {
    const member = await getMemberProfile(req.user.user_id);
    if (!member) return res.status(404).json({ message: 'Member profile was not found.' });
    const [trainers] = await db.execute(
      `SELECT t.train_id FROM trainers t INNER JOIN users u ON u.user_id = t.user_id
       WHERE t.train_id = ? AND t.gym_id = ? AND u.account_status = 'Approved'`,
      [trainerId, member.gym_id]
    );
    if (!trainers.length) return res.status(404).json({ message: 'The selected trainer is not available in your gym.' });

    const [pending] = await db.execute(
      "SELECT request_id FROM workout_requests WHERE mem_id = ? AND train_id = ? AND status IN ('Pending', 'Accepted') LIMIT 1",
      [member.mem_id, trainerId]
    );
    if (pending.length) return res.status(409).json({ message: 'You already have an open request with this trainer.' });

    const [result] = await db.execute(
      "INSERT INTO workout_requests (mem_id, train_id, request_date, member_notes, status) VALUES (?, ?, NOW(), ?, 'Pending')",
      [member.mem_id, trainerId, notes || null]
    );
    res.status(201).json({ message: 'Workout request sent to your trainer.', request_id: result.insertId });
  } catch (error) {
    next(error);
  }
}

module.exports = { getDashboard, purchaseSubscription, createWorkoutRequest };
