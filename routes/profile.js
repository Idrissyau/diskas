const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/authController');

router.get('/',              requireAuth, ctrl.getProfile);
router.post('/',             requireAuth, ctrl.updateProfile);
router.post('/avatar',       requireAuth, ctrl.updateAvatar);
router.post('/cover',        requireAuth, ctrl.updateCover);
router.post('/password',     requireAuth, ctrl.changePassword);

module.exports = router;
