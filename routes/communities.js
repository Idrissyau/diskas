const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/communityController');

// Browse & create
router.get('/',          ctrl.index);
router.get('/new',       requireAuth, ctrl.getCreate);
router.post('/',         requireAuth, ctrl.postCreate);

// Community page
router.get('/:slug',     ctrl.show);

// Join / Leave
router.post('/:slug/join',  requireAuth, ctrl.join);
router.post('/:slug/leave', requireAuth, ctrl.leave);

// Posts within community
router.post('/:slug/posts',                        requireAuth, ctrl.createPost);
router.get('/:slug/posts/:postId',                 ctrl.showPost);
router.post('/:slug/posts/:postId/comment',        requireAuth, ctrl.createComment);
router.post('/:slug/posts/:postId/delete',         requireAuth, ctrl.deletePost);

// Settings & member management (owner only)
router.get('/:slug/settings',                      requireAuth, ctrl.getSettings);
router.post('/:slug/settings',                     requireAuth, ctrl.postSettings);
router.post('/:slug/members/:userId/remove',       requireAuth, ctrl.removeMember);
router.post('/:slug/delete',                       requireAuth, ctrl.deleteCommunity);

module.exports = router;
