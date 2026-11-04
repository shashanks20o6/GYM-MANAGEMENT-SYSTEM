const express = require('express');
const controller = require('../controllers/trainerController');
const { requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireRole('Trainers'));
router.get('/dashboard', controller.getDashboard);
router.post('/attendance/clock-in', controller.clockIn);
router.post('/attendance/clock-out', controller.clockOut);
router.patch('/requests/:requestId/status', controller.updateRequestStatus);
router.post('/requests/:requestId/plans', controller.createWorkoutPlan);

module.exports = router;
