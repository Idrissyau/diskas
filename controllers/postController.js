const { query, queryOne, insert, update, remove } = require('../helpers/db');
const { makeSlug, paginate, timeAgo } = require('../helpers/utils');

exports.index = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const perPage = 15;
    const type = req.query.type || 'all';
    const categorySlug = req.query.category;

    let whereClause = "p.status IN ('active','pinned','closed')";
    const params = [];

    if (type !== 'all') {
      whereClause += ' AND p.type = ?';
      params.push(type);
    }
    if (categorySlug) {
      whereClause += ' AND c.slug = ?';
      params.push(categorySlug);
    }

    const [totalRow, posts, categories] = await Promise.all([
      queryOne(`SELECT COUNT(*) AS total FROM posts p LEFT JOIN categories c ON p.category_id = c.id WHERE ${whereClause}`, params),
      query(
        `SELECT p.*, u.name AS author_name, u.avatar AS author_avatar,
                c.name AS category_name, c.slug AS category_slug, c.color AS category_color,
                (SELECT COUNT(*) FROM comments cm WHERE cm.post_id = p.id AND cm.status = 'active') AS reply_count,
                (SELECT COALESCE(SUM(vote), 0) FROM votes v WHERE v.target_id = p.id AND v.target_type = 'post') AS vote_count
         FROM posts p
         LEFT JOIN users u ON p.user_id = u.id
         LEFT JOIN categories c ON p.category_id = c.id
         WHERE ${whereClause}
         ORDER BY p.status = 'pinned' DESC, p.created_at DESC
         LIMIT ? OFFSET ?`,
        [...params, perPage, (page - 1) * perPage]
      ),
      query("SELECT * FROM categories WHERE type = 'discussion' ORDER BY name"),
    ]);

    const pagination = paginate(totalRow.total, page, perPage);
    const postsWithTime = posts.map(p => ({ ...p, timeAgo: timeAgo(p.created_at) }));

    res.render('posts/index', {
      title: 'Discussions',
      posts: postsWithTime,
      pagination,
      categories,
      currentType: type,
      currentCategory: categorySlug,
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to load discussions.');
    res.redirect('/');
  }
};

exports.show = async (req, res) => {
  try {
    const post = await queryOne(
      `SELECT p.*, u.name AS author_name, u.avatar AS author_avatar, u.bio AS author_bio,
              c.name AS category_name, c.slug AS category_slug, c.color AS category_color,
              (SELECT COALESCE(SUM(vote), 0) FROM votes v WHERE v.target_id = p.id AND v.target_type = 'post') AS vote_count
       FROM posts p
       LEFT JOIN users u ON p.user_id = u.id
       LEFT JOIN categories c ON p.category_id = c.id
       WHERE p.slug = ? AND p.status != 'deleted'`,
      [req.params.slug]
    );

    if (!post) return res.status(404).render('errors/404', { title: 'Not Found' });

    await update('posts', { views: post.views + 1 }, 'id = ?', [post.id]);

    const comments = await query(
      `SELECT cm.*, u.name AS author_name, u.avatar AS author_avatar,
              (SELECT COALESCE(SUM(vote), 0) FROM votes v WHERE v.target_id = cm.id AND v.target_type = 'comment') AS vote_count
       FROM comments cm
       LEFT JOIN users u ON cm.user_id = u.id
       WHERE cm.post_id = ? AND cm.parent_id IS NULL AND cm.status = 'active'
       ORDER BY cm.is_accepted DESC, cm.created_at ASC`,
      [post.id]
    );

    const related = await query(
      `SELECT p.*, u.name AS author_name FROM posts p
       LEFT JOIN users u ON p.user_id = u.id
       WHERE p.category_id = ? AND p.id != ? AND p.status != 'deleted'
       ORDER BY RAND() LIMIT 5`,
      [post.category_id, post.id]
    );

    let userVote = null;
    if (req.session.user) {
      const voteRow = await queryOne(
        'SELECT vote FROM votes WHERE user_id = ? AND target_id = ? AND target_type = "post"',
        [req.session.user.id, post.id]
      );
      userVote = voteRow ? voteRow.vote : null;
    }

    const commentsWithTime = comments.map(c => ({ ...c, timeAgo: timeAgo(c.created_at) }));
    const postObj = { ...post, timeAgo: timeAgo(post.created_at) };
    const appUrl = process.env.APP_URL || 'https://diskas.idrisyau.com';
    const snippet = (post.content || '').replace(/\s+/g, ' ').trim().substring(0, 160);
    const schemaType = post.type === 'question' ? 'QAPage' : 'DiscussionForumPosting';

    res.render('posts/show', {
      title: post.title,
      metaDesc: snippet || `Discussion by ${post.author_name} on Diskas`,
      canonicalPath: `/discussions/${post.slug}`,
      ogType: 'article',
      pageSchema: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': schemaType,
        headline: post.title,
        text: snippet,
        author: { '@type': 'Person', name: post.author_name },
        datePublished: new Date(post.created_at).toISOString(),
        url: `${appUrl}/discussions/${post.slug}`,
        interactionStatistic: [
          { '@type': 'InteractionCounter', interactionType: 'https://schema.org/ViewAction', userInteractionCount: post.views },
          { '@type': 'InteractionCounter', interactionType: 'https://schema.org/CommentAction', userInteractionCount: comments.length }
        ]
      }),
      post: postObj,
      comments: commentsWithTime,
      related,
      userVote,
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to load post.');
    res.redirect('/discussions');
  }
};

exports.getCreate = async (req, res) => {
  const categories = await query("SELECT * FROM categories WHERE type = 'discussion' ORDER BY name");
  res.render('posts/create', { title: 'New Discussion', categories });
};

exports.postCreate = async (req, res) => {
  try {
    const { title, content, type, category_id, tags } = req.body;

    if (!title || !content) {
      req.flash('error', 'Title and content are required.');
      return res.redirect('/discussions/new');
    }

    const baseSlug = makeSlug(title);
    const existing = await queryOne('SELECT id FROM posts WHERE slug = ?', [baseSlug]);
    const slug = existing ? makeSlug(title, Date.now()) : baseSlug;

    const postId = await insert('posts', {
      user_id: req.session.user.id,
      category_id: category_id || null,
      title,
      slug,
      content,
      type: type || 'discussion',
    });

    if (tags) {
      const tagList = tags.split(',').map(t => t.trim()).filter(Boolean).slice(0, 5);
      for (const tagName of tagList) {
        const tagSlug = makeSlug(tagName);
        let tag = await queryOne('SELECT id FROM tags WHERE slug = ?', [tagSlug]);
        if (!tag) {
          const tagId = await insert('tags', { name: tagName, slug: tagSlug, count: 1 });
          tag = { id: tagId };
        } else {
          await update('tags', { count: require('mysql2').raw('count + 1') }, 'id = ?', [tag.id]);
        }
        await insert('post_tags', { post_id: postId, tag_id: tag.id });
      }
    }

    req.flash('success', 'Your post has been published!');
    res.redirect(`/discussions/${slug}`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to create post.');
    res.redirect('/discussions/new');
  }
};

exports.postComment = async (req, res) => {
  try {
    const { content, parent_id } = req.body;
    const post = await queryOne('SELECT * FROM posts WHERE slug = ?', [req.params.slug]);

    if (!post) return res.status(404).json({ error: 'Post not found' });
    if (post.status === 'closed') {
      req.flash('error', 'This discussion is closed.');
      return res.redirect(`/discussions/${post.slug}`);
    }
    if (!content || content.trim().length < 2) {
      req.flash('error', 'Comment cannot be empty.');
      return res.redirect(`/discussions/${post.slug}`);
    }

    await insert('comments', {
      post_id: post.id,
      user_id: req.session.user.id,
      parent_id: parent_id || null,
      content: content.trim(),
    });

    req.flash('success', 'Comment added.');
    res.redirect(`/discussions/${post.slug}#comments`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to add comment.');
    res.redirect(`/discussions/${req.params.slug}`);
  }
};

exports.vote = async (req, res) => {
  try {
    if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });

    const { id, type: targetType, value } = req.body;
    const voteVal = parseInt(value) === 1 ? 1 : -1;

    const existing = await queryOne(
      'SELECT * FROM votes WHERE user_id = ? AND target_id = ? AND target_type = ?',
      [req.session.user.id, id, targetType]
    );

    if (existing) {
      if (existing.vote === voteVal) {
        await remove('votes', 'id = ?', [existing.id]);
      } else {
        await update('votes', { vote: voteVal }, 'id = ?', [existing.id]);
      }
    } else {
      await insert('votes', { user_id: req.session.user.id, target_id: id, target_type: targetType, vote: voteVal });
    }

    const result = await queryOne(
      'SELECT COALESCE(SUM(vote), 0) AS total FROM votes WHERE target_id = ? AND target_type = ?',
      [id, targetType]
    );

    res.json({ success: true, total: result.total });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Vote failed' });
  }
};

exports.deletePost = async (req, res) => {
  try {
    const post = await queryOne('SELECT * FROM posts WHERE id = ?', [req.params.id]);
    if (!post) return res.status(404).json({ error: 'Not found' });

    const isOwner = post.user_id === req.session.user.id;
    const isMod = ['admin', 'moderator'].includes(req.session.user.role);
    if (!isOwner && !isMod) return res.status(403).json({ error: 'Forbidden' });

    await update('posts', { status: 'deleted' }, 'id = ?', [post.id]);
    req.flash('success', 'Post deleted.');
    res.redirect('/discussions');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to delete post.');
    res.redirect('/discussions');
  }
};
