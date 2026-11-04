const express = require('express');
const controller = require('../controllers/adminController');
const { requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireRole('super_admin'));
router.get('/overview', controller.getOverview);
router.patch('/owners/:userId/:action', controller.reviewOwner);
router.post('/subscription-plans', controller.createSubscriptionPlan);
router.patch('/subscription-plans/:planId/status', controller.setSubscriptionPlanStatus);

module.exports = router;
