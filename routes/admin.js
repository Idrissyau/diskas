const express = require('express');
const router = express.Router();
const { requireAdmin, requireSuperAdmin } = require('../middleware/auth');
const ctrl = require('../controllers/adminController');

router.use(requireAdmin);

router.get('/', ctrl.dashboard);
router.get('/users', ctrl.users);
router.post('/users/:id', ctrl.updateUser);
router.post('/users/:id/delete', requireSuperAdmin, ctrl.deleteUser);
router.get('/posts', ctrl.posts);
router.post('/posts/:id', ctrl.updatePost);
router.get('/jobs', ctrl.jobs);
router.post('/jobs/:id', ctrl.updateJob);
router.get('/skills', ctrl.skills);
router.post('/skills/:id', ctrl.updateSkill);
router.get('/reports', ctrl.reports);
router.post('/reports/:id', ctrl.resolveReport);
router.get('/settings', requireSuperAdmin, ctrl.settings);
router.post('/settings', requireSuperAdmin, ctrl.updateSettings);
router.get('/categories', ctrl.categories);
router.post('/categories', requireSuperAdmin, ctrl.createCategory);
router.post('/categories/:id/delete', requireSuperAdmin, ctrl.deleteCategory);

module.exports = router;
