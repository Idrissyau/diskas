const { query, queryOne, insert, update } = require('../helpers/db');
const { makeSlug, paginate, timeAgo } = require('../helpers/utils');

exports.index = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const perPage = 12;
    const level = req.query.level;
    const categorySlug = req.query.category;
    const search = req.query.q;

    let whereClause = "s.status = 'active'";
    const params = [];

    if (level) { whereClause += ' AND s.level = ?'; params.push(level); }
    if (categorySlug) { whereClause += ' AND c.slug = ?'; params.push(categorySlug); }
    if (search) {
      whereClause += ' AND (s.title LIKE ? OR s.description LIKE ? OR s.tags LIKE ?)';
      const t = `%${search}%`;
      params.push(t, t, t);
    }

    const [totalRow, skills, categories] = await Promise.all([
      queryOne(`SELECT COUNT(*) AS total FROM skills s LEFT JOIN categories c ON s.category_id = c.id WHERE ${whereClause}`, params),
      query(
        `SELECT s.*, u.name AS author_name, u.avatar AS author_avatar,
                c.name AS category_name, c.color AS category_color
         FROM skills s
         LEFT JOIN users u ON s.user_id = u.id
         LEFT JOIN categories c ON s.category_id = c.id
         WHERE ${whereClause}
         ORDER BY s.created_at DESC
         LIMIT ? OFFSET ?`,
        [...params, perPage, (page - 1) * perPage]
      ),
      query("SELECT * FROM categories WHERE type = 'skill' ORDER BY name"),
    ]);

    const pagination = paginate(totalRow.total, page, perPage);

    res.render('skills/index', {
      title: 'Learn New Skills',
      skills,
      pagination,
      categories,
      filters: { level, category: categorySlug, q: search },
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to load skills.');
    res.redirect('/');
  }
};

exports.show = async (req, res) => {
  try {
    const skill = await queryOne(
      `SELECT s.*, u.name AS author_name, u.avatar AS author_avatar, u.bio AS author_bio,
              c.name AS category_name, c.color AS category_color
       FROM skills s
       LEFT JOIN users u ON s.user_id = u.id
       LEFT JOIN categories c ON s.category_id = c.id
       WHERE s.slug = ? AND s.status = 'active'`,
      [req.params.slug]
    );

    if (!skill) return res.status(404).render('errors/404', { title: 'Skill Not Found' });

    await update('skills', { views: skill.views + 1 }, 'id = ?', [skill.id]);

    const related = await query(
      `SELECT s.*, u.name AS author_name FROM skills s
       LEFT JOIN users u ON s.user_id = u.id
       WHERE s.category_id = ? AND s.id != ? AND s.status = 'active' LIMIT 4`,
      [skill.category_id, skill.id]
    );

    res.render('skills/show', {
      title: skill.title,
      skill: { ...skill, timeAgo: timeAgo(skill.created_at) },
      related,
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to load skill.');
    res.redirect('/skills');
  }
};

exports.getCreate = async (req, res) => {
  const categories = await query("SELECT * FROM categories WHERE type = 'skill' ORDER BY name");
  res.render('skills/create', { title: 'Share a Skill', categories });
};

exports.postCreate = async (req, res) => {
  try {
    const { title, description, level, video_url, resources, tags, category_id } = req.body;

    if (!title || !description) {
      req.flash('error', 'Title and description are required.');
      return res.redirect('/skills/new');
    }

    const baseSlug = makeSlug(title);
    const existing = await queryOne('SELECT id FROM skills WHERE slug = ?', [baseSlug]);
    const slug = existing ? makeSlug(title, Date.now()) : baseSlug;

    const needsModeration = await queryOne("SELECT setting_value FROM settings WHERE setting_key = 'skill_moderation'");
    const status = needsModeration && needsModeration.setting_value === '1' ? 'pending' : 'active';

    let thumbnail = null;
    if (req.files && req.files.thumbnail) {
      const file = req.files.thumbnail;
      const ext = file.name.split('.').pop().toLowerCase();
      if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
        const filename = `skill_${Date.now()}.${ext}`;
        await file.mv(`public/uploads/skills/${filename}`);
        thumbnail = `/uploads/skills/${filename}`;
      }
    }

    await insert('skills', {
      user_id: req.session.user.id,
      category_id: category_id || null,
      title, slug, description,
      level: level || 'beginner',
      thumbnail,
      video_url: video_url || null,
      resources: resources || null,
      tags: tags || null,
      status,
    });

    if (status === 'pending') {
      req.flash('info', 'Skill submitted for review and will be published once approved.');
    } else {
      req.flash('success', 'Skill published successfully!');
    }
    res.redirect('/skills');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to share skill.');
    res.redirect('/skills/new');
  }
};
