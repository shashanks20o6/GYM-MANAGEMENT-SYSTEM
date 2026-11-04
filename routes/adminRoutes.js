const express = require('express');
const controller = require('../controllers/adminController');
const { requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireRole('super_admin'));
router.get('/overview', controller.getOverview);
router.patch('/owners/:userId/:action', controller.reviewOwner);

module.exports = router;
