const express = require('express');
const router  = express.Router();
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/userController');

router.get('/',              ctrl.index);
router.get('/:id',           ctrl.show);
router.post('/:id/follow',   requireAuth, ctrl.follow);
router.get('/:id/followers', ctrl.followers);
router.get('/:id/following', ctrl.following);

module.exports = router;
