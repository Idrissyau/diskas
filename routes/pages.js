'use strict';

const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/landingPageController');

// Mounted at /pages — so paths below are relative to that prefix
router.get( '/',              ctrl.listPages);
router.get( '/new',           ctrl.newPage);
router.get( '/:id/edit',      ctrl.editPage);
router.post('/save',          ctrl.savePage);
router.delete('/:id',         ctrl.deletePage);
router.post('/:id/duplicate', ctrl.duplicatePage);
router.post('/:id/upload-bg', ctrl.uploadBgImage);

module.exports = router;
