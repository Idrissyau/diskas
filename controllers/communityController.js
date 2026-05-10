const { query, queryOne, insert, update, remove } = require('../helpers/db');
const { makeSlug, timeAgo, truncate, stripHtml } = require('../helpers/utils');
const fs = require('fs');
const path = require('path');

// Ensure upload directory exists
const uploadDir = 'public/uploads/communities';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// ── GET /communities ─────────────────────────────────────────────────────────
exports.index = async (req, res) => {
  try {
    const searchQ = req.query.q ? `%${req.query.q.trim()}%` : null;
    let sql = `
      SELECT c.*, u.name AS owner_name, u.avatar AS owner_avatar,
             (SELECT COUNT(*) FROM community_members cm WHERE cm.community_id = c.id) AS member_count,
             (SELECT COUNT(*) FROM community_posts cp WHERE cp.community_id = c.id) AS post_count
      FROM communities c
      LEFT JOIN users u ON c.owner_id = u.id
      WHERE c.status = 'active'
    `;
    const params = [];
    if (searchQ) {
      sql += ' AND (c.name LIKE ? OR c.description LIKE ?)';
      params.push(searchQ, searchQ);
    }
    sql += ' ORDER BY member_count DESC, c.created_at DESC LIMIT 50';

    const communities = await query(sql, params);

    let joinedIds = new Set();
    if (req.session.user) {
      const memberships = await query(
        'SELECT community_id FROM community_members WHERE user_id = ?',
        [req.session.user.id]
      );
      joinedIds = new Set(memberships.map(m => m.community_id));
    }

    const list = communities.map(c => ({
      ...c,
      isJoined: joinedIds.has(c.id),
      isOwner: req.session.user && c.owner_id === req.session.user.id,
    }));

    res.render('communities/index', {
      title: 'Communities',
      communities: list,
      searchQ: req.query.q || '',
    });
  } catch (err) {
    console.error(err);
    res.render('communities/index', { title: 'Communities', communities: [], searchQ: '' });
  }
};

// ── GET /communities/new ─────────────────────────────────────────────────────
exports.getCreate = (req, res) => {
  res.render('communities/create', { title: 'Create Community', errors: [] });
};

// ── POST /communities ────────────────────────────────────────────────────────
exports.postCreate = async (req, res) => {
  const errors = [];
  try {
    const { name, description, is_private } = req.body;

    if (!name || name.trim().length < 3)  errors.push('Community name must be at least 3 characters.');
    if (!description || description.trim().length < 10) errors.push('Description must be at least 10 characters.');
    if (errors.length) return res.render('communities/create', { title: 'Create Community', errors });

    let slug = makeSlug(name.trim());
    const existing = await queryOne('SELECT id FROM communities WHERE slug = ?', [slug]);
    if (existing) slug = `${slug}-${Date.now()}`;

    let avatar = null;
    let cover_image = null;

    if (req.files && req.files.avatar) {
      const f = req.files.avatar;
      const ext = f.name.split('.').pop().toLowerCase();
      if (['jpg','jpeg','png','webp','gif'].includes(ext)) {
        const fname = `comm_av_${Date.now()}.${ext}`;
        await f.mv(`public/uploads/communities/${fname}`);
        avatar = `/uploads/communities/${fname}`;
      }
    }

    if (req.files && req.files.cover_image) {
      const f = req.files.cover_image;
      const ext = f.name.split('.').pop().toLowerCase();
      if (['jpg','jpeg','png','webp','gif'].includes(ext)) {
        const fname = `comm_cv_${Date.now()}.${ext}`;
        await f.mv(`public/uploads/communities/${fname}`);
        cover_image = `/uploads/communities/${fname}`;
      }
    }

    const communityId = await insert('communities', {
      owner_id: req.session.user.id,
      name: name.trim(),
      slug,
      description: description.trim(),
      avatar,
      cover_image,
      is_private: is_private ? 1 : 0,
      status: 'active',
    });

    // Auto-join owner
    await insert('community_members', {
      community_id: communityId,
      user_id: req.session.user.id,
      role: 'owner',
    });

    req.flash('success', `"${name.trim()}" community created! Welcome to your new space.`);
    res.redirect(`/communities/${slug}`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to create community. Please try again.');
    res.redirect('/communities/new');
  }
};

// ── GET /communities/:slug ───────────────────────────────────────────────────
exports.show = async (req, res) => {
  try {
    const community = await queryOne(
      `SELECT c.*, u.name AS owner_name, u.avatar AS owner_avatar, u.id AS owner_user_id,
              (SELECT COUNT(*) FROM community_members cm WHERE cm.community_id = c.id) AS member_count,
              (SELECT COUNT(*) FROM community_posts cp WHERE cp.community_id = c.id) AS post_count
       FROM communities c
       LEFT JOIN users u ON c.owner_id = u.id
       WHERE c.slug = ? AND c.status = 'active'`,
      [req.params.slug]
    );

    if (!community) return res.status(404).render('errors/404', { title: 'Not Found' });

    let membership = null;
    if (req.session.user) {
      membership = await queryOne(
        'SELECT * FROM community_members WHERE community_id = ? AND user_id = ?',
        [community.id, req.session.user.id]
      );
    }

    const isOwner = req.session.user && community.owner_id === req.session.user.id;

    // Private community — non-members see locked page
    if (community.is_private && !membership) {
      return res.render('communities/locked', {
        title: community.name,
        community,
        isOwner,
        membership: null,
      });
    }

    // Posts
    const page = parseInt(req.query.page) || 1;
    const perPage = 15;
    const offset = (page - 1) * perPage;

    const [totalRow, posts, members] = await Promise.all([
      queryOne('SELECT COUNT(*) AS total FROM community_posts WHERE community_id = ?', [community.id]),
      query(
        `SELECT cp.*, u.name AS author_name, u.avatar AS author_avatar,
                (SELECT COUNT(*) FROM community_post_comments cpc WHERE cpc.post_id = cp.id) AS comment_count
         FROM community_posts cp
         LEFT JOIN users u ON cp.user_id = u.id
         WHERE cp.community_id = ?
         ORDER BY cp.is_pinned DESC, cp.created_at DESC
         LIMIT ? OFFSET ?`,
        [community.id, perPage, offset]
      ),
      query(
        `SELECT u.id, u.name, u.avatar, cm.role, cm.joined_at
         FROM community_members cm
         LEFT JOIN users u ON cm.user_id = u.id
         WHERE cm.community_id = ?
         ORDER BY FIELD(cm.role,'owner','admin','member'), cm.joined_at ASC
         LIMIT 16`,
        [community.id]
      ),
    ]);

    const totalPages = Math.ceil((totalRow.total || 0) / perPage);
    const postsWithMeta = posts.map(p => ({
      ...p,
      timeAgo: timeAgo(p.created_at),
      excerpt: truncate(stripHtml(p.content), 220),
    }));

    res.render('communities/show', {
      title: community.name,
      community,
      posts: postsWithMeta,
      members,
      membership,
      isOwner,
      page,
      totalPages,
      hasPrev: page > 1,
      hasNext: page < totalPages,
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not load community.');
    res.redirect('/communities');
  }
};

// ── POST /communities/:slug/join ─────────────────────────────────────────────
exports.join = async (req, res) => {
  try {
    const community = await queryOne(
      'SELECT * FROM communities WHERE slug = ? AND status = ?',
      [req.params.slug, 'active']
    );
    if (!community) return res.status(404).send('Not found');

    const existing = await queryOne(
      'SELECT id FROM community_members WHERE community_id = ? AND user_id = ?',
      [community.id, req.session.user.id]
    );
    if (!existing) {
      await insert('community_members', {
        community_id: community.id,
        user_id: req.session.user.id,
        role: 'member',
      });
      req.flash('success', `You joined "${community.name}"!`);
    }
    res.redirect(`/communities/${community.slug}`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not join community.');
    res.redirect(`/communities/${req.params.slug}`);
  }
};

// ── POST /communities/:slug/leave ────────────────────────────────────────────
exports.leave = async (req, res) => {
  try {
    const community = await queryOne('SELECT * FROM communities WHERE slug = ?', [req.params.slug]);
    if (!community) return res.status(404).send('Not found');

    if (community.owner_id === req.session.user.id) {
      req.flash('error', 'Owners cannot leave. Transfer ownership or delete the community from Settings.');
      return res.redirect(`/communities/${community.slug}`);
    }

    await remove('community_members', 'community_id = ? AND user_id = ?', [community.id, req.session.user.id]);
    req.flash('info', `You left "${community.name}".`);
    res.redirect(`/communities/${community.slug}`);
  } catch (err) {
    console.error(err);
    res.redirect(`/communities/${req.params.slug}`);
  }
};

// ── POST /communities/:slug/posts ────────────────────────────────────────────
exports.createPost = async (req, res) => {
  try {
    const community = await queryOne('SELECT * FROM communities WHERE slug = ? AND status = ?', [req.params.slug, 'active']);
    if (!community) return res.status(404).send('Not found');

    const membership = await queryOne(
      'SELECT id FROM community_members WHERE community_id = ? AND user_id = ?',
      [community.id, req.session.user.id]
    );
    if (!membership) {
      req.flash('error', 'Join this community to post.');
      return res.redirect(`/communities/${community.slug}`);
    }

    const { title, content } = req.body;
    if (!content || content.trim().length < 1) {
      req.flash('error', 'Post content cannot be empty.');
      return res.redirect(`/communities/${community.slug}`);
    }

    let image = null;
    if (req.files && req.files.image) {
      const f = req.files.image;
      const ext = f.name.split('.').pop().toLowerCase();
      if (['jpg','jpeg','png','webp','gif'].includes(ext)) {
        const fname = `commpost_${Date.now()}.${ext}`;
        await f.mv(`public/uploads/communities/${fname}`);
        image = `/uploads/communities/${fname}`;
      }
    }

    await insert('community_posts', {
      community_id: community.id,
      user_id: req.session.user.id,
      title: title ? title.trim() : null,
      content: content.trim(),
      image,
    });

    req.flash('success', 'Post published!');
    res.redirect(`/communities/${community.slug}`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to create post.');
    res.redirect(`/communities/${req.params.slug}`);
  }
};

// ── GET /communities/:slug/posts/:postId ─────────────────────────────────────
exports.showPost = async (req, res) => {
  try {
    const community = await queryOne('SELECT * FROM communities WHERE slug = ?', [req.params.slug]);
    if (!community) return res.status(404).render('errors/404', { title: 'Not Found' });

    const post = await queryOne(
      `SELECT cp.*, u.name AS author_name, u.avatar AS author_avatar
       FROM community_posts cp LEFT JOIN users u ON cp.user_id = u.id
       WHERE cp.id = ? AND cp.community_id = ?`,
      [req.params.postId, community.id]
    );
    if (!post) return res.status(404).render('errors/404', { title: 'Not Found' });

    let membership = null;
    if (req.session.user) {
      membership = await queryOne(
        'SELECT * FROM community_members WHERE community_id = ? AND user_id = ?',
        [community.id, req.session.user.id]
      );
    }

    const comments = await query(
      `SELECT cpc.*, u.name AS author_name, u.avatar AS author_avatar
       FROM community_post_comments cpc
       LEFT JOIN users u ON cpc.user_id = u.id
       WHERE cpc.post_id = ?
       ORDER BY cpc.created_at ASC`,
      [post.id]
    );

    const commentsWithTime = comments.map(c => ({ ...c, timeAgo: timeAgo(c.created_at) }));

    res.render('communities/post', {
      title: post.title || 'Post',
      community,
      post: { ...post, timeAgo: timeAgo(post.created_at) },
      comments: commentsWithTime,
      membership,
      isOwner: req.session.user && community.owner_id === req.session.user.id,
    });
  } catch (err) {
    console.error(err);
    res.redirect(`/communities/${req.params.slug}`);
  }
};

// ── POST /communities/:slug/posts/:postId/comment ────────────────────────────
exports.createComment = async (req, res) => {
  try {
    const community = await queryOne('SELECT * FROM communities WHERE slug = ?', [req.params.slug]);
    const post = await queryOne('SELECT * FROM community_posts WHERE id = ? AND community_id = ?', [req.params.postId, community.id]);
    if (!community || !post) return res.status(404).send('Not found');

    const membership = await queryOne(
      'SELECT id FROM community_members WHERE community_id = ? AND user_id = ?',
      [community.id, req.session.user.id]
    );
    if (!membership) {
      req.flash('error', 'Join the community to comment.');
      return res.redirect(`/communities/${community.slug}/posts/${post.id}`);
    }

    const { content } = req.body;
    if (!content || content.trim().length < 1) {
      req.flash('error', 'Comment cannot be empty.');
      return res.redirect(`/communities/${community.slug}/posts/${post.id}`);
    }

    await insert('community_post_comments', {
      post_id: post.id,
      user_id: req.session.user.id,
      content: content.trim(),
    });

    res.redirect(`/communities/${community.slug}/posts/${post.id}`);
  } catch (err) {
    console.error(err);
    res.redirect(`/communities/${req.params.slug}`);
  }
};

// ── POST /communities/:slug/posts/:postId/delete ─────────────────────────────
exports.deletePost = async (req, res) => {
  try {
    const community = await queryOne('SELECT * FROM communities WHERE slug = ?', [req.params.slug]);
    const post = await queryOne('SELECT * FROM community_posts WHERE id = ?', [req.params.postId]);
    if (!community || !post) return res.status(404).send('Not found');

    const canDelete = post.user_id === req.session.user.id || community.owner_id === req.session.user.id;
    if (!canDelete) return res.status(403).send('Forbidden');

    await remove('community_post_comments', 'post_id = ?', [post.id]);
    await remove('community_posts', 'id = ?', [post.id]);
    req.flash('success', 'Post deleted.');
    res.redirect(`/communities/${community.slug}`);
  } catch (err) {
    console.error(err);
    res.redirect(`/communities/${req.params.slug}`);
  }
};

// ── GET /communities/:slug/settings ──────────────────────────────────────────
exports.getSettings = async (req, res) => {
  try {
    const community = await queryOne(
      'SELECT * FROM communities WHERE slug = ? AND owner_id = ?',
      [req.params.slug, req.session.user.id]
    );
    if (!community) return res.status(403).render('errors/403', { title: 'Forbidden' });

    const members = await query(
      `SELECT u.id, u.name, u.avatar, cm.role, cm.joined_at
       FROM community_members cm
       LEFT JOIN users u ON cm.user_id = u.id
       WHERE cm.community_id = ?
       ORDER BY FIELD(cm.role,'owner','admin','member'), cm.joined_at ASC`,
      [community.id]
    );

    res.render('communities/settings', {
      title: `Settings — ${community.name}`,
      community,
      members,
      errors: [],
    });
  } catch (err) {
    console.error(err);
    res.redirect(`/communities/${req.params.slug}`);
  }
};

// ── POST /communities/:slug/settings ─────────────────────────────────────────
exports.postSettings = async (req, res) => {
  try {
    const community = await queryOne(
      'SELECT * FROM communities WHERE slug = ? AND owner_id = ?',
      [req.params.slug, req.session.user.id]
    );
    if (!community) return res.status(403).send('Forbidden');

    const { name, description, is_private } = req.body;
    const updateData = {
      name: name ? name.trim() : community.name,
      description: description ? description.trim() : community.description,
      is_private: is_private ? 1 : 0,
    };

    if (req.files && req.files.avatar) {
      const f = req.files.avatar;
      const ext = f.name.split('.').pop().toLowerCase();
      if (['jpg','jpeg','png','webp','gif'].includes(ext)) {
        const fname = `comm_av_${Date.now()}.${ext}`;
        await f.mv(`public/uploads/communities/${fname}`);
        updateData.avatar = `/uploads/communities/${fname}`;
      }
    }

    if (req.files && req.files.cover_image) {
      const f = req.files.cover_image;
      const ext = f.name.split('.').pop().toLowerCase();
      if (['jpg','jpeg','png','webp','gif'].includes(ext)) {
        const fname = `comm_cv_${Date.now()}.${ext}`;
        await f.mv(`public/uploads/communities/${fname}`);
        updateData.cover_image = `/uploads/communities/${fname}`;
      }
    }

    await update('communities', updateData, 'id = ?', [community.id]);
    req.flash('success', 'Community updated!');
    res.redirect(`/communities/${community.slug}/settings`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to update settings.');
    res.redirect(`/communities/${req.params.slug}/settings`);
  }
};

// ── POST /communities/:slug/members/:userId/remove ───────────────────────────
exports.removeMember = async (req, res) => {
  try {
    const community = await queryOne(
      'SELECT * FROM communities WHERE slug = ? AND owner_id = ?',
      [req.params.slug, req.session.user.id]
    );
    if (!community) return res.status(403).send('Forbidden');

    if (parseInt(req.params.userId) === req.session.user.id) {
      req.flash('error', 'You cannot remove yourself.');
      return res.redirect(`/communities/${community.slug}/settings`);
    }

    await remove('community_members', 'community_id = ? AND user_id = ?', [community.id, req.params.userId]);
    req.flash('success', 'Member removed from community.');
    res.redirect(`/communities/${community.slug}/settings`);
  } catch (err) {
    console.error(err);
    res.redirect(`/communities/${req.params.slug}/settings`);
  }
};

// ── POST /communities/:slug/delete ───────────────────────────────────────────
exports.deleteCommunity = async (req, res) => {
  try {
    const community = await queryOne(
      'SELECT * FROM communities WHERE slug = ? AND owner_id = ?',
      [req.params.slug, req.session.user.id]
    );
    if (!community) return res.status(403).send('Forbidden');

    // Cascade delete
    const posts = await query('SELECT id FROM community_posts WHERE community_id = ?', [community.id]);
    for (const p of posts) {
      await remove('community_post_comments', 'post_id = ?', [p.id]);
    }
    await remove('community_posts', 'community_id = ?', [community.id]);
    await remove('community_members', 'community_id = ?', [community.id]);
    await remove('communities', 'id = ?', [community.id]);

    req.flash('success', `Community "${community.name}" has been deleted.`);
    res.redirect('/communities');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to delete community.');
    res.redirect(`/communities/${req.params.slug}/settings`);
  }
};
