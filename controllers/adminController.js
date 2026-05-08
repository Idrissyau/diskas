const bcrypt = require('bcryptjs');
const { query, queryOne, update, remove } = require('../helpers/db');
const { timeAgo } = require('../helpers/utils');

exports.dashboard = async (req, res) => {
  try {
    const [stats, recentUsers, recentPosts, pendingJobs, pendingSkills, reports] = await Promise.all([
      queryOne(`
        SELECT
          (SELECT COUNT(*) FROM users) AS total_users,
          (SELECT COUNT(*) FROM users WHERE DATE(created_at) = CURDATE()) AS new_users_today,
          (SELECT COUNT(*) FROM posts WHERE status != 'deleted') AS total_posts,
          (SELECT COUNT(*) FROM jobs WHERE status = 'active') AS active_jobs,
          (SELECT COUNT(*) FROM jobs WHERE status = 'pending') AS pending_jobs,
          (SELECT COUNT(*) FROM skills WHERE status = 'active') AS active_skills,
          (SELECT COUNT(*) FROM skills WHERE status = 'pending') AS pending_skills,
          (SELECT COUNT(*) FROM reports WHERE status = 'pending') AS pending_reports,
          (SELECT COUNT(*) FROM comments WHERE status = 'active') AS total_comments
      `),
      query('SELECT id, name, email, role, status, created_at FROM users ORDER BY created_at DESC LIMIT 8'),
      query(`
        SELECT p.*, u.name AS author_name FROM posts p
        LEFT JOIN users u ON p.user_id = u.id
        WHERE p.status != 'deleted' ORDER BY p.created_at DESC LIMIT 8
      `),
      query(`SELECT j.*, u.name AS poster_name FROM jobs j LEFT JOIN users u ON j.user_id = u.id WHERE j.status = 'pending' LIMIT 5`),
      query(`SELECT s.*, u.name AS author_name FROM skills s LEFT JOIN users u ON s.user_id = u.id WHERE s.status = 'pending' LIMIT 5`),
      query(`
        SELECT r.*, u.name AS reporter_name FROM reports r
        LEFT JOIN users u ON r.reporter_id = u.id
        WHERE r.status = 'pending' ORDER BY r.created_at DESC LIMIT 5
      `),
    ]);

    res.render('admin/dashboard', {
      title: 'Admin Dashboard',
      stats,
      recentUsers: recentUsers.map(u => ({ ...u, timeAgo: timeAgo(u.created_at) })),
      recentPosts: recentPosts.map(p => ({ ...p, timeAgo: timeAgo(p.created_at) })),
      pendingJobs,
      pendingSkills,
      reports,
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to load dashboard.');
    res.redirect('/');
  }
};

// ── Users ──────────────────────────────────────────────────────────────────
exports.users = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const perPage = 20;
    const search = req.query.q;
    const role = req.query.role;
    const status = req.query.status;

    let where = '1=1';
    const params = [];
    if (search) { where += ' AND (name LIKE ? OR email LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    if (role) { where += ' AND role = ?'; params.push(role); }
    if (status) { where += ' AND status = ?'; params.push(status); }

    const totalRow = await queryOne(`SELECT COUNT(*) AS total FROM users WHERE ${where}`, params);
    const users = await query(
      `SELECT * FROM users WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, perPage, (page - 1) * perPage]
    );
    const { paginate } = require('../helpers/utils');
    const pagination = paginate(totalRow.total, page, perPage);

    res.render('admin/users', { title: 'Manage Users', users, pagination, filters: { q: search, role, status } });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to load users.');
    res.redirect('/admin');
  }
};

exports.updateUser = async (req, res) => {
  try {
    const { role, status } = req.body;
    const userId = req.params.id;
    if (parseInt(userId) === req.session.user.id) {
      req.flash('error', 'You cannot modify your own admin account here.');
      return res.redirect('/admin/users');
    }
    await update('users', { role, status }, 'id = ?', [userId]);
    req.flash('success', 'User updated.');
    res.redirect('/admin/users');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to update user.');
    res.redirect('/admin/users');
  }
};

exports.deleteUser = async (req, res) => {
  try {
    if (parseInt(req.params.id) === req.session.user.id) {
      req.flash('error', 'You cannot delete your own account.');
      return res.redirect('/admin/users');
    }
    await remove('users', 'id = ?', [req.params.id]);
    req.flash('success', 'User deleted.');
    res.redirect('/admin/users');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to delete user.');
    res.redirect('/admin/users');
  }
};

// ── Posts ──────────────────────────────────────────────────────────────────
exports.posts = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const perPage = 20;
    const search = req.query.q;
    const status = req.query.status;

    let where = "p.status != 'deleted'";
    const params = [];
    if (search) { where += ' AND p.title LIKE ?'; params.push(`%${search}%`); }
    if (status) { where += ' AND p.status = ?'; params.push(status); }

    const totalRow = await queryOne(`SELECT COUNT(*) AS total FROM posts p WHERE ${where}`, params);
    const posts = await query(
      `SELECT p.*, u.name AS author_name FROM posts p
       LEFT JOIN users u ON p.user_id = u.id
       WHERE ${where} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
      [...params, perPage, (page - 1) * perPage]
    );
    const { paginate } = require('../helpers/utils');
    const pagination = paginate(totalRow.total, page, perPage);

    res.render('admin/posts', {
      title: 'Manage Posts',
      posts: posts.map(p => ({ ...p, timeAgo: timeAgo(p.created_at) })),
      pagination,
      filters: { q: search, status },
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to load posts.');
    res.redirect('/admin');
  }
};

exports.updatePost = async (req, res) => {
  try {
    await update('posts', { status: req.body.status }, 'id = ?', [req.params.id]);
    req.flash('success', 'Post updated.');
    res.redirect('/admin/posts');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to update post.');
    res.redirect('/admin/posts');
  }
};

// ── Jobs ───────────────────────────────────────────────────────────────────
exports.jobs = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const perPage = 20;
    const status = req.query.status || 'pending';

    const totalRow = await queryOne(`SELECT COUNT(*) AS total FROM jobs WHERE status = ?`, [status]);
    const jobs = await query(
      `SELECT j.*, u.name AS poster_name FROM jobs j
       LEFT JOIN users u ON j.user_id = u.id
       WHERE j.status = ? ORDER BY j.created_at DESC LIMIT ? OFFSET ?`,
      [status, perPage, (page - 1) * perPage]
    );
    const { paginate } = require('../helpers/utils');
    const pagination = paginate(totalRow.total, page, perPage);

    res.render('admin/jobs', {
      title: 'Manage Jobs',
      jobs: jobs.map(j => ({ ...j, timeAgo: timeAgo(j.created_at) })),
      pagination,
      currentStatus: status,
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to load jobs.');
    res.redirect('/admin');
  }
};

exports.updateJob = async (req, res) => {
  try {
    const updates = { status: req.body.status };
    if (req.body.featured !== undefined) updates.featured = req.body.featured === '1' ? 1 : 0;
    await update('jobs', updates, 'id = ?', [req.params.id]);
    req.flash('success', 'Job updated.');
    res.redirect('/admin/jobs');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to update job.');
    res.redirect('/admin/jobs');
  }
};

// ── Skills ─────────────────────────────────────────────────────────────────
exports.skills = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const perPage = 20;
    const status = req.query.status || 'pending';

    const totalRow = await queryOne(`SELECT COUNT(*) AS total FROM skills WHERE status = ?`, [status]);
    const skills = await query(
      `SELECT s.*, u.name AS author_name FROM skills s
       LEFT JOIN users u ON s.user_id = u.id
       WHERE s.status = ? ORDER BY s.created_at DESC LIMIT ? OFFSET ?`,
      [status, perPage, (page - 1) * perPage]
    );
    const { paginate } = require('../helpers/utils');
    const pagination = paginate(totalRow.total, page, perPage);

    res.render('admin/skills', {
      title: 'Manage Skills',
      skills,
      pagination,
      currentStatus: status,
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to load skills.');
    res.redirect('/admin');
  }
};

exports.updateSkill = async (req, res) => {
  try {
    await update('skills', { status: req.body.status }, 'id = ?', [req.params.id]);
    req.flash('success', 'Skill updated.');
    res.redirect('/admin/skills');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to update skill.');
    res.redirect('/admin/skills');
  }
};

// ── Reports ────────────────────────────────────────────────────────────────
exports.reports = async (req, res) => {
  try {
    const reports = await query(`
      SELECT r.*, u.name AS reporter_name
      FROM reports r
      LEFT JOIN users u ON r.reporter_id = u.id
      WHERE r.status = 'pending'
      ORDER BY r.created_at DESC
    `);
    res.render('admin/reports', { title: 'Reports', reports });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to load reports.');
    res.redirect('/admin');
  }
};

exports.resolveReport = async (req, res) => {
  try {
    await update('reports', { status: req.body.status, reviewed_by: req.session.user.id }, 'id = ?', [req.params.id]);
    req.flash('success', 'Report resolved.');
    res.redirect('/admin/reports');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to resolve report.');
    res.redirect('/admin/reports');
  }
};

// ── Settings ───────────────────────────────────────────────────────────────
exports.settings = async (req, res) => {
  try {
    const rows = await query('SELECT * FROM settings');
    const settings = {};
    rows.forEach(r => { settings[r.setting_key] = r.setting_value; });
    res.render('admin/settings', { title: 'Site Settings', settings });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to load settings.');
    res.redirect('/admin');
  }
};

exports.updateSettings = async (req, res) => {
  try {
    const allowed = ['site_name', 'site_tagline', 'maintenance_mode', 'allow_registration',
      'require_email_verification', 'job_moderation', 'skill_moderation', 'posts_per_page'];
    const { pool } = require('../config/database');

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        await pool.execute(
          'INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
          [key, req.body[key], req.body[key]]
        );
      }
    }
    req.flash('success', 'Settings saved.');
    res.redirect('/admin/settings');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to save settings.');
    res.redirect('/admin/settings');
  }
};

// ── Categories ─────────────────────────────────────────────────────────────
exports.categories = async (req, res) => {
  const categories = await query('SELECT * FROM categories ORDER BY type, name');
  res.render('admin/categories', { title: 'Categories', categories });
};

exports.createCategory = async (req, res) => {
  try {
    const { name, description, color, icon, type } = req.body;
    const { makeSlug } = require('../helpers/utils');
    const { insert } = require('../helpers/db');
    const slug = makeSlug(name);
    await insert('categories', { name, slug, description, color: color || '#6366f1', icon: icon || 'folder', type });
    req.flash('success', 'Category created.');
    res.redirect('/admin/categories');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to create category.');
    res.redirect('/admin/categories');
  }
};

exports.deleteCategory = async (req, res) => {
  try {
    await remove('categories', 'id = ?', [req.params.id]);
    req.flash('success', 'Category deleted.');
    res.redirect('/admin/categories');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to delete category.');
    res.redirect('/admin/categories');
  }
};
