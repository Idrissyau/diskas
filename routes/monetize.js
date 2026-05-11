const express = require('express');
const router  = express.Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const ctrl = require('../controllers/monetizeController');

/* ── Membership Plans ───────────────────────────────────────────────────── */
router.get( '/communities/:slug/plans',                  requireAuth, ctrl.getPlans);
router.post('/communities/:slug/plans',                  requireAuth, ctrl.createPlan);
router.post('/communities/:slug/plans/:planId/update',   requireAuth, ctrl.updatePlan);
router.post('/communities/:slug/plans/:planId/delete',   requireAuth, ctrl.deletePlan);

/* ── Checkout ───────────────────────────────────────────────────────────── */
router.get( '/checkout/plan/:planId',                    requireAuth, ctrl.getCheckout);
router.post('/checkout/plan/:planId',                    requireAuth, ctrl.postCheckout);
router.get( '/checkout/success/:ref',                    requireAuth, ctrl.getSuccess);
router.post('/checkout/coupon',                          requireAuth, ctrl.validateCoupon);
router.post('/checkout/product/:productId',              requireAuth, ctrl.buyProduct);

/* ── Payment History ────────────────────────────────────────────────────── */
router.get( '/payments/history',                         requireAuth, ctrl.myPayments);

/* ── Creator Wallet ─────────────────────────────────────────────────────── */
router.get( '/wallet',                                   requireAuth, ctrl.getWallet);
router.post('/wallet/payout',                            requireAuth, ctrl.requestPayout);

/* ── Coupons ────────────────────────────────────────────────────────────── */
router.get( '/communities/:slug/coupons',                requireAuth, ctrl.getCoupons);
router.post('/communities/:slug/coupons',                requireAuth, ctrl.createCoupon);
router.post('/communities/:slug/coupons/:couponId/delete', requireAuth, ctrl.deleteCoupon);
router.post('/communities/:slug/coupons/:couponId/toggle', requireAuth, ctrl.toggleCoupon);

/* ── Courses ────────────────────────────────────────────────────────────── */
router.get( '/communities/:slug/courses',                                           ctrl.getCourses);
router.post('/communities/:slug/courses',                             requireAuth,  ctrl.createCourse);
router.get( '/communities/:slug/courses/:courseId',                                 ctrl.viewCourse);
router.get( '/communities/:slug/courses/:courseId/edit',              requireAuth,  ctrl.editCourse);
router.post('/communities/:slug/courses/:courseId/update',            requireAuth,  ctrl.updateCourse);
router.post('/communities/:slug/courses/:courseId/modules',           requireAuth,  ctrl.addModule);
router.post('/communities/:slug/courses/:courseId/modules/:moduleId/lessons', requireAuth, ctrl.addLesson);
// Lesson player
router.get( '/communities/:slug/courses/:courseId/lessons/:lessonId',               ctrl.viewLesson);
// Lesson management
router.post('/communities/:slug/courses/:courseId/lessons/:lessonId/update',  requireAuth, ctrl.updateLesson);
router.post('/communities/:slug/courses/:courseId/lessons/:lessonId/delete',  requireAuth, ctrl.deleteLesson);
router.post('/communities/:slug/courses/:courseId/lessons/:lessonId/complete', requireAuth, ctrl.completeLesson);
// AJAX video detection
router.post('/api/video/detect',                                       requireAuth, ctrl.detectVideoApi);

/* ── Events ─────────────────────────────────────────────────────────────── */
router.get( '/communities/:slug/events',                              ctrl.getEvents);
router.post('/communities/:slug/events',                requireAuth, ctrl.createEvent);
router.post('/communities/:slug/events/:eventId/rsvp',  requireAuth, ctrl.rsvpEvent);
router.post('/communities/:slug/events/:eventId/delete', requireAuth, ctrl.deleteEvent);

/* ── Digital Products ───────────────────────────────────────────────────── */
router.get( '/communities/:slug/products',                                   ctrl.getProducts);
router.post('/communities/:slug/products',                    requireAuth,   ctrl.createProduct);
router.post('/communities/:slug/products/:productId/update',  requireAuth,   ctrl.updateProduct);
router.post('/communities/:slug/products/:productId/toggle',  requireAuth,   ctrl.toggleProduct);
router.post('/communities/:slug/products/:productId/delete',  requireAuth,   ctrl.deleteProduct);
router.get( '/products/:productId/download',                  requireAuth,   ctrl.downloadProduct);

/* ── Admin ──────────────────────────────────────────────────────────────── */
router.get( '/admin/monetize',                          requireAdmin, ctrl.adminMonetize);
router.post('/admin/settings/commission',               requireAdmin, ctrl.updateCommission);
router.post('/admin/payouts/:id/approve',               requireAdmin, ctrl.adminApprovePayout);
router.post('/admin/payouts/:id/reject',                requireAdmin, ctrl.adminRejectPayout);
router.post('/admin/payments/:id/approve',              requireAdmin, ctrl.adminApprovePayment);
// Video settings
router.get( '/admin/video-settings',                    requireAdmin, ctrl.adminVideoSettings);
router.post('/admin/video-settings',                    requireAdmin, ctrl.updateVideoSettings);

module.exports = router;
