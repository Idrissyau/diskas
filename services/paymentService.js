/**
 * paymentService.js — Modular payment service for Diskas
 *
 * GATEWAY SUPPORT
 * ---------------
 * Current mode: "manual"  — payments go Pending, admin approves.
 * Set PAYMENT_MODE=sandbox in .env to auto-approve all payments (testing).
 * Set PAYMENT_MODE=stripe  in .env + add STRIPE_SECRET_KEY to use Stripe.
 *
 * To add Stripe: npm install stripe, then implement the stripe* methods below.
 * To add Paystack / Flutterwave: implement the same interface.
 */

const { query, queryOne, insert, update } = require('../helpers/db');
const { pool } = require('../config/database');
const crypto = require('crypto');

const MODE = process.env.PAYMENT_MODE || 'manual'; // manual | sandbox | stripe

/* ── Helpers ────────────────────────────────────────────────────────────── */
function generateRef() {
  return 'PAY-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

function usd(cents) {
  return (cents / 100).toFixed(2);
}

async function getPlatformCommission() {
  const row = await queryOne(
    "SELECT setting_value FROM platform_settings WHERE setting_key = 'commission_pct'",
    []
  );
  return parseFloat(row?.setting_value || '10');
}

async function getMinPayout() {
  const row = await queryOne(
    "SELECT setting_value FROM platform_settings WHERE setting_key = 'min_payout'",
    []
  );
  return parseFloat(row?.setting_value || '50');
}

/* ── Calculate fees ─────────────────────────────────────────────────────── */
exports.calculatePlatformFee = async (amount) => {
  const pct = await getPlatformCommission();
  const fee = parseFloat((amount * pct / 100).toFixed(2));
  const creator = parseFloat((amount - fee).toFixed(2));
  return { fee, creatorEarning: creator, commissionPct: pct };
};

/* ── Ensure wallet exists for a user ────────────────────────────────────── */
exports.ensureWallet = async (userId) => {
  const existing = await queryOne('SELECT id FROM creator_wallets WHERE user_id = ?', [userId]);
  if (!existing) {
    await insert('creator_wallets', { user_id: userId });
  }
  return queryOne('SELECT * FROM creator_wallets WHERE user_id = ?', [userId]);
};

/* ── Create a payment record ────────────────────────────────────────────── */
exports.createPaymentRecord = async ({
  userId, communityId, planId, courseId, eventId, productId,
  paymentType, billingType, amount, couponCode, discountAmount,
  notes,
}) => {
  const { fee, creatorEarning } = await exports.calculatePlatformFee(amount);
  const ref = generateRef();

  const status = (MODE === 'sandbox' || amount === 0) ? 'successful' : 'pending';

  const paymentId = await insert('payments', {
    payment_ref:     ref,
    user_id:         userId,
    community_id:    communityId || null,
    plan_id:         planId      || null,
    course_id:       courseId    || null,
    event_id:        eventId     || null,
    product_id:      productId   || null,
    payment_type:    paymentType || 'community_plan',
    billing_type:    billingType || 'one_time',
    amount,
    platform_fee:    fee,
    creator_earning: creatorEarning,
    status,
    coupon_code:     couponCode    || null,
    discount_amount: discountAmount || 0,
    gateway:         MODE === 'stripe' ? 'stripe' : (MODE === 'sandbox' ? 'sandbox' : 'manual'),
    notes:           notes || null,
  });

  // Auto-unlock for sandbox or free plans
  if (status === 'successful') {
    await exports.unlockAccessAfterPayment(paymentId);
  }

  return { paymentId, ref, status };
};

/* ── Unlock access after payment ────────────────────────────────────────── */
exports.unlockAccessAfterPayment = async (paymentId) => {
  const payment = await queryOne('SELECT * FROM payments WHERE id = ?', [paymentId]);
  if (!payment || payment.status !== 'successful') return false;

  // 1. Community plan membership
  if (payment.plan_id && payment.community_id) {
    const plan = await queryOne('SELECT * FROM membership_plans WHERE id = ?', [payment.plan_id]);
    if (plan) {
      // Upsert into community_members
      const existing = await queryOne(
        'SELECT id FROM community_members WHERE community_id = ? AND user_id = ?',
        [payment.community_id, payment.user_id]
      );
      if (!existing) {
        await insert('community_members', {
          community_id: payment.community_id,
          user_id:      payment.user_id,
          role:         'member',
        });
      }

      // Upsert subscription
      const existingSub = await queryOne(
        'SELECT id FROM member_subscriptions WHERE user_id = ? AND community_id = ?',
        [payment.user_id, payment.community_id]
      );

      const periodEnd = calcPeriodEnd(plan.billing_type);

      if (existingSub) {
        await update('member_subscriptions',
          { plan_id: plan.id, payment_id: payment.id, status: 'active', current_period_ends_at: periodEnd },
          'id = ?', [existingSub.id]
        );
      } else {
        await insert('member_subscriptions', {
          user_id:                 payment.user_id,
          community_id:            payment.community_id,
          plan_id:                 plan.id,
          payment_id:              payment.id,
          status:                  'active',
          current_period_ends_at:  periodEnd,
        });
      }
    }
  }

  // 2. Digital product access
  if (payment.product_id) {
    const existing = await queryOne(
      'SELECT id FROM product_purchases WHERE user_id = ? AND product_id = ?',
      [payment.user_id, payment.product_id]
    );
    if (!existing) {
      await insert('product_purchases', {
        user_id:    payment.user_id,
        product_id: payment.product_id,
        payment_id: payment.id,
      });
    }
  }

  // 3. Event access
  if (payment.event_id) {
    const existing = await queryOne(
      'SELECT id FROM event_attendees WHERE event_id = ? AND user_id = ?',
      [payment.event_id, payment.user_id]
    );
    if (!existing) {
      await insert('event_attendees', {
        event_id:   payment.event_id,
        user_id:    payment.user_id,
        payment_id: payment.id,
        status:     'registered',
      });
    }
  }

  // 4. Update creator wallet
  await exports.updateWalletAfterPayment(payment);

  return true;
};

/* ── Update creator wallet ──────────────────────────────────────────────── */
exports.updateWalletAfterPayment = async (payment) => {
  if (!payment.community_id) return;
  const community = await queryOne('SELECT owner_id FROM communities WHERE id = ?', [payment.community_id]);
  if (!community) return;

  const ownerId = community.owner_id;
  const wallet  = await exports.ensureWallet(ownerId);

  const earning = parseFloat(payment.creator_earning || 0);

  await update('creator_wallets', {
    total_earned:      parseFloat((wallet.total_earned + earning).toFixed(2)),
    available_balance: parseFloat((wallet.available_balance + earning).toFixed(2)),
  }, 'id = ?', [wallet.id]);

  await insert('wallet_transactions', {
    wallet_id:   wallet.id,
    payment_id:  payment.id,
    type:        'credit',
    amount:      earning,
    description: `Payment received (Ref: ${payment.payment_ref})`,
  });
};

/* ── Apply coupon ───────────────────────────────────────────────────────── */
exports.applyCoupon = async (code, communityId, amount) => {
  const coupon = await queryOne(
    `SELECT * FROM coupons
     WHERE code = ? AND community_id = ? AND is_active = 1
       AND (expires_at IS NULL OR expires_at > NOW())
       AND (max_uses = 0 OR used_count < max_uses)`,
    [code.toUpperCase(), communityId]
  );
  if (!coupon) return { valid: false, message: 'Invalid or expired coupon.' };

  let discount = 0;
  if (coupon.discount_type === 'percentage') {
    discount = parseFloat((amount * coupon.discount_value / 100).toFixed(2));
  } else {
    discount = Math.min(parseFloat(coupon.discount_value), amount);
  }

  return {
    valid: true,
    discount,
    couponId:   coupon.id,
    couponCode: coupon.code,
    type:       coupon.discount_type,
    value:      coupon.discount_value,
  };
};

/* ── Increment coupon usage ─────────────────────────────────────────────── */
exports.incrementCouponUsage = async (code, communityId) => {
  await query(
    'UPDATE coupons SET used_count = used_count + 1 WHERE code = ? AND community_id = ?',
    [code.toUpperCase(), communityId]
  );
};

/* ── Period end calculator ──────────────────────────────────────────────── */
function calcPeriodEnd(billingType) {
  const d = new Date();
  switch (billingType) {
    case 'monthly':  d.setMonth(d.getMonth() + 1); break;
    case 'yearly':   d.setFullYear(d.getFullYear() + 1); break;
    case 'lifetime': d.setFullYear(d.getFullYear() + 100); break;
    default:         d.setFullYear(d.getFullYear() + 100); break; // one_time = permanent
  }
  return d;
}

/* ── Admin: approve payout ──────────────────────────────────────────────── */
exports.approvePayout = async (payoutId, adminNote) => {
  const payout = await queryOne('SELECT * FROM payout_requests WHERE id = ?', [payoutId]);
  if (!payout || payout.status !== 'pending') return false;

  const wallet = await queryOne('SELECT * FROM creator_wallets WHERE user_id = ?', [payout.user_id]);
  if (!wallet || wallet.available_balance < payout.amount) return false;

  await update('creator_wallets', {
    available_balance: parseFloat((wallet.available_balance - payout.amount).toFixed(2)),
    withdrawn_balance: parseFloat((wallet.withdrawn_balance + payout.amount).toFixed(2)),
  }, 'id = ?', [wallet.id]);

  await insert('wallet_transactions', {
    wallet_id:   wallet.id,
    payout_id:   payoutId,
    type:        'debit',
    amount:      payout.amount,
    description: `Payout #${payoutId} approved`,
  });

  await update('payout_requests', {
    status:       'approved',
    admin_note:   adminNote || null,
    processed_at: new Date(),
  }, 'id = ?', [payoutId]);

  return true;
};

/* ── Admin: reject payout ───────────────────────────────────────────────── */
exports.rejectPayout = async (payoutId, adminNote) => {
  await update('payout_requests', {
    status:       'rejected',
    admin_note:   adminNote || null,
    processed_at: new Date(),
  }, 'id = ?', [payoutId]);
  return true;
};

/* ── Admin: approve manual payment ─────────────────────────────────────── */
exports.approvePayment = async (paymentId) => {
  const payment = await queryOne('SELECT * FROM payments WHERE id = ?', [paymentId]);
  if (!payment) return false;
  await update('payments', { status: 'successful' }, 'id = ?', [paymentId]);
  const updated = await queryOne('SELECT * FROM payments WHERE id = ?', [paymentId]);
  await exports.unlockAccessAfterPayment(updated);
  return true;
};

/* ── Format USD ─────────────────────────────────────────────────────────── */
exports.formatUSD = (amount) => {
  return '$' + parseFloat(amount || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};
