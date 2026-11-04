const express = require('express');
const controller = require('../controllers/ownerController');
const { requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireRole('Gym_owners'));
router.get('/dashboard', controller.getDashboard);
router.patch('/users/:userId/:action', controller.reviewUser);
router.post('/plans', controller.createMembershipPlan);
router.post('/videos', controller.createWorkoutVideo);

module.exports = router;
