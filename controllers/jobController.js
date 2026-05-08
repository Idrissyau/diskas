const { query, queryOne, insert, update } = require('../helpers/db');
const { makeSlug, paginate, timeAgo } = require('../helpers/utils');

exports.index = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const perPage = 12;
    const type = req.query.type;
    const categorySlug = req.query.category;
    const search = req.query.q;

    let whereClause = "j.status = 'active'";
    const params = [];

    if (type) { whereClause += ' AND j.type = ?'; params.push(type); }
    if (categorySlug) { whereClause += ' AND c.slug = ?'; params.push(categorySlug); }
    if (search) {
      whereClause += ' AND (j.title LIKE ? OR j.company LIKE ? OR j.description LIKE ?)';
      const t = `%${search}%`;
      params.push(t, t, t);
    }

    const [totalRow, jobs, categories] = await Promise.all([
      queryOne(`SELECT COUNT(*) AS total FROM jobs j LEFT JOIN categories c ON j.category_id = c.id WHERE ${whereClause}`, params),
      query(
        `SELECT j.*, c.name AS category_name, c.color AS category_color
         FROM jobs j
         LEFT JOIN categories c ON j.category_id = c.id
         WHERE ${whereClause}
         ORDER BY j.featured DESC, j.created_at DESC
         LIMIT ? OFFSET ?`,
        [...params, perPage, (page - 1) * perPage]
      ),
      query("SELECT * FROM categories WHERE type = 'job' ORDER BY name"),
    ]);

    const pagination = paginate(totalRow.total, page, perPage);
    const jobsWithTime = jobs.map(j => ({ ...j, timeAgo: timeAgo(j.created_at) }));

    res.render('jobs/index', {
      title: 'Job Board',
      jobs: jobsWithTime,
      pagination,
      categories,
      filters: { type, category: categorySlug, q: search },
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to load jobs.');
    res.redirect('/');
  }
};

exports.show = async (req, res) => {
  try {
    const job = await queryOne(
      `SELECT j.*, u.name AS poster_name, u.avatar AS poster_avatar,
              c.name AS category_name, c.color AS category_color
       FROM jobs j
       LEFT JOIN users u ON j.user_id = u.id
       LEFT JOIN categories c ON j.category_id = c.id
       WHERE j.slug = ? AND j.status = 'active'`,
      [req.params.slug]
    );

    if (!job) return res.status(404).render('errors/404', { title: 'Job Not Found' });

    await update('jobs', { views: job.views + 1 }, 'id = ?', [job.id]);

    const related = await query(
      `SELECT * FROM jobs WHERE category_id = ? AND id != ? AND status = 'active' LIMIT 4`,
      [job.category_id, job.id]
    );

    res.render('jobs/show', {
      title: job.title,
      job: { ...job, timeAgo: timeAgo(job.created_at) },
      related,
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to load job.');
    res.redirect('/jobs');
  }
};

exports.getCreate = async (req, res) => {
  const categories = await query("SELECT * FROM categories WHERE type = 'job' ORDER BY name");
  res.render('jobs/create', { title: 'Post a Job', categories });
};

exports.postCreate = async (req, res) => {
  try {
    const { title, company, location, type, salary_min, salary_max, currency,
      description, requirements, benefits, apply_url, apply_email, category_id, expires_at } = req.body;

    if (!title || !company || !location || !description) {
      req.flash('error', 'Title, company, location, and description are required.');
      return res.redirect('/jobs/new');
    }

    const baseSlug = makeSlug(`${title}-${company}`);
    const existing = await queryOne('SELECT id FROM jobs WHERE slug = ?', [baseSlug]);
    const slug = existing ? makeSlug(`${title}-${company}`, Date.now()) : baseSlug;

    const needsModeration = await queryOne("SELECT setting_value FROM settings WHERE setting_key = 'job_moderation'");
    const status = needsModeration && needsModeration.setting_value === '1' ? 'pending' : 'active';

    let company_logo = null;
    if (req.files && req.files.company_logo) {
      const file = req.files.company_logo;
      const ext = file.name.split('.').pop().toLowerCase();
      if (['jpg', 'jpeg', 'png', 'webp', 'svg'].includes(ext)) {
        const filename = `logo_${Date.now()}.${ext}`;
        await file.mv(`public/uploads/logos/${filename}`);
        company_logo = `/uploads/logos/${filename}`;
      }
    }

    await insert('jobs', {
      user_id: req.session.user.id,
      category_id: category_id || null,
      title, slug, company, company_logo, location,
      type: type || 'full-time',
      salary_min: salary_min || null,
      salary_max: salary_max || null,
      currency: currency || 'USD',
      description, requirements, benefits,
      apply_url: apply_url || null,
      apply_email: apply_email || null,
      status,
      expires_at: expires_at || null,
    });

    if (status === 'pending') {
      req.flash('info', 'Job submitted for review. It will be visible once approved.');
    } else {
      req.flash('success', 'Job posted successfully!');
    }
    res.redirect('/jobs');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to post job.');
    res.redirect('/jobs/new');
  }
};
