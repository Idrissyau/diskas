require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const flash = require('connect-flash');
const cookieParser = require('cookie-parser');
const methodOverride = require('method-override');
const fileUpload = require('express-fileupload');
const path = require('path');
const fs = require('fs');
const ejs = require('ejs');

const { testConnection, pool } = require('./config/database');
const { setLocals } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Upload directories ─────────────────────────────────────────────────────
['public/uploads/avatars', 'public/uploads/logos', 'public/uploads/skills'].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(methodOverride('_method'));
app.use(fileUpload({ limits: { fileSize: 5 * 1024 * 1024 }, useTempFiles: false }));
app.use(express.static(path.join(__dirname, 'public')));

const sessionStore = new MySQLStore({}, pool);
app.use(session({
  secret: process.env.SESSION_SECRET || 'diskas-secret',
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: { secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 },
}));

app.use(flash());
app.use(setLocals);

// ── View Engine ────────────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Custom render that wraps in a layout
const originalRender = app.response.render;
app.response.render = function(view, options, fn) {
  const self = this;
  const req = this.req;

  // Determine which layout to use
  const isAdmin = view.startsWith('admin/');
  const isAuthOnly = ['auth/login', 'auth/register'].includes(view);
  const isError = view.startsWith('errors/');

  const layoutFile = isAdmin
    ? path.join(__dirname, 'views/admin/layout.ejs')
    : path.join(__dirname, 'views/layouts/main.ejs');

  const opts = Object.assign({}, self.locals, options || {});

  // Render the inner view first
  ejs.renderFile(path.join(__dirname, 'views', `${view}.ejs`), opts, {}, (err, body) => {
    if (err) {
      console.error('EJS render error:', err);
      return self.status(500).send('View render error: ' + err.message);
    }

    // Skip layout for raw error pages etc if needed
    ejs.renderFile(layoutFile, { ...opts, body }, {}, (err2, html) => {
      if (err2) {
        console.error('Layout render error:', err2);
        return self.status(500).send('Layout render error: ' + err2.message);
      }
      if (fn) return fn(null, html);
      self.send(html);
    });
  });
};

// ── Sitemap ────────────────────────────────────────────────────────────────
app.get('/sitemap.xml', async (req, res) => {
  try {
    const { query: dbQuery } = require('./helpers/db');
    const base = process.env.APP_URL || 'https://diskas.idrisyau.com';
    const now = new Date().toISOString().split('T')[0];

    const [posts, jobs, skills] = await Promise.all([
      dbQuery(`SELECT slug, created_at FROM posts WHERE status IN ('active','pinned') ORDER BY created_at DESC LIMIT 5000`),
      dbQuery(`SELECT slug, created_at FROM jobs  WHERE status = 'active'             ORDER BY created_at DESC LIMIT 5000`),
      dbQuery(`SELECT slug, created_at FROM skills WHERE status = 'active'            ORDER BY created_at DESC LIMIT 5000`),
    ]);

    const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const url = (loc, lastmod, freq, priority) =>
      `  <url><loc>${esc(loc)}</loc><lastmod>${lastmod}</lastmod><changefreq>${freq}</changefreq><priority>${priority}</priority></url>`;

    const lines = [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
      url(`${base}/`,            now,       'daily',  '1.0'),
      url(`${base}/discussions`, now,       'hourly', '0.9'),
      url(`${base}/jobs`,        now,       'hourly', '0.9'),
      url(`${base}/skills`,      now,       'daily',  '0.9'),
      ...posts.map(p  => url(`${base}/discussions/${p.slug}`,  new Date(p.created_at).toISOString().split('T')[0],  'weekly',  '0.7')),
      ...jobs.map(j   => url(`${base}/jobs/${j.slug}`,         new Date(j.created_at).toISOString().split('T')[0],  'weekly',  '0.8')),
      ...skills.map(s => url(`${base}/skills/${s.slug}`,       new Date(s.created_at).toISOString().split('T')[0],  'monthly', '0.7')),
      `</urlset>`,
    ];

    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(lines.join('\n'));
  } catch (err) {
    console.error('Sitemap error:', err);
    res.status(500).send('Sitemap generation failed');
  }
});

// ── Routes ─────────────────────────────────────────────────────────────────
const homeController = require('./controllers/homeController');
app.get('/', homeController.index);
app.get('/search', homeController.search);

app.use('/auth',        require('./routes/auth'));
app.use('/profile',     require('./routes/profile'));
app.use('/discussions', require('./routes/posts'));
app.use('/jobs',        require('./routes/jobs'));
app.use('/skills',      require('./routes/skills'));
app.use('/admin',       require('./routes/admin'));
app.use('/users',       require('./routes/users'));
app.use('/messages',    require('./routes/messages'));

// Vote endpoint at root level
const postCtrl = require('./controllers/postController');
app.post('/vote', postCtrl.vote);

// ── Admin seed (create first admin from .env) ──────────────────────────────
async function seedAdmin() {
  try {
    const bcrypt = require('bcryptjs');
    const { queryOne, insert } = require('./helpers/db');
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;
    if (!email || !password) return;

    const existing = await queryOne('SELECT id FROM users WHERE email = ?', [email]);
    if (!existing) {
      const hashed = await bcrypt.hash(password, 12);
      await insert('users', {
        name: 'Admin',
        email,
        password: hashed,
        role: 'admin',
        status: 'active',
        email_verified: 1,
      });
      console.log(`✅ Admin account created: ${email}`);
    }
  } catch (err) {
    // Admin already exists or table not yet created
  }
}

// ── 404 ────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).render('errors/404', { title: 'Not Found' });
});

// ── Error handler ──────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Internal Server Error');
});

// ── DB Migrations ──────────────────────────────────────────────────────────
async function runMigrations() {
  try {
    const migrations = [
      `CREATE TABLE IF NOT EXISTS follows (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        follower_id  INT NOT NULL,
        following_id INT NOT NULL,
        created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (follower_id)  REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (following_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE KEY unique_follow (follower_id, following_id)
      )`,
      `CREATE TABLE IF NOT EXISTS conversations (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS conversation_participants (
        conversation_id INT NOT NULL,
        user_id         INT NOT NULL,
        last_read_at    TIMESTAMP NULL DEFAULT NULL,
        PRIMARY KEY (conversation_id, user_id),
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id)         REFERENCES users(id)         ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS messages (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        conversation_id INT  NOT NULL,
        sender_id       INT  NOT NULL,
        content         TEXT NOT NULL,
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
        FOREIGN KEY (sender_id)       REFERENCES users(id)         ON DELETE CASCADE
      )`,
    ];
    for (const sql of migrations) await pool.execute(sql);
    console.log('✅ Migrations complete');
  } catch (err) {
    console.error('Migration error:', err.message);
  }
}

// ── Start ──────────────────────────────────────────────────────────────────
testConnection().then(() => {
  runMigrations();
  seedAdmin();
  app.listen(PORT, () => {
    console.log(`\n🚀 Diskas running at http://localhost:${PORT}`);
    console.log(`📊 Admin dashboard: http://localhost:${PORT}/admin`);
    console.log(`   Admin login: ${process.env.ADMIN_EMAIL || 'Set ADMIN_EMAIL in .env'}\n`);
  });
});
