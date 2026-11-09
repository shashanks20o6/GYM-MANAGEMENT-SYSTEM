const express = require('express');
const controller = require('../controllers/authController');
const { requireApiAuth } = require('../middleware/auth');

const router = express.Router();
router.get('/gyms', controller.getApprovedGyms);
router.get('/platform-plans', controller.getPublicPlatformPlans);
router.post('/register', controller.register);
router.post('/login', controller.login);
router.get('/me', requireApiAuth, controller.me);
router.post('/logout', controller.logout);

module.exports = router;
