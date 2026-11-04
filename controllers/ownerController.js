const db = require('../config/db');

async function getOwnerGymId(userId, executor = db) {
  const [rows] = await executor.execute('SELECT gym_id FROM gyms WHERE owner_id = ? LIMIT 1', [userId]);
  if (!rows.length) return null;
  return rows[0].gym_id;
}

async function getDashboard(req, res, next) {
  try {
    const gymId = await getOwnerGymId(req.user.user_id);
    if (!gymId) return res.status(404).json({ message: 'No gym profile is linked to this owner account.' });

    const [[memberCount]] = await db.execute('SELECT COUNT(*) AS total FROM members WHERE gym_id = ?', [gymId]);
    const [[trainerCount]] = await db.execute('SELECT COUNT(*) AS total FROM trainers WHERE gym_id = ?', [gymId]);
    const [[revenue]] = await db.execute(
      "SELECT COALESCE(SUM(p.amount), 0) AS total FROM payments p INNER JOIN members m ON m.mem_id = p.mem_id WHERE m.gym_id = ? AND p.pay_status = 'Paid'",
      [gymId]
    );
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

    res.json({
      gym: gymRows[0],
      stats: { members: memberCount.total, trainers: trainerCount.total, revenue: revenue.total, pendingApprovals: pendingCount.total },
      pendingUsers, plans, payments, attendance, videos
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
      // Remove the operational profile, but retain the rejected users row for audit.
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

module.exports = { getDashboard, reviewUser, createMembershipPlan, createWorkoutVideo };
