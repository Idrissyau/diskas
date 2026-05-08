const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/authController');

router.get('/register', ctrl.getRegister);
router.post('/register', ctrl.postRegister);
router.get('/login', ctrl.getLogin);
router.post('/login', ctrl.postLogin);
router.get('/logout', ctrl.logout);

router.get('/profile', requireAuth, ctrl.getProfile);
router.post('/profile', requireAuth, ctrl.updateProfile);
router.post('/profile/password', requireAuth, ctrl.changePassword);

module.exports = router;
