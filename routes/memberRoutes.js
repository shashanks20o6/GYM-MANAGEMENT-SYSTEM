const express = require('express');
const controller = require('../controllers/memberController');
const { requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireRole('Members'));
router.get('/dashboard', controller.getDashboard);
router.post('/subscriptions', controller.purchaseSubscription);
router.post('/workout-requests', controller.createWorkoutRequest);

module.exports = router;
