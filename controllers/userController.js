const { query, queryOne, insert, remove } = require('../helpers/db');
const { timeAgo } = require('../helpers/utils');

/* ── Browse users ─────────────────────────────────────────────────────────── */
exports.index = async (req, res) => {
  try {
    const q = req.query.q ? `%${req.query.q.trim()}%` : null;
    let sql = `SELECT id, name, username, avatar, bio, role, created_at,
                      (SELECT COUNT(*) FROM follows WHERE following_id = u.id) AS follower_count
               FROM users u WHERE status = 'active'`;
    const params = [];
    if (q) { sql += ' AND (name LIKE ? OR username LIKE ? OR bio LIKE ?)'; params.push(q, q, q); }
    sql += ' ORDER BY follower_count DESC, created_at DESC LIMIT 40';

    const users = await query(sql, params);

    let followingIds = new Set();
    if (req.session.user) {
      const fl = await query('SELECT following_id FROM follows WHERE follower_id = ?', [req.session.user.id]);
      followingIds = new Set(fl.map(f => f.following_id));
    }

    res.render('users/index', {
      title: 'Find People',
      users: users.map(u => ({ ...u, isFollowing: followingIds.has(u.id), isMe: req.session.user && u.id === req.session.user.id })),
      searchQ: req.query.q || '',
    });
  } catch (err) {
    console.error(err);
    res.render('users/index', { title: 'Find People', users: [], searchQ: '' });
  }
};

/* ── Public profile ───────────────────────────────────────────────────────── */
exports.show = async (req, res) => {
  try {
    const targetId = parseInt(req.params.id);
    const me = req.session.user;

    const user = await queryOne(
      `SELECT id, name, username, avatar, cover_image, bio, location, website, role, created_at
       FROM users WHERE id = ? AND status = 'active'`,
      [targetId]
    );
    if (!user) return res.status(404).render('errors/404', { title: 'User Not Found' });

    const [followersRow, followingRow, posts] = await Promise.all([
      queryOne('SELECT COUNT(*) AS count FROM follows WHERE following_id = ?', [targetId]),
      queryOne('SELECT COUNT(*) AS count FROM follows WHERE follower_id  = ?', [targetId]),
      query(
        `SELECT p.slug, p.title, p.vote_count, p.reply_count, p.views, p.created_at
         FROM posts p
         WHERE p.user_id = ? AND p.status IN ('active','pinned')
         ORDER BY p.created_at DESC LIMIT 6`,
        [targetId]
      ),
    ]);

    let isFollowing = false;
    let existingConvId = null;
    if (me && me.id !== targetId) {
      const [fr, conv] = await Promise.all([
        queryOne('SELECT id FROM follows WHERE follower_id = ? AND following_id = ?', [me.id, targetId]),
        queryOne(
          `SELECT c.id FROM conversations c
           JOIN conversation_participants cp1 ON c.id = cp1.conversation_id AND cp1.user_id = ?
           JOIN conversation_participants cp2 ON c.id = cp2.conversation_id AND cp2.user_id = ?`,
          [me.id, targetId]
        ),
      ]);
      isFollowing  = !!fr;
      existingConvId = conv?.id || null;
    }

    res.render('users/show', {
      title: user.name,
      profile: { ...user, memberSince: timeAgo(user.created_at) },
      followerCount:  followersRow?.count || 0,
      followingCount: followingRow?.count  || 0,
      posts: posts.map(p => ({ ...p, timeAgo: timeAgo(p.created_at) })),
      isFollowing,
      canFollow:  me && me.id !== targetId,
      canMessage: me && me.id !== targetId,
      existingConvId,
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('errors/404', { title: 'Error' });
  }
};

/* ── Toggle follow (JSON) ─────────────────────────────────────────────────── */
exports.follow = async (req, res) => {
  try {
    const me       = req.session.user;
    const targetId = parseInt(req.params.id);

    if (!me)             return res.status(401).json({ error: 'Login required' });
    if (me.id === targetId) return res.status(400).json({ error: 'Cannot follow yourself' });

    const existing = await queryOne(
      'SELECT id FROM follows WHERE follower_id = ? AND following_id = ?',
      [me.id, targetId]
    );

    if (existing) {
      await remove('follows', 'follower_id = ? AND following_id = ?', [me.id, targetId]);
      return res.json({ following: false });
    }
    await insert('follows', { follower_id: me.id, following_id: targetId });
    res.json({ following: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

/* ── Followers list ───────────────────────────────────────────────────────── */
exports.followers = async (req, res) => {
  try {
    const targetId = parseInt(req.params.id);
    const user = await queryOne(
      'SELECT id, name, avatar, role FROM users WHERE id = ? AND status = "active"',
      [targetId]
    );
    if (!user) return res.status(404).render('errors/404', { title: 'Not Found' });

    const list = await query(
      `SELECT u.id, u.name, u.avatar, u.bio, u.role
       FROM users u
       JOIN follows f ON u.id = f.follower_id
       WHERE f.following_id = ?
       ORDER BY f.created_at DESC`,
      [targetId]
    );
    res.render('users/follow-list', { title: `${user.name}'s Followers`, profile: user, list, type: 'followers' });
  } catch (err) {
    console.error(err);
    res.status(500).render('errors/404', { title: 'Error' });
  }
};

/* ── Following list ───────────────────────────────────────────────────────── */
exports.following = async (req, res) => {
  try {
    const targetId = parseInt(req.params.id);
    const user = await queryOne(
      'SELECT id, name, avatar, role FROM users WHERE id = ? AND status = "active"',
      [targetId]
    );
    if (!user) return res.status(404).render('errors/404', { title: 'Not Found' });

    const list = await query(
      `SELECT u.id, u.name, u.avatar, u.bio, u.role
       FROM users u
       JOIN follows f ON u.id = f.following_id
       WHERE f.follower_id = ?
       ORDER BY f.created_at DESC`,
      [targetId]
    );
    res.render('users/follow-list', { title: `${user.name} is Following`, profile: user, list, type: 'following' });
  } catch (err) {
    console.error(err);
    res.status(500).render('errors/404', { title: 'Error' });
  }
};
