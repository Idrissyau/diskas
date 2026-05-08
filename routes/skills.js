const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/skillController');

router.get('/', ctrl.index);
router.get('/new', requireAuth, ctrl.getCreate);
router.post('/new', requireAuth, ctrl.postCreate);
router.get('/:slug', ctrl.show);

module.exports = router;
