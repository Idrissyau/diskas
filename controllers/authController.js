const bcrypt = require('bcryptjs');
const { query, queryOne, insert, update } = require('../helpers/db');

const ALLOWED_IMG = ['jpg', 'jpeg', 'png', 'gif', 'webp'];

/* ── Register ─────────────────────────────────────────────────────────────── */
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
    res.redirect('/home');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Registration failed. Please try again.');
    res.redirect('/auth/register');
  }
};

/* ── Login ────────────────────────────────────────────────────────────────── */
exports.getLogin = (req, res) => {
  if (req.session.user) return res.redirect('/home');
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
    const redirect = req.session.returnTo || '/home';
    delete req.session.returnTo;
    res.redirect(redirect);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Login failed. Please try again.');
    res.redirect('/auth/login');
  }
};

/* ── Logout ───────────────────────────────────────────────────────────────── */
exports.logout = (req, res) => {
  req.session.destroy(() => res.redirect('/'));
};

/* ── View own profile ─────────────────────────────────────────────────────── */
exports.getProfile = async (req, res) => {
  try {
    const user = await queryOne('SELECT * FROM users WHERE id = ?', [req.session.user.id]);
    const [posts, followersRow, followingRow] = await Promise.all([
      query(
        'SELECT id, slug, title, status, views, created_at FROM posts WHERE user_id = ? AND status != "deleted" ORDER BY created_at DESC LIMIT 20',
        [user.id]
      ),
      queryOne('SELECT COUNT(*) AS count FROM follows WHERE following_id = ?', [user.id]),
      queryOne('SELECT COUNT(*) AS count FROM follows WHERE follower_id  = ?', [user.id]),
    ]);
    res.render('auth/profile', {
      title: 'My Profile',
      user,
      posts,
      followerCount:  followersRow?.count || 0,
      followingCount: followingRow?.count  || 0,
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not load profile.');
    res.redirect('/');
  }
};

/* ── Update profile text fields ───────────────────────────────────────────── */
exports.updateProfile = async (req, res) => {
  try {
    const { name, username, bio, location, website } = req.body;

    if (!name || !name.trim()) {
      req.flash('error', 'Name cannot be empty.');
      return res.redirect('/profile?modal=edit');
    }

    // Username validation
    if (username && !/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
      req.flash('error', 'Username must be 3–30 characters (letters, numbers, underscores only).');
      return res.redirect('/profile?modal=edit');
    }
    if (username) {
      const taken = await queryOne(
        'SELECT id FROM users WHERE username = ? AND id != ?',
        [username, req.session.user.id]
      );
      if (taken) {
        req.flash('error', 'That username is already taken.');
        return res.redirect('/profile?modal=edit');
      }
    }

    await update(
      'users',
      {
        name:     name.trim(),
        username: username ? username.trim() : null,
        bio:      bio      || null,
        location: location || null,
        website:  website  || null,
      },
      'id = ?',
      [req.session.user.id]
    );

    const updated = await queryOne('SELECT * FROM users WHERE id = ?', [req.session.user.id]);
    req.session.user = sanitizeUser(updated);
    req.flash('success', 'Profile updated successfully.');
    res.redirect('/profile');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to update profile.');
    res.redirect('/profile?modal=edit');
  }
};

/* ── Upload avatar (dedicated endpoint) ───────────────────────────────────── */
exports.updateAvatar = async (req, res) => {
  try {
    if (!req.files || !req.files.avatar) return res.redirect('/profile');

    const file = req.files.avatar;
    const ext  = file.name.split('.').pop().toLowerCase();
    if (!ALLOWED_IMG.includes(ext)) {
      req.flash('error', 'Invalid image format. Use JPG, PNG, GIF or WEBP.');
      return res.redirect('/profile?modal=edit');
    }

    const filename = `avatar_${req.session.user.id}_${Date.now()}.${ext}`;
    await file.mv(`public/uploads/avatars/${filename}`);

    await update('users', { avatar: `/uploads/avatars/${filename}` }, 'id = ?', [req.session.user.id]);
    const updated = await queryOne('SELECT * FROM users WHERE id = ?', [req.session.user.id]);
    req.session.user = sanitizeUser(updated);
    req.flash('success', 'Avatar updated.');
    res.redirect('/profile');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to upload avatar.');
    res.redirect('/profile');
  }
};

/* ── Upload cover photo (dedicated endpoint) ──────────────────────────────── */
exports.updateCover = async (req, res) => {
  try {
    if (!req.files || !req.files.cover_image) return res.redirect('/profile');

    const file = req.files.cover_image;
    const ext  = file.name.split('.').pop().toLowerCase();
    if (!ALLOWED_IMG.includes(ext)) {
      req.flash('error', 'Invalid image format. Use JPG, PNG, GIF or WEBP.');
      return res.redirect('/profile');
    }

    const filename = `cover_${req.session.user.id}_${Date.now()}.${ext}`;
    await file.mv(`public/uploads/covers/${filename}`);

    await update('users', { cover_image: `/uploads/covers/${filename}` }, 'id = ?', [req.session.user.id]);
    const updated = await queryOne('SELECT * FROM users WHERE id = ?', [req.session.user.id]);
    req.session.user = sanitizeUser(updated);
    req.flash('success', 'Cover photo updated.');
    res.redirect('/profile');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to upload cover photo.');
    res.redirect('/profile');
  }
};

/* ── Change password ──────────────────────────────────────────────────────── */
exports.changePassword = async (req, res) => {
  try {
    const { current_password, new_password, confirm_new_password } = req.body;
    const user = await queryOne('SELECT * FROM users WHERE id = ?', [req.session.user.id]);

    const valid = await bcrypt.compare(current_password, user.password);
    if (!valid) {
      req.flash('error', 'Current password is incorrect.');
      return res.redirect('/profile?modal=password');
    }
    if (new_password !== confirm_new_password) {
      req.flash('error', 'New passwords do not match.');
      return res.redirect('/profile?modal=password');
    }
    if (new_password.length < 6) {
      req.flash('error', 'New password must be at least 6 characters.');
      return res.redirect('/profile?modal=password');
    }

    const hashed = await bcrypt.hash(new_password, 12);
    await update('users', { password: hashed }, 'id = ?', [req.session.user.id]);
    req.flash('success', 'Password changed successfully.');
    res.redirect('/profile');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to change password.');
    res.redirect('/profile?modal=password');
  }
};

/* ── Helper ───────────────────────────────────────────────────────────────── */
function sanitizeUser(user) {
  const { password, ...safe } = user;
  return safe;
}
