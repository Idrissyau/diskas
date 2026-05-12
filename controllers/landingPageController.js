'use strict';

const { query, queryOne, insert, update, remove } = require('../helpers/db');
const { pool } = require('../config/database');

// ── Helpers ────────────────────────────────────────────────────────────────
function requireAuth(req, res) {
  if (!req.session.user) { res.redirect('/auth/login'); return false; }
  return true;
}

function slugify(str) {
  return str.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
}

// Default block templates
const TEMPLATES = {
  blank: [],
  event: [
    { id: 'b1', type: 'hero',       data: { heading: 'Join Us at [Event Name]', subheading: 'An unforgettable experience you won\'t want to miss.', bgColor: '#1e1b4b', textColor: '#ffffff', align: 'center', btnText: 'Reserve My Spot', btnUrl: '#buy', btnColor: '#6366f1' } },
    { id: 'b2', type: 'countdown',  data: { targetDate: '', label: 'Event starts in', textColor: '#1e293b' } },
    { id: 'b3', type: 'features',   data: { heading: 'What to Expect', items: ['✅ World-class speakers', '✅ Live Q&A sessions', '✅ Networking opportunities', '✅ Recorded replay access'] } },
    { id: 'b4', type: 'text',       data: { html: '<h2>About the Event</h2><p>Describe your event here. Share the agenda, speakers, location details, and anything else attendees need to know.</p>' } },
    { id: 'b5', type: 'cta',        data: { heading: 'Ready to Join?', sub: 'Limited seats available. Secure yours now.', btnText: 'Get My Ticket', btnUrl: '#buy', bgColor: '#6366f1', textColor: '#fff' } },
  ],
  course: [
    { id: 'b1', type: 'hero',       data: { heading: 'Master [Skill] in [Timeframe]', subheading: 'A step-by-step course for beginners to advanced learners.', bgColor: '#0f172a', textColor: '#ffffff', align: 'center', btnText: 'Enroll Now', btnUrl: '#buy', btnColor: '#10b981' } },
    { id: 'b2', type: 'features',   data: { heading: 'What You\'ll Learn', items: ['📖 Module 1: Foundations', '🚀 Module 2: Core Concepts', '🛠 Module 3: Hands-on Projects', '🏆 Module 4: Advanced Techniques', '🎓 Certificate of Completion'] } },
    { id: 'b3', type: 'text',       data: { html: '<h2>About This Course</h2><p>Share what makes your course unique. Talk about the curriculum, your teaching style, and what transformation students will experience.</p>' } },
    { id: 'b4', type: 'testimonial',data: { heading: 'What Students Say', items: [{ quote: '"This course completely changed my career trajectory."', name: 'Jane D.', title: 'Product Designer' }, { quote: '"Best investment I\'ve made in my education."', name: 'Mark R.', title: 'Developer' }] } },
    { id: 'b5', type: 'cta',        data: { heading: 'Start Learning Today', sub: 'Join hundreds of students transforming their skills.', btnText: 'Enroll Now', btnUrl: '#buy', bgColor: '#10b981', textColor: '#fff' } },
  ],
  product: [
    { id: 'b1', type: 'hero',       data: { heading: '[Product Name]', subheading: 'The ultimate resource to help you [achieve goal].', bgColor: '#f8fafc', textColor: '#0f172a', align: 'center', btnText: 'Buy Now', btnUrl: '#buy', btnColor: '#6366f1' } },
    { id: 'b2', type: 'features',   data: { heading: 'What\'s Inside', items: ['📄 50-page guide', '🎯 Templates & checklists', '🎥 Tutorial videos', '💬 Private community access'] } },
    { id: 'b3', type: 'text',       data: { html: '<h2>Is This For You?</h2><p>This product is perfect for people who want to [outcome]. Whether you\'re a beginner or a professional, this gives you everything you need.</p>' } },
    { id: 'b4', type: 'cta',        data: { heading: 'Get Instant Access', sub: 'One-time purchase. Lifetime access.', btnText: 'Buy Now', btnUrl: '#buy', bgColor: '#6366f1', textColor: '#fff' } },
  ],
  community: [
    { id: 'b1', type: 'hero',       data: { heading: 'Join [Community Name]', subheading: 'A thriving community of like-minded people growing together.', bgColor: '#1e1b4b', textColor: '#ffffff', align: 'center', btnText: 'Join the Community', btnUrl: '#buy', btnColor: '#8b5cf6' } },
    { id: 'b2', type: 'features',   data: { heading: 'Community Benefits', items: ['🤝 Connect with peers', '📚 Exclusive resources', '🎤 Weekly live sessions', '🏅 Recognition & rewards', '💬 Private discussions'] } },
    { id: 'b3', type: 'text',       data: { html: '<h2>Who We Are</h2><p>Tell your community\'s story. Share the mission, values, and what makes it special. Help potential members envision their life inside your community.</p>' } },
    { id: 'b4', type: 'testimonial',data: { heading: 'What Members Say', items: [{ quote: '"Best community I\'ve ever joined."', name: 'Alex T.', title: 'Member' }, { quote: '"The value here is incredible."', name: 'Sarah K.', title: 'Member' }] } },
    { id: 'b5', type: 'cta',        data: { heading: 'Ready to Join?', sub: 'Start your journey with us today.', btnText: 'Join Now', btnUrl: '#buy', bgColor: '#8b5cf6', textColor: '#fff' } },
  ],
};

// ── My Pages (list) ────────────────────────────────────────────────────────
exports.listPages = async (req, res) => {
  if (!requireAuth(req, res)) return;
  try {
    const pages = await query(
      `SELECT id, title, slug, status, views, created_at, updated_at
       FROM landing_pages WHERE user_id = ? ORDER BY updated_at DESC`,
      [req.session.user.id]
    );
    res.render('pages/index', { title: 'My Pages', pages });
  } catch (err) {
    console.error('listPages error:', err);
    res.status(500).send('Error loading pages');
  }
};

// ── Builder (new page) ─────────────────────────────────────────────────────
exports.newPage = async (req, res) => {
  if (!requireAuth(req, res)) return;
  res.render('pages/builder', {
    title: 'New Page',
    page: null,
    blocksJson: '[]',
    templates: JSON.stringify(TEMPLATES),
  });
};

// ── Builder (edit existing) ────────────────────────────────────────────────
exports.editPage = async (req, res) => {
  if (!requireAuth(req, res)) return;
  try {
    const page = await queryOne(
      `SELECT * FROM landing_pages WHERE id = ? AND user_id = ?`,
      [req.params.id, req.session.user.id]
    );
    if (!page) return res.status(404).render('errors/404', { title: 'Not Found' });

    res.render('pages/builder', {
      title: `Edit: ${page.title}`,
      page,
      blocksJson: page.content || '[]',
      templates: JSON.stringify(TEMPLATES),
    });
  } catch (err) {
    console.error('editPage error:', err);
    res.status(500).send('Error loading page editor');
  }
};

// ── Save (AJAX) ────────────────────────────────────────────────────────────
exports.savePage = async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const { id, title, slug: rawSlug, content, custom_css, custom_html, custom_js,
            meta_title, meta_desc, og_image, font, primary_color, bg_color, status } = req.body;

    const slug = rawSlug ? slugify(rawSlug) : slugify(title || 'my-page');
    if (!slug) return res.status(400).json({ error: 'Invalid slug' });

    const allowedStatus = ['draft', 'published'].includes(status) ? status : 'draft';
    const allowedFont   = ['Inter','Poppins','Lato','Montserrat','Playfair Display'].includes(font) ? font : 'Inter';

    if (id) {
      // Update
      const existing = await queryOne(`SELECT id FROM landing_pages WHERE id = ? AND user_id = ?`, [id, req.session.user.id]);
      if (!existing) return res.status(403).json({ error: 'Forbidden' });

      // Check slug uniqueness (excluding self)
      const slugConflict = await queryOne(`SELECT id FROM landing_pages WHERE slug = ? AND id != ?`, [slug, id]);
      if (slugConflict) return res.status(400).json({ error: 'That URL slug is already taken' });

      await pool.execute(
        `UPDATE landing_pages SET title=?, slug=?, content=?, custom_css=?, custom_html=?, custom_js=?,
         meta_title=?, meta_desc=?, og_image=?, font=?, primary_color=?, bg_color=?, status=?, updated_at=NOW()
         WHERE id = ? AND user_id = ?`,
        [title||'Untitled', slug, content||'[]', custom_css||'', custom_html||'', custom_js||'',
         meta_title||'', meta_desc||'', og_image||'', allowedFont,
         primary_color||'#6366F1', bg_color||'#FFFFFF', allowedStatus,
         id, req.session.user.id]
      );
      return res.json({ success: true, id, slug });
    } else {
      // Create
      const slugConflict = await queryOne(`SELECT id FROM landing_pages WHERE slug = ?`, [slug]);
      if (slugConflict) return res.status(400).json({ error: 'That URL slug is already taken' });

      const result = await pool.execute(
        `INSERT INTO landing_pages (user_id, title, slug, content, custom_css, custom_html, custom_js,
         meta_title, meta_desc, og_image, font, primary_color, bg_color, status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [req.session.user.id, title||'Untitled', slug, content||'[]', custom_css||'',
         custom_html||'', custom_js||'', meta_title||'', meta_desc||'', og_image||'', allowedFont,
         primary_color||'#6366F1', bg_color||'#FFFFFF', allowedStatus]
      );
      const newId = result[0].insertId;
      return res.json({ success: true, id: newId, slug });
    }
  } catch (err) {
    console.error('savePage error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ── Delete ─────────────────────────────────────────────────────────────────
exports.deletePage = async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const page = await queryOne(`SELECT id FROM landing_pages WHERE id = ? AND user_id = ?`, [req.params.id, req.session.user.id]);
    if (!page) return res.status(403).json({ error: 'Forbidden' });
    await pool.execute(`DELETE FROM landing_pages WHERE id = ?`, [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('deletePage error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ── Public View (/p/:slug) ─────────────────────────────────────────────────
exports.viewPublicPage = async (req, res) => {
  try {
    const page = await queryOne(
      `SELECT lp.*, u.name AS creator_name, u.avatar AS creator_avatar
       FROM landing_pages lp JOIN users u ON lp.user_id = u.id
       WHERE lp.slug = ?`,
      [req.params.slug]
    );
    if (!page) return res.status(404).render('errors/404', { title: 'Page Not Found' });
    if (page.status !== 'published') {
      // Only the owner can preview
      if (!req.session.user || req.session.user.id !== page.user_id) {
        return res.status(404).render('errors/404', { title: 'Page Not Found' });
      }
    }

    // Increment view count (non-blocking)
    pool.execute(`UPDATE landing_pages SET views = views + 1 WHERE id = ?`, [page.id]).catch(() => {});

    let blocks = [];
    try { blocks = JSON.parse(page.content || '[]'); } catch(e) {}

    const appUrl = process.env.APP_URL || 'https://diskas.idrisyau.com';

    res.render('pages/public', {
      title:      page.meta_title || page.title,
      metaTitle:  page.meta_title || page.title,
      metaDesc:   page.meta_desc  || '',
      ogImage:    page.og_image   || '',
      canonicalUrl: `${appUrl}/p/${page.slug}`,
      pageFont:   page.font        || 'Inter',
      customCSS:  page.custom_css  || '',
      customHTML: page.custom_html || '',
      customJS:   page.custom_js   || '',
      page,
      blocks,
      appUrl,
      isOwnerPreview: !!(req.session.user && req.session.user.id === page.user_id && page.status !== 'published'),
    });
  } catch (err) {
    console.error('viewPublicPage error:', err);
    res.status(500).send('Error loading page');
  }
};

// ── Duplicate ──────────────────────────────────────────────────────────────
exports.duplicatePage = async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const page = await queryOne(`SELECT * FROM landing_pages WHERE id = ? AND user_id = ?`, [req.params.id, req.session.user.id]);
    if (!page) return res.status(403).json({ error: 'Forbidden' });

    let newSlug = page.slug + '-copy';
    let attempts = 0;
    while (await queryOne(`SELECT id FROM landing_pages WHERE slug = ?`, [newSlug])) {
      attempts++;
      newSlug = page.slug + '-copy-' + attempts;
    }

    const result = await pool.execute(
      `INSERT INTO landing_pages (user_id, title, slug, content, custom_css, meta_title, meta_desc,
       og_image, font, primary_color, bg_color, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,'draft')`,
      [req.session.user.id, page.title + ' (Copy)', newSlug, page.content, page.custom_css,
       page.meta_title, page.meta_desc, page.og_image, page.font, page.primary_color, page.bg_color]
    );
    res.json({ success: true, id: result[0].insertId, slug: newSlug });
  } catch (err) {
    console.error('duplicatePage error:', err);
    res.status(500).json({ error: err.message });
  }
};
