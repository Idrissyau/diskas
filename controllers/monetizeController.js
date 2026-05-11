/**
 * monetizeController.js
 * Handles: Membership Plans, Checkout, Wallet, Payouts, Coupons,
 *          Courses, Events, Digital Products
 */

const { query, queryOne, insert, update, remove } = require('../helpers/db');
const { makeSlug, timeAgo } = require('../helpers/utils');
const ps = require('../services/paymentService');
const fs = require('fs');
const path = require('path');

const UPLOAD_DIR = 'public/uploads/communities';

/* ─────────────────────────────────────────────────────────────────────────
   MEMBERSHIP PLANS
───────────────────────────────────────────────────────────────────────── */

// GET /communities/:slug/plans
exports.getPlans = async (req, res) => {
  try {
    const community = await queryOne(
      'SELECT * FROM communities WHERE slug = ? AND owner_id = ?',
      [req.params.slug, req.session.user.id]
    );
    if (!community) return res.status(403).render('errors/403', { title: 'Forbidden' });

    const plans = await query(
      'SELECT * FROM membership_plans WHERE community_id = ? ORDER BY sort_order, price ASC',
      [community.id]
    );

    res.render('monetize/plans', {
      title: `Membership Plans — ${community.name}`,
      community,
      plans,
      formatUSD: ps.formatUSD,
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not load plans.');
    res.redirect(`/communities/${req.params.slug}/settings`);
  }
};

// POST /communities/:slug/plans (create)
exports.createPlan = async (req, res) => {
  try {
    const community = await queryOne(
      'SELECT * FROM communities WHERE slug = ? AND owner_id = ?',
      [req.params.slug, req.session.user.id]
    );
    if (!community) return res.status(403).send('Forbidden');

    const { name, description, price, billing_type, trial_days, is_active } = req.body;
    if (!name || !name.trim()) {
      req.flash('error', 'Plan name is required.');
      return res.redirect(`/communities/${req.params.slug}/plans`);
    }

    await insert('membership_plans', {
      community_id: community.id,
      name:         name.trim(),
      description:  description ? description.trim() : null,
      price:        parseFloat(price) || 0,
      billing_type: billing_type || 'free',
      trial_days:   parseInt(trial_days) || 0,
      is_active:    is_active ? 1 : 0,
    });

    req.flash('success', `Plan "${name.trim()}" created!`);
    res.redirect(`/communities/${req.params.slug}/plans`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to create plan.');
    res.redirect(`/communities/${req.params.slug}/plans`);
  }
};

// POST /communities/:slug/plans/:planId/update
exports.updatePlan = async (req, res) => {
  try {
    const community = await queryOne(
      'SELECT * FROM communities WHERE slug = ? AND owner_id = ?',
      [req.params.slug, req.session.user.id]
    );
    if (!community) return res.status(403).send('Forbidden');

    const { name, description, price, billing_type, trial_days, is_active } = req.body;

    await update('membership_plans', {
      name:         name.trim(),
      description:  description ? description.trim() : null,
      price:        parseFloat(price) || 0,
      billing_type: billing_type || 'free',
      trial_days:   parseInt(trial_days) || 0,
      is_active:    is_active ? 1 : 0,
    }, 'id = ? AND community_id = ?', [req.params.planId, community.id]);

    req.flash('success', 'Plan updated!');
    res.redirect(`/communities/${req.params.slug}/plans`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to update plan.');
    res.redirect(`/communities/${req.params.slug}/plans`);
  }
};

// POST /communities/:slug/plans/:planId/delete
exports.deletePlan = async (req, res) => {
  try {
    const community = await queryOne(
      'SELECT * FROM communities WHERE slug = ? AND owner_id = ?',
      [req.params.slug, req.session.user.id]
    );
    if (!community) return res.status(403).send('Forbidden');

    await remove('membership_plans', 'id = ? AND community_id = ?', [req.params.planId, community.id]);
    req.flash('success', 'Plan deleted.');
    res.redirect(`/communities/${req.params.slug}/plans`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to delete plan.');
    res.redirect(`/communities/${req.params.slug}/plans`);
  }
};

/* ─────────────────────────────────────────────────────────────────────────
   CHECKOUT
───────────────────────────────────────────────────────────────────────── */

// GET /checkout/plan/:planId
exports.getCheckout = async (req, res) => {
  try {
    const plan = await queryOne(
      `SELECT mp.*, c.name AS community_name, c.slug AS community_slug,
              c.avatar AS community_avatar, c.id AS community_id
       FROM membership_plans mp
       JOIN communities c ON mp.community_id = c.id
       WHERE mp.id = ? AND mp.is_active = 1`,
      [req.params.planId]
    );
    if (!plan) return res.status(404).render('errors/404', { title: 'Plan not found' });

    // Already a member?
    const alreadyMember = await queryOne(
      'SELECT id FROM community_members WHERE community_id = ? AND user_id = ?',
      [plan.community_id, req.session.user.id]
    );
    if (alreadyMember) {
      req.flash('info', 'You are already a member of this community.');
      return res.redirect(`/communities/${plan.community_slug}`);
    }

    res.render('monetize/checkout', {
      title: `Join ${plan.community_name}`,
      plan,
      formatUSD: ps.formatUSD,
      couponError: null,
    });
  } catch (err) {
    console.error(err);
    res.redirect('/communities');
  }
};

// POST /checkout/plan/:planId
exports.postCheckout = async (req, res) => {
  try {
    const plan = await queryOne(
      `SELECT mp.*, c.name AS community_name, c.slug AS community_slug, c.id AS community_id, c.owner_id
       FROM membership_plans mp
       JOIN communities c ON mp.community_id = c.id
       WHERE mp.id = ? AND mp.is_active = 1`,
      [req.params.planId]
    );
    if (!plan) return res.status(404).send('Plan not found');

    const uid = req.session.user.id;
    let amount = parseFloat(plan.price);
    let couponCode = null;
    let discountAmount = 0;

    // Apply coupon if provided
    if (req.body.coupon_code && req.body.coupon_code.trim()) {
      const couponResult = await ps.applyCoupon(
        req.body.coupon_code.trim(), plan.community_id, amount
      );
      if (couponResult.valid) {
        couponCode    = couponResult.couponCode;
        discountAmount = couponResult.discount;
        amount        = Math.max(0, parseFloat((amount - discountAmount).toFixed(2)));
        await ps.incrementCouponUsage(couponCode, plan.community_id);
      } else {
        req.flash('error', couponResult.message);
        return res.redirect(`/checkout/plan/${plan.id}`);
      }
    }

    const { paymentId, ref, status } = await ps.createPaymentRecord({
      userId:         uid,
      communityId:    plan.community_id,
      planId:         plan.id,
      paymentType:    'community_plan',
      billingType:    plan.billing_type,
      amount,
      couponCode,
      discountAmount,
      notes:          req.body.notes || null,
    });

    if (status === 'successful') {
      req.flash('success', `Welcome to ${plan.community_name}! Your access has been activated.`);
      return res.redirect(`/communities/${plan.community_slug}`);
    }

    // Pending — show confirmation
    res.redirect(`/checkout/success/${ref}`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Checkout failed. Please try again.');
    res.redirect(`/checkout/plan/${req.params.planId}`);
  }
};

// GET /checkout/success/:ref
exports.getSuccess = async (req, res) => {
  try {
    const payment = await queryOne(
      `SELECT p.*, mp.name AS plan_name, c.name AS community_name, c.slug AS community_slug
       FROM payments p
       LEFT JOIN membership_plans mp ON p.plan_id = mp.id
       LEFT JOIN communities c ON p.community_id = c.id
       WHERE p.payment_ref = ? AND p.user_id = ?`,
      [req.params.ref, req.session.user.id]
    );
    if (!payment) return res.status(404).render('errors/404', { title: 'Not found' });

    res.render('monetize/success', {
      title: 'Payment Submitted',
      payment,
      formatUSD: ps.formatUSD,
    });
  } catch (err) {
    console.error(err);
    res.redirect('/communities');
  }
};

// POST /checkout/coupon (AJAX coupon validator)
exports.validateCoupon = async (req, res) => {
  try {
    const { code, community_id, amount } = req.body;
    const result = await ps.applyCoupon(code, parseInt(community_id), parseFloat(amount));
    res.json(result);
  } catch (err) {
    res.json({ valid: false, message: 'Could not validate coupon.' });
  }
};

/* ─────────────────────────────────────────────────────────────────────────
   PAYMENT HISTORY (member view)
───────────────────────────────────────────────────────────────────────── */
exports.myPayments = async (req, res) => {
  try {
    const payments = await query(
      `SELECT p.*, mp.name AS plan_name, c.name AS community_name, c.slug AS community_slug
       FROM payments p
       LEFT JOIN membership_plans mp ON p.plan_id = mp.id
       LEFT JOIN communities c ON p.community_id = c.id
       WHERE p.user_id = ?
       ORDER BY p.created_at DESC LIMIT 50`,
      [req.session.user.id]
    );
    res.render('monetize/my-payments', {
      title: 'My Payment History',
      payments,
      formatUSD: ps.formatUSD,
      timeAgo,
    });
  } catch (err) {
    console.error(err);
    res.render('monetize/my-payments', { title: 'Payment History', payments: [], formatUSD: ps.formatUSD, timeAgo });
  }
};

/* ─────────────────────────────────────────────────────────────────────────
   CREATOR WALLET
───────────────────────────────────────────────────────────────────────── */

// GET /wallet
exports.getWallet = async (req, res) => {
  try {
    const uid = req.session.user.id;
    const wallet = await ps.ensureWallet(uid);

    const transactions = await query(
      `SELECT wt.*, p.payment_ref, p.amount AS payment_amount
       FROM wallet_transactions wt
       LEFT JOIN payments p ON wt.payment_id = p.id
       WHERE wt.wallet_id = ?
       ORDER BY wt.created_at DESC LIMIT 30`,
      [wallet.id]
    );

    // Revenue per community
    const communityRevenue = await query(
      `SELECT c.name, c.slug, c.avatar,
              SUM(p.creator_earning) AS revenue,
              COUNT(DISTINCT p.id)  AS transactions
       FROM payments p
       JOIN communities c ON p.community_id = c.id
       WHERE c.owner_id = ? AND p.status = 'successful'
       GROUP BY c.id ORDER BY revenue DESC LIMIT 10`,
      [uid]
    );

    const payouts = await query(
      'SELECT * FROM payout_requests WHERE user_id = ? ORDER BY requested_at DESC LIMIT 10',
      [uid]
    );

    res.render('monetize/wallet', {
      title: 'Creator Wallet',
      wallet,
      transactions,
      communityRevenue,
      payouts,
      formatUSD: ps.formatUSD,
      timeAgo,
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not load wallet.');
    res.redirect('/profile');
  }
};

/* ─────────────────────────────────────────────────────────────────────────
   PAYOUT REQUESTS
───────────────────────────────────────────────────────────────────────── */

// POST /wallet/payout
exports.requestPayout = async (req, res) => {
  try {
    const uid = req.session.user.id;
    const wallet = await queryOne('SELECT * FROM creator_wallets WHERE user_id = ?', [uid]);
    const minPayout = await queryOne("SELECT setting_value FROM platform_settings WHERE setting_key='min_payout'");
    const minAmount = parseFloat(minPayout?.setting_value || '50');
    const amount = parseFloat(req.body.amount);

    if (!wallet || amount < minAmount) {
      req.flash('error', `Minimum payout is ${ps.formatUSD(minAmount)}.`);
      return res.redirect('/wallet');
    }
    if (amount > wallet.available_balance) {
      req.flash('error', 'Requested amount exceeds your available balance.');
      return res.redirect('/wallet');
    }

    // Pending payout already?
    const pending = await queryOne(
      "SELECT id FROM payout_requests WHERE user_id = ? AND status = 'pending'",
      [uid]
    );
    if (pending) {
      req.flash('error', 'You already have a pending payout request.');
      return res.redirect('/wallet');
    }

    await insert('payout_requests', {
      user_id:        uid,
      amount,
      payout_method:  req.body.payout_method || 'bank_transfer',
      account_name:   req.body.account_name  || null,
      account_email:  req.body.account_email || null,
      account_details: req.body.account_details || null,
    });

    // Move from available to pending
    await update('creator_wallets', {
      available_balance: parseFloat((wallet.available_balance - amount).toFixed(2)),
      pending_balance:   parseFloat((wallet.pending_balance   + amount).toFixed(2)),
    }, 'user_id = ?', [uid]);

    req.flash('success', `Payout request of ${ps.formatUSD(amount)} submitted! You will be notified once approved.`);
    res.redirect('/wallet');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to submit payout request.');
    res.redirect('/wallet');
  }
};

/* ─────────────────────────────────────────────────────────────────────────
   COUPONS
───────────────────────────────────────────────────────────────────────── */

// GET /communities/:slug/coupons
exports.getCoupons = async (req, res) => {
  try {
    const community = await queryOne(
      'SELECT * FROM communities WHERE slug = ? AND owner_id = ?',
      [req.params.slug, req.session.user.id]
    );
    if (!community) return res.status(403).render('errors/403', { title: 'Forbidden' });

    const coupons = await query(
      'SELECT * FROM coupons WHERE community_id = ? ORDER BY created_at DESC',
      [community.id]
    );

    res.render('monetize/coupons', {
      title: `Coupons — ${community.name}`,
      community,
      coupons,
    });
  } catch (err) {
    console.error(err);
    res.redirect(`/communities/${req.params.slug}/settings`);
  }
};

// POST /communities/:slug/coupons
exports.createCoupon = async (req, res) => {
  try {
    const community = await queryOne(
      'SELECT * FROM communities WHERE slug = ? AND owner_id = ?',
      [req.params.slug, req.session.user.id]
    );
    if (!community) return res.status(403).send('Forbidden');

    const { code, discount_type, discount_value, max_uses, expires_at, is_active } = req.body;
    const cleanCode = (code || '').trim().toUpperCase().replace(/\s+/g, '');
    if (!cleanCode || cleanCode.length < 3) {
      req.flash('error', 'Coupon code must be at least 3 characters.');
      return res.redirect(`/communities/${req.params.slug}/coupons`);
    }

    await insert('coupons', {
      community_id:   community.id,
      code:           cleanCode,
      discount_type:  discount_type || 'percentage',
      discount_value: parseFloat(discount_value) || 10,
      max_uses:       parseInt(max_uses) || 0,
      expires_at:     expires_at || null,
      is_active:      is_active ? 1 : 1,
    });

    req.flash('success', `Coupon "${cleanCode}" created!`);
    res.redirect(`/communities/${req.params.slug}/coupons`);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      req.flash('error', 'That coupon code already exists for this community.');
    } else {
      req.flash('error', 'Failed to create coupon.');
      console.error(err);
    }
    res.redirect(`/communities/${req.params.slug}/coupons`);
  }
};

// POST /communities/:slug/coupons/:id/delete
exports.deleteCoupon = async (req, res) => {
  try {
    const community = await queryOne(
      'SELECT * FROM communities WHERE slug = ? AND owner_id = ?',
      [req.params.slug, req.session.user.id]
    );
    if (!community) return res.status(403).send('Forbidden');
    await remove('coupons', 'id = ? AND community_id = ?', [req.params.couponId, community.id]);
    req.flash('success', 'Coupon deleted.');
    res.redirect(`/communities/${req.params.slug}/coupons`);
  } catch (err) {
    res.redirect(`/communities/${req.params.slug}/coupons`);
  }
};

// POST /communities/:slug/coupons/:id/toggle
exports.toggleCoupon = async (req, res) => {
  try {
    const community = await queryOne(
      'SELECT * FROM communities WHERE slug = ? AND owner_id = ?',
      [req.params.slug, req.session.user.id]
    );
    if (!community) return res.status(403).send('Forbidden');
    const coupon = await queryOne('SELECT * FROM coupons WHERE id = ? AND community_id = ?', [req.params.couponId, community.id]);
    if (!coupon) return res.status(404).send('Not found');
    await update('coupons', { is_active: coupon.is_active ? 0 : 1 }, 'id = ?', [coupon.id]);
    res.redirect(`/communities/${req.params.slug}/coupons`);
  } catch (err) {
    res.redirect(`/communities/${req.params.slug}/coupons`);
  }
};

/* ─────────────────────────────────────────────────────────────────────────
   COURSES
───────────────────────────────────────────────────────────────────────── */

// GET /communities/:slug/courses
exports.getCourses = async (req, res) => {
  try {
    const community = await queryOne('SELECT * FROM communities WHERE slug = ?', [req.params.slug]);
    if (!community) return res.status(404).render('errors/404', { title: 'Not found' });

    const membership = req.session.user
      ? await queryOne('SELECT * FROM community_members WHERE community_id = ? AND user_id = ?', [community.id, req.session.user.id])
      : null;
    const isOwner = req.session.user && community.owner_id === req.session.user.id;

    const courses = await query(
      `SELECT co.*, COUNT(DISTINCT cm.id) AS module_count,
              COUNT(DISTINCT cl.id) AS lesson_count
       FROM courses co
       LEFT JOIN course_modules cm ON cm.course_id = co.id
       LEFT JOIN course_lessons cl ON cl.module_id = cm.id
       WHERE co.community_id = ? ${isOwner ? '' : 'AND co.is_published = 1'}
       GROUP BY co.id ORDER BY co.sort_order, co.created_at DESC`,
      [community.id]
    );

    res.render('monetize/courses', {
      title: `Courses — ${community.name}`,
      community, courses, membership, isOwner,
      formatUSD: ps.formatUSD,
    });
  } catch (err) {
    console.error(err);
    res.redirect(`/communities/${req.params.slug}`);
  }
};

// POST /communities/:slug/courses (create)
exports.createCourse = async (req, res) => {
  try {
    const community = await queryOne(
      'SELECT * FROM communities WHERE slug = ? AND owner_id = ?',
      [req.params.slug, req.session.user.id]
    );
    if (!community) return res.status(403).send('Forbidden');

    const { title, description, price, billing_type, is_published } = req.body;
    if (!title || !title.trim()) {
      req.flash('error', 'Course title is required.');
      return res.redirect(`/communities/${req.params.slug}/courses`);
    }

    let slug = makeSlug(title.trim());
    const existing = await queryOne('SELECT id FROM courses WHERE slug = ? AND community_id = ?', [slug, community.id]);
    if (existing) slug = `${slug}-${Date.now()}`;

    let thumbnail = null;
    if (req.files && req.files.thumbnail) {
      const f = req.files.thumbnail;
      const ext = f.name.split('.').pop().toLowerCase();
      if (['jpg','jpeg','png','webp'].includes(ext)) {
        const fname = `course_${Date.now()}.${ext}`;
        await f.mv(`${UPLOAD_DIR}/${fname}`);
        thumbnail = `/uploads/communities/${fname}`;
      }
    }

    const courseId = await insert('courses', {
      community_id: community.id,
      title:        title.trim(),
      slug,
      description:  description ? description.trim() : null,
      thumbnail,
      price:        parseFloat(price) || 0,
      billing_type: billing_type || 'included',
      is_published: is_published ? 1 : 0,
    });

    req.flash('success', `Course "${title.trim()}" created!`);
    res.redirect(`/communities/${req.params.slug}/courses/${courseId}/edit`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to create course.');
    res.redirect(`/communities/${req.params.slug}/courses`);
  }
};

// GET /communities/:slug/courses/:courseId/edit
exports.editCourse = async (req, res) => {
  try {
    const community = await queryOne(
      'SELECT * FROM communities WHERE slug = ? AND owner_id = ?',
      [req.params.slug, req.session.user.id]
    );
    if (!community) return res.status(403).render('errors/403', { title: 'Forbidden' });

    const course = await queryOne('SELECT * FROM courses WHERE id = ? AND community_id = ?', [req.params.courseId, community.id]);
    if (!course) return res.status(404).render('errors/404', { title: 'Not found' });

    const modules = await query(
      `SELECT cm.*, COUNT(cl.id) AS lesson_count
       FROM course_modules cm
       LEFT JOIN course_lessons cl ON cl.module_id = cm.id
       WHERE cm.course_id = ? GROUP BY cm.id ORDER BY cm.sort_order`,
      [course.id]
    );

    // Attach lessons to each module
    for (const mod of modules) {
      mod.lessons = await query(
        'SELECT * FROM course_lessons WHERE module_id = ? ORDER BY sort_order',
        [mod.id]
      );
    }

    const plans = await query('SELECT * FROM membership_plans WHERE community_id = ? AND is_active = 1', [community.id]);

    res.render('monetize/course-edit', {
      title: `Edit Course — ${course.title}`,
      community, course, modules, plans,
      formatUSD: ps.formatUSD,
    });
  } catch (err) {
    console.error(err);
    res.redirect(`/communities/${req.params.slug}/courses`);
  }
};

// POST /communities/:slug/courses/:courseId/update
exports.updateCourse = async (req, res) => {
  try {
    const community = await queryOne('SELECT * FROM communities WHERE slug = ? AND owner_id = ?', [req.params.slug, req.session.user.id]);
    if (!community) return res.status(403).send('Forbidden');

    const { title, description, price, billing_type, is_published } = req.body;
    const updateData = {
      title:        title.trim(),
      description:  description ? description.trim() : null,
      price:        parseFloat(price) || 0,
      billing_type: billing_type || 'included',
      is_published: is_published ? 1 : 0,
    };

    if (req.files && req.files.thumbnail) {
      const f = req.files.thumbnail;
      const ext = f.name.split('.').pop().toLowerCase();
      if (['jpg','jpeg','png','webp'].includes(ext)) {
        const fname = `course_${Date.now()}.${ext}`;
        await f.mv(`${UPLOAD_DIR}/${fname}`);
        updateData.thumbnail = `/uploads/communities/${fname}`;
      }
    }

    await update('courses', updateData, 'id = ? AND community_id = ?', [req.params.courseId, community.id]);
    req.flash('success', 'Course updated!');
    res.redirect(`/communities/${req.params.slug}/courses/${req.params.courseId}/edit`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to update course.');
    res.redirect(`/communities/${req.params.slug}/courses`);
  }
};

// POST /communities/:slug/courses/:courseId/modules (add module)
exports.addModule = async (req, res) => {
  try {
    const community = await queryOne('SELECT * FROM communities WHERE slug = ? AND owner_id = ?', [req.params.slug, req.session.user.id]);
    if (!community) return res.status(403).send('Forbidden');

    const { title } = req.body;
    if (!title || !title.trim()) return res.redirect(`/communities/${req.params.slug}/courses/${req.params.courseId}/edit`);

    const lastMod = await queryOne('SELECT MAX(sort_order) AS max_sort FROM course_modules WHERE course_id = ?', [req.params.courseId]);
    await insert('course_modules', {
      course_id:  req.params.courseId,
      title:      title.trim(),
      sort_order: (lastMod?.max_sort || 0) + 1,
    });

    res.redirect(`/communities/${req.params.slug}/courses/${req.params.courseId}/edit`);
  } catch (err) {
    console.error(err);
    res.redirect(`/communities/${req.params.slug}/courses/${req.params.courseId}/edit`);
  }
};

// POST /communities/:slug/courses/:courseId/modules/:moduleId/lessons
exports.addLesson = async (req, res) => {
  try {
    const community = await queryOne('SELECT * FROM communities WHERE slug = ? AND owner_id = ?', [req.params.slug, req.session.user.id]);
    if (!community) return res.status(403).send('Forbidden');

    const { title, content, video_url, lesson_type, duration_mins, is_free_preview } = req.body;
    if (!title || !title.trim()) return res.redirect(`/communities/${req.params.slug}/courses/${req.params.courseId}/edit`);

    const lastLesson = await queryOne('SELECT MAX(sort_order) AS max_sort FROM course_lessons WHERE module_id = ?', [req.params.moduleId]);

    let file_url = null;
    if (req.files && req.files.lesson_file) {
      const f = req.files.lesson_file;
      const ext = f.name.split('.').pop().toLowerCase();
      const fname = `lesson_${Date.now()}.${ext}`;
      await f.mv(`${UPLOAD_DIR}/${fname}`);
      file_url = `/uploads/communities/${fname}`;
    }

    await insert('course_lessons', {
      module_id:       req.params.moduleId,
      title:           title.trim(),
      content:         content || null,
      video_url:       video_url || null,
      lesson_type:     lesson_type || 'text',
      file_url,
      duration_mins:   parseInt(duration_mins) || 0,
      is_free_preview: is_free_preview ? 1 : 0,
      sort_order:      (lastLesson?.max_sort || 0) + 1,
    });

    res.redirect(`/communities/${req.params.slug}/courses/${req.params.courseId}/edit`);
  } catch (err) {
    console.error(err);
    res.redirect(`/communities/${req.params.slug}/courses/${req.params.courseId}/edit`);
  }
};

// GET /communities/:slug/courses/:courseId (view course)
exports.viewCourse = async (req, res) => {
  try {
    const community = await queryOne('SELECT * FROM communities WHERE slug = ?', [req.params.slug]);
    if (!community) return res.status(404).render('errors/404', { title: 'Not found' });

    const course = await queryOne('SELECT * FROM courses WHERE id = ? AND community_id = ?', [req.params.courseId, community.id]);
    if (!course || (!course.is_published && community.owner_id !== req.session.user?.id)) {
      return res.status(404).render('errors/404', { title: 'Not found' });
    }

    const membership = req.session.user
      ? await queryOne('SELECT * FROM community_members WHERE community_id = ? AND user_id = ?', [community.id, req.session.user.id])
      : null;

    const isOwner = req.session.user && community.owner_id === req.session.user.id;

    const modules = await query('SELECT * FROM course_modules WHERE course_id = ? ORDER BY sort_order', [course.id]);
    for (const mod of modules) {
      mod.lessons = await query('SELECT * FROM course_lessons WHERE module_id = ? ORDER BY sort_order', [mod.id]);
      if (req.session.user) {
        for (const lesson of mod.lessons) {
          const done = await queryOne('SELECT id FROM lesson_completions WHERE user_id = ? AND lesson_id = ?', [req.session.user.id, lesson.id]);
          lesson.completed = !!done;
        }
      }
    }

    const hasAccess = isOwner || (membership && course.billing_type === 'included');

    res.render('monetize/course-view', {
      title: course.title,
      community, course, modules, membership, isOwner, hasAccess,
    });
  } catch (err) {
    console.error(err);
    res.redirect(`/communities/${req.params.slug}/courses`);
  }
};

// POST /communities/:slug/courses/:courseId/lessons/:lessonId/complete
exports.completeLesson = async (req, res) => {
  try {
    const existing = await queryOne('SELECT id FROM lesson_completions WHERE user_id = ? AND lesson_id = ?', [req.session.user.id, req.params.lessonId]);
    if (!existing) {
      await insert('lesson_completions', { user_id: req.session.user.id, lesson_id: req.params.lessonId });
    }
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false });
  }
};

/* ─────────────────────────────────────────────────────────────────────────
   EVENTS
───────────────────────────────────────────────────────────────────────── */

// GET /communities/:slug/events
exports.getEvents = async (req, res) => {
  try {
    const community = await queryOne('SELECT * FROM communities WHERE slug = ?', [req.params.slug]);
    if (!community) return res.status(404).render('errors/404', { title: 'Not found' });

    const membership = req.session.user
      ? await queryOne('SELECT * FROM community_members WHERE community_id = ? AND user_id = ?', [community.id, req.session.user.id])
      : null;
    const isOwner = req.session.user && community.owner_id === req.session.user.id;

    const events = await query(
      `SELECT ce.*,
              COUNT(DISTINCT ea.id) AS attendee_count
       FROM community_events ce
       LEFT JOIN event_attendees ea ON ea.event_id = ce.id
       WHERE ce.community_id = ?
       GROUP BY ce.id ORDER BY ce.starts_at ASC`,
      [community.id]
    );

    // Check if user is attending each event
    if (req.session.user) {
      for (const ev of events) {
        const att = await queryOne('SELECT id FROM event_attendees WHERE event_id = ? AND user_id = ?', [ev.id, req.session.user.id]);
        ev.isAttending = !!att;
      }
    }

    res.render('monetize/events', {
      title: `Events — ${community.name}`,
      community, events, membership, isOwner,
      formatUSD: ps.formatUSD,
    });
  } catch (err) {
    console.error(err);
    res.redirect(`/communities/${req.params.slug}`);
  }
};

// POST /communities/:slug/events
exports.createEvent = async (req, res) => {
  try {
    const community = await queryOne('SELECT * FROM communities WHERE slug = ? AND owner_id = ?', [req.params.slug, req.session.user.id]);
    if (!community) return res.status(403).send('Forbidden');

    const { title, description, event_type, starts_at, ends_at, location, online_link, is_online, price, is_free, max_attendees } = req.body;
    if (!title || !title.trim() || !starts_at) {
      req.flash('error', 'Event title and start date are required.');
      return res.redirect(`/communities/${req.params.slug}/events`);
    }

    await insert('community_events', {
      community_id:  community.id,
      title:         title.trim(),
      description:   description || null,
      event_type:    event_type || 'webinar',
      starts_at:     new Date(starts_at),
      ends_at:       ends_at ? new Date(ends_at) : null,
      location:      location || null,
      online_link:   online_link || null,
      is_online:     is_online ? 1 : 0,
      price:         parseFloat(price) || 0,
      is_free:       is_free ? 1 : 0,
      max_attendees: parseInt(max_attendees) || 0,
    });

    req.flash('success', 'Event created!');
    res.redirect(`/communities/${req.params.slug}/events`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to create event.');
    res.redirect(`/communities/${req.params.slug}/events`);
  }
};

// POST /communities/:slug/events/:eventId/rsvp
exports.rsvpEvent = async (req, res) => {
  try {
    const community = await queryOne('SELECT * FROM communities WHERE slug = ?', [req.params.slug]);
    const event = await queryOne('SELECT * FROM community_events WHERE id = ? AND community_id = ?', [req.params.eventId, community.id]);
    if (!community || !event) return res.status(404).send('Not found');

    const uid = req.session.user.id;

    if (!event.is_free && event.price > 0) {
      // Redirect to checkout for paid event
      const { paymentId, ref, status } = await ps.createPaymentRecord({
        userId: uid, communityId: community.id, eventId: event.id,
        paymentType: 'event', billingType: 'one_time', amount: event.price,
      });
      if (status === 'successful') {
        req.flash('success', 'You are registered for the event!');
        return res.redirect(`/communities/${req.params.slug}/events`);
      }
      return res.redirect(`/checkout/success/${ref}`);
    }

    // Free event RSVP
    const existing = await queryOne('SELECT id FROM event_attendees WHERE event_id = ? AND user_id = ?', [event.id, uid]);
    if (!existing) {
      await insert('event_attendees', { event_id: event.id, user_id: uid, status: 'registered' });
      req.flash('success', 'You are registered for this event!');
    } else {
      await remove('event_attendees', 'event_id = ? AND user_id = ?', [event.id, uid]);
      req.flash('info', 'You have cancelled your registration.');
    }
    res.redirect(`/communities/${req.params.slug}/events`);
  } catch (err) {
    console.error(err);
    res.redirect(`/communities/${req.params.slug}/events`);
  }
};

// POST /communities/:slug/events/:eventId/delete
exports.deleteEvent = async (req, res) => {
  try {
    const community = await queryOne('SELECT * FROM communities WHERE slug = ? AND owner_id = ?', [req.params.slug, req.session.user.id]);
    if (!community) return res.status(403).send('Forbidden');
    await remove('community_events', 'id = ? AND community_id = ?', [req.params.eventId, community.id]);
    req.flash('success', 'Event deleted.');
    res.redirect(`/communities/${req.params.slug}/events`);
  } catch (err) {
    res.redirect(`/communities/${req.params.slug}/events`);
  }
};

/* ─────────────────────────────────────────────────────────────────────────
   DIGITAL PRODUCTS
───────────────────────────────────────────────────────────────────────── */

// GET /communities/:slug/products
exports.getProducts = async (req, res) => {
  try {
    const community = await queryOne('SELECT * FROM communities WHERE slug = ?', [req.params.slug]);
    if (!community) return res.status(404).render('errors/404', { title: 'Not found' });

    const membership = req.session.user
      ? await queryOne('SELECT * FROM community_members WHERE community_id = ? AND user_id = ?', [community.id, req.session.user.id])
      : null;
    const isOwner = req.session.user && community.owner_id === req.session.user.id;

    const products = await query(
      'SELECT * FROM digital_products WHERE community_id = ? ORDER BY created_at DESC',
      [community.id]
    );

    // Check ownership for each product
    if (req.session.user) {
      for (const prod of products) {
        const purchase = await queryOne('SELECT id FROM product_purchases WHERE user_id = ? AND product_id = ?', [req.session.user.id, prod.id]);
        prod.isPurchased = !!purchase;
      }
    }

    res.render('monetize/products', {
      title: `Products — ${community.name}`,
      community, products, membership, isOwner,
      formatUSD: ps.formatUSD,
    });
  } catch (err) {
    console.error(err);
    res.redirect(`/communities/${req.params.slug}`);
  }
};

// POST /communities/:slug/products
exports.createProduct = async (req, res) => {
  try {
    const community = await queryOne('SELECT * FROM communities WHERE slug = ? AND owner_id = ?', [req.params.slug, req.session.user.id]);
    if (!community) return res.status(403).send('Forbidden');

    const { title, description, price, access_type } = req.body;
    if (!title || !title.trim()) {
      req.flash('error', 'Product title is required.');
      return res.redirect(`/communities/${req.params.slug}/products`);
    }

    let file_url = null;
    let preview_image = null;

    if (req.files && req.files.product_file) {
      const f = req.files.product_file;
      const fname = `product_${Date.now()}_${f.name.replace(/\s+/g,'_')}`;
      await f.mv(`${UPLOAD_DIR}/${fname}`);
      file_url = `/uploads/communities/${fname}`;
    }

    if (req.files && req.files.preview_image) {
      const f = req.files.preview_image;
      const ext = f.name.split('.').pop().toLowerCase();
      if (['jpg','jpeg','png','webp'].includes(ext)) {
        const fname = `prodprev_${Date.now()}.${ext}`;
        await f.mv(`${UPLOAD_DIR}/${fname}`);
        preview_image = `/uploads/communities/${fname}`;
      }
    }

    await insert('digital_products', {
      community_id:  community.id,
      title:         title.trim(),
      description:   description || null,
      price:         parseFloat(price) || 0,
      file_url,
      preview_image,
      access_type:   access_type || 'anyone',
    });

    req.flash('success', 'Product created!');
    res.redirect(`/communities/${req.params.slug}/products`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to create product.');
    res.redirect(`/communities/${req.params.slug}/products`);
  }
};

// POST /checkout/product/:productId
exports.buyProduct = async (req, res) => {
  try {
    const product = await queryOne(
      `SELECT dp.*, c.slug AS community_slug, c.id AS community_id, c.name AS community_name
       FROM digital_products dp
       JOIN communities c ON dp.community_id = c.id
       WHERE dp.id = ? AND dp.is_active = 1`,
      [req.params.productId]
    );
    if (!product) return res.status(404).send('Product not found');

    const uid = req.session.user.id;

    // Already purchased?
    const existing = await queryOne('SELECT id FROM product_purchases WHERE user_id = ? AND product_id = ?', [uid, product.id]);
    if (existing) {
      req.flash('info', 'You already own this product.');
      return res.redirect(`/communities/${product.community_slug}/products`);
    }

    let amount = parseFloat(product.price);
    let couponCode = null, discountAmount = 0;

    if (req.body.coupon_code) {
      const cr = await ps.applyCoupon(req.body.coupon_code, product.community_id, amount);
      if (cr.valid) { couponCode = cr.couponCode; discountAmount = cr.discount; amount = Math.max(0, amount - discountAmount); await ps.incrementCouponUsage(couponCode, product.community_id); }
    }

    const { ref, status } = await ps.createPaymentRecord({
      userId: uid, communityId: product.community_id, productId: product.id,
      paymentType: 'digital_product', billingType: 'one_time',
      amount, couponCode, discountAmount,
    });

    if (status === 'successful') {
      req.flash('success', 'Purchase successful! You can now download your product.');
      return res.redirect(`/communities/${product.community_slug}/products`);
    }
    res.redirect(`/checkout/success/${ref}`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Purchase failed.');
    res.redirect(`/communities/${req.params.slug || ''}/products`);
  }
};

// GET /products/:productId/download
exports.downloadProduct = async (req, res) => {
  try {
    const uid = req.session.user.id;
    const product = await queryOne('SELECT * FROM digital_products WHERE id = ?', [req.params.productId]);
    if (!product) return res.status(404).send('Not found');

    // Check purchase or community owner
    const community = await queryOne('SELECT owner_id FROM communities WHERE id = ?', [product.community_id]);
    const isOwner = community.owner_id === uid;
    const purchase = await queryOne('SELECT id FROM product_purchases WHERE user_id = ? AND product_id = ?', [uid, product.id]);

    if (!isOwner && !purchase && product.price > 0) {
      req.flash('error', 'You need to purchase this product first.');
      return res.redirect('/communities');
    }

    if (!product.file_url) return res.status(404).send('File not available');
    const filePath = path.join(__dirname, '..', 'public', product.file_url);
    res.download(filePath);
  } catch (err) {
    console.error(err);
    res.status(500).send('Download failed');
  }
};

// POST /communities/:slug/products/:productId/delete
exports.deleteProduct = async (req, res) => {
  try {
    const community = await queryOne('SELECT * FROM communities WHERE slug = ? AND owner_id = ?', [req.params.slug, req.session.user.id]);
    if (!community) return res.status(403).send('Forbidden');
    await remove('digital_products', 'id = ? AND community_id = ?', [req.params.productId, community.id]);
    req.flash('success', 'Product deleted.');
    res.redirect(`/communities/${req.params.slug}/products`);
  } catch (err) {
    res.redirect(`/communities/${req.params.slug}/products`);
  }
};

/* ─────────────────────────────────────────────────────────────────────────
   ADMIN — MONETIZATION DASHBOARD
───────────────────────────────────────────────────────────────────────── */
exports.adminMonetize = async (req, res) => {
  try {
    const [
      totalRevenue, platformRevenue, pendingPayouts,
      activeSubscriptions, paidCommunities,
      pendingPayoutRequests, recentPayments,
      topCommunities, topCreators, commissionSetting, minPayoutSetting,
    ] = await Promise.all([
      queryOne("SELECT SUM(amount) AS total FROM payments WHERE status='successful'"),
      queryOne("SELECT SUM(platform_fee) AS total FROM payments WHERE status='successful'"),
      queryOne("SELECT SUM(amount) AS total FROM payout_requests WHERE status='pending'"),
      queryOne("SELECT COUNT(*) AS total FROM member_subscriptions WHERE status='active'"),
      queryOne("SELECT COUNT(DISTINCT community_id) AS total FROM payments WHERE status='successful'"),
      query("SELECT pr.*, u.name AS user_name, u.email AS user_email FROM payout_requests pr JOIN users u ON pr.user_id=u.id WHERE pr.status='pending' ORDER BY pr.requested_at DESC"),
      query(`SELECT p.*, u.name AS user_name, c.name AS community_name, mp.name AS plan_name
             FROM payments p
             JOIN users u ON p.user_id=u.id
             LEFT JOIN communities c ON p.community_id=c.id
             LEFT JOIN membership_plans mp ON p.plan_id=mp.id
             ORDER BY p.created_at DESC LIMIT 20`),
      query(`SELECT c.name, c.slug, SUM(p.creator_earning) AS revenue, COUNT(p.id) AS sales
             FROM payments p JOIN communities c ON p.community_id=c.id
             WHERE p.status='successful' GROUP BY c.id ORDER BY revenue DESC LIMIT 5`),
      query(`SELECT u.name, u.avatar, SUM(p.creator_earning) AS revenue
             FROM payments p
             JOIN communities c ON p.community_id=c.id
             JOIN users u ON c.owner_id=u.id
             WHERE p.status='successful' GROUP BY u.id ORDER BY revenue DESC LIMIT 5`),
      queryOne("SELECT setting_value FROM platform_settings WHERE setting_key='commission_pct'"),
      queryOne("SELECT setting_value FROM platform_settings WHERE setting_key='min_payout'"),
    ]);

    res.render('admin/monetize', {
      title: 'Revenue Dashboard',
      totalRevenue:         parseFloat(totalRevenue?.total || 0),
      platformRevenue:      parseFloat(platformRevenue?.total || 0),
      pendingPayouts:       parseFloat(pendingPayouts?.total || 0),
      activeSubscriptions:  activeSubscriptions?.total || 0,
      paidCommunities:      paidCommunities?.total || 0,
      pendingPayoutRequests,
      recentPayments,
      topCommunities,
      topCreators,
      commissionPct:        commissionSetting?.setting_value || '10',
      minPayout:            minPayoutSetting?.setting_value  || '50',
      formatUSD:            ps.formatUSD,
      timeAgo,
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not load revenue dashboard.');
    res.redirect('/admin');
  }
};

// POST /admin/settings/commission
exports.updateCommission = async (req, res) => {
  try {
    const pct      = parseFloat(req.body.commission_pct);
    const minPayout = parseFloat(req.body.min_payout);

    if (pct >= 0 && pct <= 50) {
      await query(
        "INSERT INTO platform_settings (setting_key, setting_value) VALUES ('commission_pct', ?) ON DUPLICATE KEY UPDATE setting_value = ?",
        [pct.toString(), pct.toString()]
      );
    }
    if (minPayout >= 0) {
      await query(
        "INSERT INTO platform_settings (setting_key, setting_value) VALUES ('min_payout', ?) ON DUPLICATE KEY UPDATE setting_value = ?",
        [minPayout.toString(), minPayout.toString()]
      );
    }

    req.flash('success', 'Platform settings updated!');
    res.redirect('/admin/monetize');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to update settings.');
    res.redirect('/admin/monetize');
  }
};

// POST /admin/payouts/:id/approve
exports.adminApprovePayout = async (req, res) => {
  try {
    await ps.approvePayout(req.params.id, req.body.admin_note);
    req.flash('success', 'Payout approved and marked as paid.');
  } catch (err) {
    req.flash('error', 'Failed to approve payout.');
  }
  res.redirect('/admin/monetize');
};

// POST /admin/payouts/:id/reject
exports.adminRejectPayout = async (req, res) => {
  try {
    const payout = await queryOne('SELECT * FROM payout_requests WHERE id = ?', [req.params.id]);
    if (payout && payout.status === 'pending') {
      // Refund to available balance
      const wallet = await queryOne('SELECT * FROM creator_wallets WHERE user_id = ?', [payout.user_id]);
      if (wallet) {
        await update('creator_wallets', {
          available_balance: parseFloat((wallet.available_balance + payout.amount).toFixed(2)),
          pending_balance:   parseFloat(Math.max(0, wallet.pending_balance - payout.amount).toFixed(2)),
        }, 'id = ?', [wallet.id]);
      }
    }
    await ps.rejectPayout(req.params.id, req.body.admin_note);
    req.flash('success', 'Payout rejected. Amount returned to creator balance.');
  } catch (err) {
    req.flash('error', 'Failed to reject payout.');
  }
  res.redirect('/admin/monetize');
};

// POST /admin/payments/:id/approve
exports.adminApprovePayment = async (req, res) => {
  try {
    await ps.approvePayment(req.params.id);
    req.flash('success', 'Payment approved and access granted!');
  } catch (err) {
    req.flash('error', 'Failed to approve payment.');
  }
  res.redirect('/admin/monetize');
};
