const { query, queryOne } = require('../helpers/db');
const { timeAgo } = require('../helpers/utils');

exports.index = async (req, res) => {
  try {
    const [latestPosts, latestJobs, latestSkills, stats, trendingPosts, popularCategories] = await Promise.all([
      query(`
        SELECT p.id, p.user_id, p.slug, p.title, p.type, p.status, p.is_answered,
               p.vote_count, p.reply_count, p.views, p.created_at,
               u.name AS author_name, u.avatar AS author_avatar,
               c.name AS category_name, c.color AS category_color, c.slug AS category_slug
        FROM posts p
        LEFT JOIN users u ON p.user_id = u.id
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE p.status IN ('active','pinned')
        ORDER BY p.status = 'pinned' DESC, p.created_at DESC
        LIMIT 8
      `),
      query(`
        SELECT j.id, j.user_id, j.slug, j.title, j.company, j.company_logo,
               j.location, j.type, j.salary_min, j.salary_max, j.currency,
               j.featured, j.created_at,
               c.name AS category_name, c.color AS category_color,
               u.name AS poster_name
        FROM jobs j
        LEFT JOIN users u ON j.user_id = u.id
        LEFT JOIN categories c ON j.category_id = c.id
        WHERE j.status = 'active'
        ORDER BY j.featured DESC, j.created_at DESC
        LIMIT 6
      `),
      query(`
        SELECT s.id, s.user_id, s.slug, s.title, s.level, s.description, s.thumbnail, s.views, s.created_at,
               u.name AS author_name
        FROM skills s
        LEFT JOIN users u ON s.user_id = u.id
        WHERE s.status = 'active'
        ORDER BY s.created_at DESC
        LIMIT 6
      `),
      queryOne(`
        SELECT
          (SELECT COUNT(*) FROM users WHERE status = 'active') AS total_users,
          (SELECT COUNT(*) FROM posts WHERE status != 'deleted') AS total_posts,
          (SELECT COUNT(*) FROM jobs WHERE status = 'active') AS total_jobs,
          (SELECT COUNT(*) FROM skills WHERE status = 'active') AS total_skills
      `),
      query(`
        SELECT p.id, p.user_id, p.slug, p.title, p.type, p.vote_count, p.reply_count, p.views,
               u.name AS author_name,
               c.name AS category_name, c.color AS category_color
        FROM posts p
        LEFT JOIN users u ON p.user_id = u.id
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE p.status IN ('active','pinned')
        ORDER BY p.vote_count DESC, p.views DESC, p.created_at DESC
        LIMIT 7
      `),
      query(`
        SELECT c.id, c.name, c.slug, c.color, c.type,
               COUNT(p.id) AS post_count
        FROM categories c
        LEFT JOIN posts p ON p.category_id = c.id AND p.status IN ('active','pinned')
        WHERE c.type = 'discussion'
        GROUP BY c.id
        ORDER BY post_count DESC
        LIMIT 8
      `),
    ]);

    const postsWithTime = latestPosts.map(p => ({ ...p, timeAgo: timeAgo(p.created_at) }));
    const jobsWithTime  = latestJobs.map(j => ({ ...j, timeAgo: timeAgo(j.created_at) }));

    const appUrl = process.env.APP_URL || 'https://diskas.idrisyau.com';
    const commonData = {
      posts: postsWithTime,
      jobs: jobsWithTime,
      skills: latestSkills,
      stats,
      trendingPosts,
      popularCategories,
    };

    // ── Guests only — logged-in users are redirected by the route guard ───
    res.render('home', {
      title: 'Home',
      metaDesc: 'Diskas — find jobs, learn new skills, ask questions, and connect with a global community of professionals and learners.',
      canonicalPath: '/',
      pageSchema: JSON.stringify({
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'WebSite',
            '@id': `${appUrl}/#website`,
            name: 'Diskas',
            url: appUrl,
            description: 'Community platform to find jobs, learn skills, and discuss ideas.',
            potentialAction: { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: `${appUrl}/search?q={search_term_string}` }, 'query-input': 'required name=search_term_string' }
          },
          {
            '@type': 'Organization',
            '@id': `${appUrl}/#organization`,
            name: 'Diskas',
            url: appUrl,
            sameAs: []
          }
        ]
      }),
      ...commonData,
    });
  } catch (err) {
    console.error(err);
    res.render('home', { title: 'Home', posts: [], jobs: [], skills: [], stats: {}, trendingPosts: [], popularCategories: [] });
  }
};

/* ── GET /home  — Feed page for logged-in users ─────────────────────────── */
exports.feed = async (req, res) => {
  // Guest hits /home → send them to the landing page
  if (!req.session.user) return res.redirect('/');

  try {
    const [latestPosts, latestJobs, latestSkills, stats, trendingPosts, popularCategories] = await Promise.all([
      query(`
        SELECT p.id, p.user_id, p.slug, p.title, p.type, p.status, p.is_answered,
               p.vote_count, p.reply_count, p.views, p.created_at,
               u.name AS author_name, u.avatar AS author_avatar,
               c.name AS category_name, c.color AS category_color, c.slug AS category_slug
        FROM posts p
        LEFT JOIN users u ON p.user_id = u.id
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE p.status IN ('active','pinned')
        ORDER BY p.status = 'pinned' DESC, p.created_at DESC
        LIMIT 8
      `),
      query(`
        SELECT j.id, j.user_id, j.slug, j.title, j.company, j.company_logo,
               j.location, j.type, j.salary_min, j.salary_max, j.currency,
               j.featured, j.created_at,
               c.name AS category_name, c.color AS category_color,
               u.name AS poster_name
        FROM jobs j
        LEFT JOIN users u ON j.user_id = u.id
        LEFT JOIN categories c ON j.category_id = c.id
        WHERE j.status = 'active'
        ORDER BY j.featured DESC, j.created_at DESC
        LIMIT 6
      `),
      query(`
        SELECT s.id, s.user_id, s.slug, s.title, s.level, s.description, s.thumbnail, s.views, s.created_at,
               u.name AS author_name
        FROM skills s
        LEFT JOIN users u ON s.user_id = u.id
        WHERE s.status = 'active'
        ORDER BY s.created_at DESC
        LIMIT 8
      `),
      queryOne(`
        SELECT
          (SELECT COUNT(*) FROM users WHERE status = 'active') AS total_users,
          (SELECT COUNT(*) FROM posts WHERE status != 'deleted') AS total_posts,
          (SELECT COUNT(*) FROM jobs WHERE status = 'active') AS total_jobs,
          (SELECT COUNT(*) FROM skills WHERE status = 'active') AS total_skills
      `),
      query(`
        SELECT p.id, p.user_id, p.slug, p.title, p.type, p.vote_count, p.reply_count, p.views,
               u.name AS author_name,
               c.name AS category_name, c.color AS category_color
        FROM posts p
        LEFT JOIN users u ON p.user_id = u.id
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE p.status IN ('active','pinned')
        ORDER BY p.vote_count DESC, p.views DESC, p.created_at DESC
        LIMIT 7
      `),
      query(`
        SELECT c.id, c.name, c.slug, c.color, c.type,
               COUNT(p.id) AS post_count
        FROM categories c
        LEFT JOIN posts p ON p.category_id = c.id AND p.status IN ('active','pinned')
        WHERE c.type = 'discussion'
        GROUP BY c.id
        ORDER BY post_count DESC
        LIMIT 8
      `),
    ]);

    const tab = ['discussions', 'jobs', 'skills'].includes(req.query.tab) ? req.query.tab : 'all';

    const postsWithTime  = latestPosts.map(p => ({ ...p, timeAgo: timeAgo(p.created_at) }));
    const jobsWithTime   = latestJobs.map(j => ({ ...j, timeAgo: timeAgo(j.created_at) }));
    const skillsWithTime = latestSkills.map(s => ({ ...s, timeAgo: timeAgo(s.created_at) }));

    res.render('feed', {
      title: 'Your Feed',
      activeTab: tab,
      posts:  tab === 'jobs' || tab === 'skills' ? [] : postsWithTime,
      jobs:   tab === 'discussions' || tab === 'skills' ? [] : jobsWithTime,
      skills: tab === 'discussions' || tab === 'jobs' ? [] : skillsWithTime,
      stats,
      trendingPosts,
      popularCategories,
    });
  } catch (err) {
    console.error(err);
    res.render('feed', { title: 'Your Feed', activeTab: 'all', posts: [], jobs: [], skills: [], stats: {}, trendingPosts: [], popularCategories: [] });
  }
};

exports.search = async (req, res) => {
  try {
    const { q, type = 'all' } = req.query;
    if (!q || q.trim().length < 2) {
      return res.render('search', { title: 'Search', results: {}, query: q, type });
    }

    const term = `%${q.trim()}%`;
    const results = {};

    if (type === 'all' || type === 'posts') {
      results.posts = await query(
        `SELECT p.*, u.name AS author_name FROM posts p
         LEFT JOIN users u ON p.user_id = u.id
         WHERE (p.title LIKE ? OR p.content LIKE ?) AND p.status != 'deleted'
         LIMIT 10`,
        [term, term]
      );
    }
    if (type === 'all' || type === 'jobs') {
      results.jobs = await query(
        `SELECT * FROM jobs WHERE (title LIKE ? OR company LIKE ? OR description LIKE ?) AND status = 'active' LIMIT 10`,
        [term, term, term]
      );
    }
    if (type === 'all' || type === 'skills') {
      results.skills = await query(
        `SELECT s.*, u.name AS author_name FROM skills s
         LEFT JOIN users u ON s.user_id = u.id
         WHERE (s.title LIKE ? OR s.description LIKE ?) AND s.status = 'active' LIMIT 10`,
        [term, term]
      );
    }

    res.render('search', { title: `Search: ${q}`, results, query: q, type });
  } catch (err) {
    console.error(err);
    res.render('search', { title: 'Search', results: {}, query: req.query.q, type: req.query.type });
  }
};
