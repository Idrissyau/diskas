const bcrypt = require('bcryptjs');
const { query, queryOne, insert } = require('../helpers/db');
const { makeSlug } = require('../helpers/utils');

exports.getRegister = (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('auth/register', { title: 'Create Account' });
};

exports.postRegister = async (req, res) => {
  try {
    const { name, email, password, confirm_password } = req.body;

    if (!name || !email || !password) {
      req.flash('error', 'All fields are required.');
      return res.redirect('/auth/register');
    }
    if (password !== confirm_password) {
      req.flash('error', 'Passwords do not match.');
      return res.redirect('/auth/register');
    }
    if (password.length < 6) {
      req.flash('error', 'Password must be at least 6 characters.');
      return res.redirect('/auth/register');
    }

    const existing = await queryOne('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) {
      req.flash('error', 'Email is already registered.');
      return res.redirect('/auth/register');
    }

    const hashed = await bcrypt.hash(password, 12);
    const userId = await insert('users', { name, email, password: hashed });

    const user = await queryOne('SELECT * FROM users WHERE id = ?', [userId]);
    req.session.user = sanitizeUser(user);
    req.flash('success', `Welcome to Diskas, ${name}!`);
    res.redirect('/');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Registration failed. Please try again.');
    res.redirect('/auth/register');
  }
};

exports.getLogin = (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('auth/login', { title: 'Sign In' });
};

exports.postLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      req.flash('error', 'Email and password are required.');
      return res.redirect('/auth/login');
    }

    const user = await queryOne('SELECT * FROM users WHERE email = ?', [email]);
    if (!user) {
      req.flash('error', 'Invalid email or password.');
      return res.redirect('/auth/login');
    }
    if (user.status === 'banned') {
      req.flash('error', 'Your account has been banned. Contact support.');
      return res.redirect('/auth/login');
    }
    if (user.status === 'suspended') {
      req.flash('error', 'Your account is suspended. Contact support.');
      return res.redirect('/auth/login');
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      req.flash('error', 'Invalid email or password.');
      return res.redirect('/auth/login');
    }

    req.session.user = sanitizeUser(user);
    req.flash('success', `Welcome back, ${user.name}!`);
    const redirect = req.session.returnTo || '/';
    delete req.session.returnTo;
    res.redirect(redirect);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Login failed. Please try again.');
    res.redirect('/auth/login');
  }
};

exports.logout = (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
};

exports.getProfile = async (req, res) => {
  try {
    const user = await queryOne('SELECT * FROM users WHERE id = ?', [req.session.user.id]);
    const posts = await query(
      'SELECT * FROM posts WHERE user_id = ? AND status != "deleted" ORDER BY created_at DESC LIMIT 10',
      [user.id]
    );
    res.render('auth/profile', { title: 'My Profile', user, posts });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not load profile.');
    res.redirect('/');
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const { name, bio, location, website } = req.body;
    const { update } = require('../helpers/db');

    let avatar = req.session.user.avatar;
    if (req.files && req.files.avatar) {
      const file = req.files.avatar;
      const ext = file.name.split('.').pop().toLowerCase();
      const allowed = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
      if (!allowed.includes(ext)) {
        req.flash('error', 'Invalid image format.');
        return res.redirect('/profile');
      }
      const filename = `avatar_${req.session.user.id}_${Date.now()}.${ext}`;
      await file.mv(`public/uploads/avatars/${filename}`);
      avatar = `/uploads/avatars/${filename}`;
    }

    await update('users', { name, bio, location, website, avatar }, 'id = ?', [req.session.user.id]);
    const updated = await queryOne('SELECT * FROM users WHERE id = ?', [req.session.user.id]);
    req.session.user = sanitizeUser(updated);
    req.flash('success', 'Profile updated successfully.');
    res.redirect('/profile');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to update profile.');
    res.redirect('/profile');
  }
};

exports.changePassword = async (req, res) => {
  try {
    const { current_password, new_password, confirm_new_password } = req.body;
    const user = await queryOne('SELECT * FROM users WHERE id = ?', [req.session.user.id]);

    const valid = await bcrypt.compare(current_password, user.password);
    if (!valid) {
      req.flash('error', 'Current password is incorrect.');
      return res.redirect('/profile');
    }
    if (new_password !== confirm_new_password) {
      req.flash('error', 'New passwords do not match.');
      return res.redirect('/profile');
    }
    if (new_password.length < 6) {
      req.flash('error', 'Password must be at least 6 characters.');
      return res.redirect('/profile');
    }

    const { update } = require('../helpers/db');
    const hashed = await bcrypt.hash(new_password, 12);
    await update('users', { password: hashed }, 'id = ?', [req.session.user.id]);
    req.flash('success', 'Password changed successfully.');
    res.redirect('/profile');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to change password.');
    res.redirect('/profile');
  }
};

function sanitizeUser(user) {
  const { password, ...safe } = user;
  return safe;
}
