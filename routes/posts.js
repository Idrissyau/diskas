const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/postController');

router.get('/', ctrl.index);
router.get('/new', requireAuth, ctrl.getCreate);
router.post('/new', requireAuth, ctrl.postCreate);
router.get('/:slug', ctrl.show);
router.post('/:slug/comment', requireAuth, ctrl.postComment);
router.post('/vote', requireAuth, ctrl.vote);
router.post('/:id/delete', requireAuth, ctrl.deletePost);

module.exports = router;
