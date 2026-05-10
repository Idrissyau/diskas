const express = require('express');
const router  = express.Router();
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/messageController');

router.get('/',              requireAuth, ctrl.index);
router.post('/',             requireAuth, ctrl.create);
router.get('/unread',        requireAuth, ctrl.unreadCount);
router.get('/:id',           requireAuth, ctrl.show);
router.post('/:id',          requireAuth, ctrl.send);
router.get('/:id/poll',      requireAuth, ctrl.poll);
router.delete('/:id/messages/:msgId',       requireAuth, ctrl.deleteMessage);
router.post('/:id/messages/:msgId/react',   requireAuth, ctrl.react);

module.exports = router;
