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
['public/uploads/avatars', 'public/uploads/logos', 'public/uploads/skills', 'public/uploads/covers', 'public/uploads/communities', 'public/uploads/messages'].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(methodOverride('_method'));
app.use(fileUpload({ limits: { fileSize: 20 * 1024 * 1024 }, useTempFiles: false }));
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
  const isAdmin   = view.startsWith('admin/');
  const isMinimal = view === 'pages/public' || (options && options.layout === 'minimal');

  const layoutFile = isAdmin
    ? path.join(__dirname, 'views/admin/layout.ejs')
    : isMinimal
      ? path.join(__dirname, 'views/layouts/minimal.ejs')
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

// Root: logged-in users go to /home, guests see the landing page
app.get('/', (req, res, next) => {
  if (req.session.user) return res.redirect('/home');
  homeController.index(req, res, next);
});

// /home: feed for logged-in users, guests redirected to /
app.get('/home', homeController.feed);

app.get('/search', homeController.search);

app.use('/auth',        require('./routes/auth'));
app.use('/profile',     require('./routes/profile'));
app.use('/discussions', require('./routes/posts'));
app.use('/jobs',        require('./routes/jobs'));
app.use('/skills',      require('./routes/skills'));
app.use('/admin',       require('./routes/admin'));
app.use('/users',       require('./routes/users'));
app.use('/messages',    require('./routes/messages'));
app.use('/communities', require('./routes/communities'));
app.use('/',            require('./routes/monetize'));
app.use('/pages',       require('./routes/pages'));
// Public landing page view (minimal layout, no navbar)
app.get('/p/:slug',     require('./controllers/landingPageController').viewPublicPage);

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
      `CREATE TABLE IF NOT EXISTS communities (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        owner_id    INT NOT NULL,
        name        VARCHAR(120) NOT NULL,
        slug        VARCHAR(140) NOT NULL UNIQUE,
        description TEXT NOT NULL,
        avatar      VARCHAR(255) DEFAULT NULL,
        cover_image VARCHAR(255) DEFAULT NULL,
        is_private  TINYINT(1) DEFAULT 0,
        status      ENUM('active','suspended') DEFAULT 'active',
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS community_members (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        community_id  INT NOT NULL,
        user_id       INT NOT NULL,
        role          ENUM('owner','admin','member') DEFAULT 'member',
        joined_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_membership (community_id, user_id),
        FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id)      REFERENCES users(id)       ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS community_posts (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        community_id INT NOT NULL,
        user_id      INT NOT NULL,
        title        VARCHAR(255) DEFAULT NULL,
        content      LONGTEXT NOT NULL,
        image        VARCHAR(255) DEFAULT NULL,
        is_pinned    TINYINT(1) DEFAULT 0,
        created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id)      REFERENCES users(id)       ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS community_post_comments (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        post_id    INT NOT NULL,
        user_id    INT NOT NULL,
        content    TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (post_id)  REFERENCES community_posts(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id)  REFERENCES users(id)           ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS message_reactions (
        message_id INT NOT NULL,
        user_id    INT NOT NULL,
        reaction   VARCHAR(20) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (message_id, user_id),
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE
      )`,
    ];
    for (const sql of migrations) await pool.execute(sql);

    // Column additions (safe — silently skip if already present)
    const columnMigrations = [
      `ALTER TABLE users    ADD COLUMN username    VARCHAR(50)  UNIQUE NULL AFTER name`,
      `ALTER TABLE users    ADD COLUMN cover_image VARCHAR(255) NULL AFTER avatar`,
      `ALTER TABLE posts    ADD COLUMN vote_count  INT NOT NULL DEFAULT 0`,
      `ALTER TABLE posts    ADD COLUMN reply_count INT NOT NULL DEFAULT 0`,
      `ALTER TABLE messages ADD COLUMN file_url         VARCHAR(500) DEFAULT NULL`,
      `ALTER TABLE messages ADD COLUMN file_type        VARCHAR(50)  DEFAULT NULL`,
      `ALTER TABLE messages ADD COLUMN file_name        VARCHAR(255) DEFAULT NULL`,
      `ALTER TABLE messages ADD COLUMN reply_to_id      INT          DEFAULT NULL`,
      `ALTER TABLE messages ADD COLUMN reply_to_content VARCHAR(120) DEFAULT NULL`,
      `ALTER TABLE messages ADD COLUMN reply_to_name    VARCHAR(100) DEFAULT NULL`,
    ];
    for (const sql of columnMigrations) {
      try { await pool.execute(sql); } catch (e) { /* column already exists */ }
    }

    // ── Monetization tables ───────────────────────────────────────────────
    const monetizeMigrations = [
      `CREATE TABLE IF NOT EXISTS platform_settings (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        setting_key   VARCHAR(100) UNIQUE NOT NULL,
        setting_value TEXT NOT NULL,
        updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS membership_plans (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        community_id INT NOT NULL,
        name         VARCHAR(100) NOT NULL,
        description  TEXT,
        price        DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        currency     VARCHAR(3) DEFAULT 'USD',
        billing_type ENUM('free','one_time','monthly','yearly','lifetime') DEFAULT 'free',
        trial_days   INT DEFAULT 0,
        is_active    TINYINT(1) DEFAULT 1,
        sort_order   INT DEFAULT 0,
        created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS payments (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        payment_ref     VARCHAR(100) UNIQUE NOT NULL,
        user_id         INT NOT NULL,
        community_id    INT DEFAULT NULL,
        plan_id         INT DEFAULT NULL,
        course_id       INT DEFAULT NULL,
        event_id        INT DEFAULT NULL,
        product_id      INT DEFAULT NULL,
        payment_type    ENUM('community_plan','course','event','digital_product') DEFAULT 'community_plan',
        billing_type    ENUM('free','one_time','monthly','yearly','lifetime') DEFAULT 'one_time',
        amount          DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        currency        VARCHAR(3) DEFAULT 'USD',
        platform_fee    DECIMAL(10,2) DEFAULT 0.00,
        creator_earning DECIMAL(10,2) DEFAULT 0.00,
        status          ENUM('pending','successful','failed','refunded','cancelled') DEFAULT 'pending',
        coupon_code     VARCHAR(50) DEFAULT NULL,
        discount_amount DECIMAL(10,2) DEFAULT 0.00,
        gateway         VARCHAR(50) DEFAULT 'manual',
        gateway_ref     VARCHAR(255) DEFAULT NULL,
        notes           TEXT,
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS member_subscriptions (
        id                      INT AUTO_INCREMENT PRIMARY KEY,
        user_id                 INT NOT NULL,
        community_id            INT NOT NULL,
        plan_id                 INT NOT NULL,
        payment_id              INT DEFAULT NULL,
        status                  ENUM('active','trialing','past_due','cancelled','expired') DEFAULT 'active',
        started_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        trial_ends_at           TIMESTAMP NULL DEFAULT NULL,
        current_period_ends_at  TIMESTAMP NULL DEFAULT NULL,
        cancelled_at            TIMESTAMP NULL DEFAULT NULL,
        created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_sub (user_id, community_id),
        FOREIGN KEY (user_id)      REFERENCES users(id)             ON DELETE CASCADE,
        FOREIGN KEY (community_id) REFERENCES communities(id)       ON DELETE CASCADE,
        FOREIGN KEY (plan_id)      REFERENCES membership_plans(id)  ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS creator_wallets (
        id                INT AUTO_INCREMENT PRIMARY KEY,
        user_id           INT UNIQUE NOT NULL,
        total_earned      DECIMAL(12,2) DEFAULT 0.00,
        available_balance DECIMAL(12,2) DEFAULT 0.00,
        pending_balance   DECIMAL(12,2) DEFAULT 0.00,
        withdrawn_balance DECIMAL(12,2) DEFAULT 0.00,
        currency          VARCHAR(3) DEFAULT 'USD',
        created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS wallet_transactions (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        wallet_id   INT NOT NULL,
        payment_id  INT DEFAULT NULL,
        payout_id   INT DEFAULT NULL,
        type        ENUM('credit','debit','fee','refund') DEFAULT 'credit',
        amount      DECIMAL(10,2) NOT NULL,
        description VARCHAR(255),
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (wallet_id) REFERENCES creator_wallets(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS payout_requests (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        user_id         INT NOT NULL,
        amount          DECIMAL(10,2) NOT NULL,
        currency        VARCHAR(3) DEFAULT 'USD',
        payout_method   VARCHAR(50) DEFAULT 'bank_transfer',
        account_name    VARCHAR(150),
        account_email   VARCHAR(200),
        account_details TEXT,
        status          ENUM('pending','approved','paid','rejected') DEFAULT 'pending',
        admin_note      TEXT,
        requested_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        processed_at    TIMESTAMP NULL DEFAULT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS coupons (
        id             INT AUTO_INCREMENT PRIMARY KEY,
        community_id   INT NOT NULL,
        code           VARCHAR(50) NOT NULL,
        discount_type  ENUM('percentage','fixed') DEFAULT 'percentage',
        discount_value DECIMAL(10,2) NOT NULL,
        applies_to     ENUM('all','plan','course','event','product') DEFAULT 'all',
        applies_to_id  INT DEFAULT NULL,
        max_uses       INT DEFAULT 0,
        used_count     INT DEFAULT 0,
        expires_at     TIMESTAMP NULL DEFAULT NULL,
        is_active      TINYINT(1) DEFAULT 1,
        created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_community_code (community_id, code),
        FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS courses (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        community_id INT NOT NULL,
        plan_id      INT DEFAULT NULL,
        title        VARCHAR(200) NOT NULL,
        slug         VARCHAR(220) NOT NULL,
        description  TEXT,
        thumbnail    VARCHAR(255),
        price        DECIMAL(10,2) DEFAULT 0.00,
        billing_type ENUM('free','one_time','included') DEFAULT 'included',
        is_published TINYINT(1) DEFAULT 0,
        sort_order   INT DEFAULT 0,
        created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS course_modules (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        course_id  INT NOT NULL,
        title      VARCHAR(200) NOT NULL,
        sort_order INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS course_lessons (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        module_id       INT NOT NULL,
        title           VARCHAR(200) NOT NULL,
        content         LONGTEXT,
        video_url       VARCHAR(500),
        lesson_type     ENUM('video','text','download') DEFAULT 'text',
        file_url        VARCHAR(255),
        is_free_preview TINYINT(1) DEFAULT 0,
        duration_mins   INT DEFAULT 0,
        sort_order      INT DEFAULT 0,
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (module_id) REFERENCES course_modules(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS lesson_completions (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        user_id      INT NOT NULL,
        lesson_id    INT NOT NULL,
        completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_completion (user_id, lesson_id),
        FOREIGN KEY (user_id)   REFERENCES users(id)          ON DELETE CASCADE,
        FOREIGN KEY (lesson_id) REFERENCES course_lessons(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS community_events (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        community_id  INT NOT NULL,
        plan_id       INT DEFAULT NULL,
        title         VARCHAR(200) NOT NULL,
        description   TEXT,
        event_type    ENUM('webinar','workshop','coaching','group_call','masterclass','live_class') DEFAULT 'webinar',
        starts_at     TIMESTAMP NOT NULL,
        ends_at       TIMESTAMP NULL DEFAULT NULL,
        location      VARCHAR(255),
        online_link   VARCHAR(500),
        is_online     TINYINT(1) DEFAULT 1,
        price         DECIMAL(10,2) DEFAULT 0.00,
        is_free       TINYINT(1) DEFAULT 1,
        max_attendees INT DEFAULT 0,
        status        ENUM('scheduled','live','ended','cancelled') DEFAULT 'scheduled',
        created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS event_attendees (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        event_id      INT NOT NULL,
        user_id       INT NOT NULL,
        payment_id    INT DEFAULT NULL,
        status        ENUM('registered','attended','cancelled') DEFAULT 'registered',
        registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_attendee (event_id, user_id),
        FOREIGN KEY (event_id) REFERENCES community_events(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id)  REFERENCES users(id)            ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS digital_products (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        community_id  INT NOT NULL,
        title         VARCHAR(200) NOT NULL,
        description   TEXT,
        price         DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        file_url      VARCHAR(500),
        preview_image VARCHAR(255),
        access_type   ENUM('anyone','members_only','plan_only') DEFAULT 'anyone',
        plan_id       INT DEFAULT NULL,
        is_active     TINYINT(1) DEFAULT 1,
        created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE
      )`,
      `CREATE TABLE IF NOT EXISTS product_purchases (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        user_id    INT NOT NULL,
        product_id INT NOT NULL,
        payment_id INT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_purchase (user_id, product_id),
        FOREIGN KEY (user_id)    REFERENCES users(id)              ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES digital_products(id)   ON DELETE CASCADE
      )`,
    ];
    for (const sql of monetizeMigrations) {
      try { await pool.execute(sql); } catch (e) { console.error('Monetize migration error:', e.message); }
    }

    // Monetization column additions on communities table
    const communityColMigrations = [
      `ALTER TABLE communities ADD COLUMN pricing_type ENUM('free','paid','private_paid','invite_only') DEFAULT 'free'`,
      `ALTER TABLE communities ADD COLUMN is_visible TINYINT(1) DEFAULT 1`,
      `ALTER TABLE communities ADD COLUMN require_approval TINYINT(1) DEFAULT 0`,
      `ALTER TABLE communities ADD COLUMN trial_enabled TINYINT(1) DEFAULT 0`,
      `ALTER TABLE communities ADD COLUMN trial_days INT DEFAULT 0`,
    ];
    for (const sql of communityColMigrations) {
      try { await pool.execute(sql); } catch (e) { /* column already exists */ }
    }

    // Digital product column additions
    const productColMigrations = [
      `ALTER TABLE digital_products ADD COLUMN file_name       VARCHAR(255)   DEFAULT NULL`,
      `ALTER TABLE digital_products ADD COLUMN file_size       BIGINT         DEFAULT 0`,
      `ALTER TABLE digital_products ADD COLUMN file_type       VARCHAR(50)    DEFAULT NULL`,
      `ALTER TABLE digital_products ADD COLUMN download_count  INT            DEFAULT 0`,
      `ALTER TABLE digital_products ADD COLUMN buyer_count     INT            DEFAULT 0`,
      `ALTER TABLE digital_products ADD COLUMN sort_order      INT            DEFAULT 0`,
      `ALTER TABLE digital_products ADD COLUMN tags            VARCHAR(255)   DEFAULT NULL`,
      `ALTER TABLE digital_products ADD COLUMN plan_id         INT            DEFAULT NULL`,
      `ALTER TABLE digital_products ADD COLUMN original_price  DECIMAL(10,2)  DEFAULT NULL`,
      `ALTER TABLE digital_products ADD COLUMN button_label    VARCHAR(60)    DEFAULT NULL`,
      `ALTER TABLE digital_products ADD COLUMN button_style    VARCHAR(20)    DEFAULT 'primary'`,
    ];
    for (const sql of productColMigrations) {
      try { await pool.execute(sql); } catch (e) { /* column already exists */ }
    }

    // Video lesson column additions on course_lessons table
    const videoColMigrations = [
      `ALTER TABLE course_lessons MODIFY lesson_type ENUM('text','video','file','link','mixed') DEFAULT 'text'`,
      `ALTER TABLE course_lessons ADD COLUMN video_provider      VARCHAR(50)  DEFAULT NULL`,
      `ALTER TABLE course_lessons ADD COLUMN video_embed_url     VARCHAR(500) DEFAULT NULL`,
      `ALTER TABLE course_lessons ADD COLUMN video_id            VARCHAR(200) DEFAULT NULL`,
      `ALTER TABLE course_lessons ADD COLUMN video_thumbnail_url VARCHAR(500) DEFAULT NULL`,
      `ALTER TABLE course_lessons ADD COLUMN video_duration      VARCHAR(20)  DEFAULT NULL`,
      `ALTER TABLE course_lessons ADD COLUMN video_embed_code    TEXT         DEFAULT NULL`,
      `ALTER TABLE course_lessons ADD COLUMN download_allowed    TINYINT(1)   DEFAULT 0`,
      `ALTER TABLE course_lessons ADD COLUMN autoplay            TINYINT(1)   DEFAULT 0`,
      `ALTER TABLE course_lessons ADD COLUMN required_plan_id    INT          DEFAULT NULL`,
      `ALTER TABLE course_lessons ADD COLUMN completion_tracking TINYINT(1)   DEFAULT 1`,
      `ALTER TABLE course_lessons ADD COLUMN storage_type        VARCHAR(30)  DEFAULT 'text_only'`,
      `ALTER TABLE course_lessons ADD COLUMN external_link       VARCHAR(500) DEFAULT NULL`,
    ];
    for (const sql of videoColMigrations) {
      try { await pool.execute(sql); } catch (e) { /* column already exists or enum unchanged */ }
    }

    // Landing pages table
    try {
      await pool.execute(`CREATE TABLE IF NOT EXISTS landing_pages (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        user_id     INT NOT NULL,
        title       VARCHAR(200) NOT NULL,
        slug        VARCHAR(220) NOT NULL UNIQUE,
        status      ENUM('draft','published') DEFAULT 'draft',
        content     LONGTEXT,
        custom_css  TEXT,
        meta_title  VARCHAR(200),
        meta_desc   VARCHAR(500),
        og_image    VARCHAR(500),
        font        VARCHAR(80) DEFAULT 'Inter',
        primary_color VARCHAR(20) DEFAULT '#6366F1',
        bg_color    VARCHAR(20) DEFAULT '#FFFFFF',
        views       INT DEFAULT 0,
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`);
    } catch(e) { /* table already exists */ }

    // Landing pages column additions
    const landingPageColMigrations = [
      `ALTER TABLE landing_pages ADD COLUMN custom_html LONGTEXT DEFAULT NULL`,
      `ALTER TABLE landing_pages ADD COLUMN custom_js   LONGTEXT DEFAULT NULL`,
    ];
    for (const sql of landingPageColMigrations) {
      try { await pool.execute(sql); } catch(e) { /* column already exists */ }
    }

    // Seed default platform settings
    try {
      await pool.execute("INSERT IGNORE INTO platform_settings (setting_key, setting_value) VALUES ('commission_pct', '10')");
      await pool.execute("INSERT IGNORE INTO platform_settings (setting_key, setting_value) VALUES ('min_payout', '50')");
      // Video provider settings
      await pool.execute("INSERT IGNORE INTO platform_settings (setting_key, setting_value) VALUES ('video_allow_youtube', '1')");
      await pool.execute("INSERT IGNORE INTO platform_settings (setting_key, setting_value) VALUES ('video_allow_vimeo', '1')");
      await pool.execute("INSERT IGNORE INTO platform_settings (setting_key, setting_value) VALUES ('video_allow_bunny', '1')");
      await pool.execute("INSERT IGNORE INTO platform_settings (setting_key, setting_value) VALUES ('video_allow_cloudflare', '1')");
      await pool.execute("INSERT IGNORE INTO platform_settings (setting_key, setting_value) VALUES ('video_allow_embed', '1')");
      await pool.execute("INSERT IGNORE INTO platform_settings (setting_key, setting_value) VALUES ('video_allow_external', '1')");
      await pool.execute("INSERT IGNORE INTO platform_settings (setting_key, setting_value) VALUES ('video_direct_upload', '0')");
      await pool.execute("INSERT IGNORE INTO platform_settings (setting_key, setting_value) VALUES ('video_completion_tracking', '1')");
      await pool.execute("INSERT IGNORE INTO platform_settings (setting_key, setting_value) VALUES ('video_free_preview_allowed', '1')");
      await pool.execute("INSERT IGNORE INTO platform_settings (setting_key, setting_value) VALUES ('max_file_size_image_mb', '2')");
      await pool.execute("INSERT IGNORE INTO platform_settings (setting_key, setting_value) VALUES ('max_file_size_pdf_mb', '10')");
      await pool.execute("INSERT IGNORE INTO platform_settings (setting_key, setting_value) VALUES ('max_file_size_zip_mb', '25')");
    } catch(e) {}

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
