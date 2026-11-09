const db = require('../config/db');

async function getTrainerProfile(userId, executor = db) {
  const [rows] = await executor.execute(
    'SELECT train_id, gym_id, first_name, last_name, email FROM trainers WHERE user_id = ? LIMIT 1',
    [userId]
  );
  return rows[0] || null;
}

async function getDashboard(req, res, next) {
  try {
    const trainer = await getTrainerProfile(req.user.user_id);
    if (!trainer) return res.status(404).json({ message: 'Trainer profile was not found.' });

    const [attendanceRows] = await db.execute(
      `SELECT trainatt_id, date, check_in, check_out FROM trainer_attendance
       WHERE train_id = ? AND date = CURDATE() LIMIT 1`,
      [trainer.train_id]
    );
    const [requests] = await db.execute(
      `SELECT r.request_id, r.request_date, r.member_notes, r.status,
              m.mem_id, m.first_name, m.last_name, m.phone, m.email,
              u.username AS member_username, p.plan_title
       FROM workout_requests r
       INNER JOIN members m ON m.mem_id = r.mem_id
       INNER JOIN users u ON u.user_id = m.user_id
       LEFT JOIN assigned_workout_plans p ON p.request_id = r.request_id
       WHERE r.train_id = ? AND u.account_status = 'Approved'
       ORDER BY r.request_date DESC`,
      [trainer.train_id]
    );
    const [members] = await db.execute(
      `SELECT DISTINCT m.mem_id, m.first_name, m.last_name, m.phone, m.email
       FROM workout_requests r INNER JOIN members m ON m.mem_id = r.mem_id
       INNER JOIN users u ON u.user_id = m.user_id
       WHERE r.train_id = ? AND u.account_status = 'Approved'
       ORDER BY m.first_name, m.last_name`,
      [trainer.train_id]
    );
    const [videos] = await db.execute(
      'SELECT video_id, workout_name, target_muscle_group, video_url FROM workout_videos WHERE gym_id = ? ORDER BY workout_name',
      [trainer.gym_id]
    );
    const [assignedPlans] = await db.execute(
      `SELECT p.plan_id, p.plan_title, p.assigned_date,
              r.request_id, m.first_name, m.last_name
       FROM assigned_workout_plans p
       INNER JOIN workout_requests r ON r.request_id = p.request_id
       INNER JOIN members m ON m.mem_id = r.mem_id
       WHERE r.train_id = ? ORDER BY p.assigned_date DESC LIMIT 50`,
      [trainer.train_id]
    );

    res.json({ trainer, attendance: attendanceRows[0] || null, requests, members, videos, assignedPlans });
  } catch (error) {
    next(error);
  }
}

async function clockIn(req, res, next) {
  try {
    const trainer = await getTrainerProfile(req.user.user_id);
    if (!trainer) return res.status(404).json({ message: 'Trainer profile was not found.' });
    const [existing] = await db.execute(
      'SELECT trainatt_id FROM trainer_attendance WHERE train_id = ? AND date = CURDATE()',
      [trainer.train_id]
    );
    if (existing.length) return res.status(409).json({ message: 'Attendance has already been started for today.' });
    const [result] = await db.execute(
      'INSERT INTO trainer_attendance (train_id, check_in, date) VALUES (?, CURTIME(), CURDATE())',
      [trainer.train_id]
    );
    res.status(201).json({ message: 'Clock-in recorded.', trainatt_id: result.insertId });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Attendance has already been started for today.' });
    next(error);
  }
}

async function clockOut(req, res, next) {
  try {
    const trainer = await getTrainerProfile(req.user.user_id);
    if (!trainer) return res.status(404).json({ message: 'Trainer profile was not found.' });
    const [result] = await db.execute(
      `UPDATE trainer_attendance SET check_out = CURTIME()
       WHERE train_id = ? AND date = CURDATE() AND check_out IS NULL`,
      [trainer.train_id]
    );
    if (!result.affectedRows) return res.status(409).json({ message: 'Clock in first, or attendance is already closed.' });
    res.json({ message: 'Clock-out recorded.' });
  } catch (error) {
    next(error);
  }
}

async function updateRequestStatus(req, res, next) {
  const requestId = Number(req.params.requestId);
  const status = req.body.status;
  if (!Number.isInteger(requestId) || requestId <= 0 || !['Accepted', 'Rejected'].includes(status)) {
    return res.status(400).json({ message: 'Choose Accepted or Rejected for a valid request.' });
  }
  try {
    const trainer = await getTrainerProfile(req.user.user_id);
    if (!trainer) return res.status(404).json({ message: 'Trainer profile was not found.' });
    const [result] = await db.execute(
      `UPDATE workout_requests SET status = ?
       WHERE request_id = ? AND train_id = ? AND status = 'Pending'`,
      [status, requestId, trainer.train_id]
    );
    if (!result.affectedRows) return res.status(404).json({ message: 'Pending request was not found for this trainer.' });
    res.json({ message: `Workout request ${status.toLowerCase()}.` });
  } catch (error) {
    next(error);
  }
}

async function createWorkoutPlan(req, res, next) {
  const requestId = Number(req.params.requestId);
  const title = String(req.body.plan_title || '').trim();
  const exercises = req.body.exercises;
  if (!Number.isInteger(requestId) || requestId <= 0 || !title || title.length > 150 || !Array.isArray(exercises) || exercises.length < 1 || exercises.length > 30) {
    return res.status(400).json({ message: 'Provide a plan title and between 1 and 30 exercises.' });
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const trainer = await getTrainerProfile(req.user.user_id, connection);
    if (!trainer) {
      await connection.rollback();
      return res.status(404).json({ message: 'Trainer profile was not found.' });
    }

    const [requestRows] = await connection.execute(
      `SELECT request_id, status FROM workout_requests
       WHERE request_id = ? AND train_id = ? FOR UPDATE`,
      [requestId, trainer.train_id]
    );
    if (!requestRows.length || requestRows[0].status !== 'Accepted') {
      await connection.rollback();
      return res.status(409).json({ message: 'Accept the workout request before assigning a plan, or check whether a plan was already assigned.' });
    }
    const [existingPlan] = await connection.execute(
      'SELECT plan_id FROM assigned_workout_plans WHERE request_id = ?',
      [requestId]
    );
    if (existingPlan.length) {
      await connection.rollback();
      return res.status(409).json({ message: 'A workout plan has already been assigned to this request.' });
    }

    const normalized = [];
    const allowedVideoIds = new Set();
    const requestedVideoIds = exercises.map((item) => Number(item.video_id));
    if (!requestedVideoIds.every((id) => Number.isInteger(id) && id > 0)) {
      await connection.rollback();
      return res.status(400).json({ message: 'Every exercise must reference a valid workout video.' });
    }
    const videoIds = [...new Set(requestedVideoIds)];
    const placeholders = videoIds.map(() => '?').join(',');
    const [videos] = await connection.execute(
      `SELECT video_id FROM workout_videos WHERE gym_id = ? AND video_id IN (${placeholders})`,
      [trainer.gym_id, ...videoIds]
    );
    videos.forEach((video) => allowedVideoIds.add(video.video_id));

    for (let index = 0; index < exercises.length; index += 1) {
      const item = exercises[index] || {};
      const videoId = Number(item.video_id);
      const sets = Number(item.sets);
      const reps = String(item.reps || '').trim();
      const section = String(item.workout_section || 'Main workout').trim();
      if (!allowedVideoIds.has(videoId) || !Number.isInteger(sets) || sets < 1 || sets > 100 || !reps || reps.length > 100 || !section || section.length > 100) {
        await connection.rollback();
        return res.status(400).json({ message: `Exercise ${index + 1} has invalid video, section, sets, or reps.` });
      }
      normalized.push({ videoId, sets, reps, section });
    }

    const [planResult] = await connection.execute(
      'INSERT INTO assigned_workout_plans (request_id, plan_title, assigned_date) VALUES (?, ?, NOW())',
      [requestId, title]
    );
    for (let index = 0; index < normalized.length; index += 1) {
      const exercise = normalized[index];
      await connection.execute(
        `INSERT INTO assigned_workout_exercises
          (plan_id, video_id, workout_section, display_order, sets, reps)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [planResult.insertId, exercise.videoId, exercise.section, index + 1, exercise.sets, exercise.reps]
      );
    }
    await connection.execute("UPDATE workout_requests SET status = 'Completed' WHERE request_id = ?", [requestId]);
    await connection.commit();
    res.status(201).json({ message: 'Workout plan assigned and made available in the member dashboard.', plan_id: planResult.insertId });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
}

module.exports = { getDashboard, clockIn, clockOut, updateRequestStatus, createWorkoutPlan };
