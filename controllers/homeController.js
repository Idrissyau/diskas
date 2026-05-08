const { query, queryOne } = require('../helpers/db');
const { timeAgo } = require('../helpers/utils');

exports.index = async (req, res) => {
  try {
    const [latestPosts, latestJobs, latestSkills, stats] = await Promise.all([
      query(`
        SELECT p.*, u.name AS author_name, u.avatar AS author_avatar, c.name AS category_name
        FROM posts p
        LEFT JOIN users u ON p.user_id = u.id
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE p.status IN ('active','pinned')
        ORDER BY p.status = 'pinned' DESC, p.created_at DESC
        LIMIT 8
      `),
      query(`
        SELECT j.*, u.name AS poster_name
        FROM jobs j
        LEFT JOIN users u ON j.user_id = u.id
        WHERE j.status = 'active'
        ORDER BY j.featured DESC, j.created_at DESC
        LIMIT 6
      `),
      query(`
        SELECT s.*, u.name AS author_name
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
    ]);

    const postsWithTime = latestPosts.map(p => ({ ...p, timeAgo: timeAgo(p.created_at) }));
    const jobsWithTime = latestJobs.map(j => ({ ...j, timeAgo: timeAgo(j.created_at) }));

    res.render('home', {
      title: 'Home',
      posts: postsWithTime,
      jobs: jobsWithTime,
      skills: latestSkills,
      stats,
    });
  } catch (err) {
    console.error(err);
    res.render('home', { title: 'Home', posts: [], jobs: [], skills: [], stats: {} });
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
