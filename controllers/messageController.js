const { query, queryOne, insert } = require('../helpers/db');
const { pool } = require('../config/database');
const { timeAgo } = require('../helpers/utils');

/* ── Conversation list ────────────────────────────────────────────────────── */
exports.index = async (req, res) => {
  try {
    const uid = req.session.user.id;

    const conversations = await query(
      `SELECT
         c.id,
         c.updated_at,
         u.id   AS other_id,
         u.name AS other_name,
         u.avatar AS other_avatar,
         lm.content        AS last_msg,
         lm.created_at     AS last_msg_at,
         (SELECT COUNT(*) FROM messages x
          WHERE x.conversation_id = c.id
            AND x.sender_id <> ?
            AND x.created_at > COALESCE(cp.last_read_at, '1970-01-01 00:00:00')
         ) AS unread
       FROM conversations c
       JOIN conversation_participants cp  ON c.id = cp.conversation_id  AND cp.user_id = ?
       JOIN conversation_participants cp2 ON c.id = cp2.conversation_id AND cp2.user_id <> ?
       JOIN users u ON u.id = cp2.user_id
       LEFT JOIN messages lm ON lm.id = (
         SELECT id FROM messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1
       )
       ORDER BY c.updated_at DESC`,
      [uid, uid, uid]
    );

    const list = conversations.map(c => ({
      ...c,
      timeAgo: timeAgo(c.last_msg_at || c.updated_at),
    }));

    res.render('messages/index', { title: 'Messages', conversations: list, activeConvId: null });
  } catch (err) {
    console.error(err);
    res.render('messages/index', { title: 'Messages', conversations: [] });
  }
};

/* ── Helper: get sidebar conversations ───────────────────────────────────── */
async function getSidebarConversations(uid) {
  return query(
    `SELECT
       c.id, c.updated_at,
       u.id AS other_id, u.name AS other_name, u.avatar AS other_avatar,
       lm.content AS last_msg, lm.created_at AS last_msg_at,
       (SELECT COUNT(*) FROM messages x
        WHERE x.conversation_id = c.id AND x.sender_id <> ?
          AND x.created_at > COALESCE(cp.last_read_at,'1970-01-01 00:00:00')
       ) AS unread
     FROM conversations c
     JOIN conversation_participants cp  ON c.id = cp.conversation_id AND cp.user_id = ?
     JOIN conversation_participants cp2 ON c.id = cp2.conversation_id AND cp2.user_id <> ?
     JOIN users u ON u.id = cp2.user_id
     LEFT JOIN messages lm ON lm.id = (
       SELECT id FROM messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1
     )
     ORDER BY c.updated_at DESC`,
    [uid, uid, uid]
  );
}

/* ── Single conversation ──────────────────────────────────────────────────── */
exports.show = async (req, res) => {
  try {
    const uid    = req.session.user.id;
    const convId = parseInt(req.params.id);

    const part = await queryOne(
      'SELECT * FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
      [convId, uid]
    );
    if (!part) return res.status(403).render('errors/403', { title: 'Access Denied' });

    const other = await queryOne(
      `SELECT u.id, u.name, u.avatar FROM users u
       JOIN conversation_participants cp ON u.id = cp.user_id
       WHERE cp.conversation_id = ? AND cp.user_id <> ?`,
      [convId, uid]
    );

    const messages = await query(
      `SELECT m.id, m.content, m.created_at, m.sender_id,
              u.name AS sender_name, u.avatar AS sender_avatar
       FROM messages m
       JOIN users u ON m.sender_id = u.id
       WHERE m.conversation_id = ?
       ORDER BY m.created_at ASC`,
      [convId]
    );

    // mark read
    await query(
      'UPDATE conversation_participants SET last_read_at = NOW() WHERE conversation_id = ? AND user_id = ?',
      [convId, uid]
    );

    const conversations = await getSidebarConversations(uid);
    const convList = conversations.map(c => ({ ...c, timeAgo: timeAgo(c.last_msg_at || c.updated_at) }));

    res.render('messages/show', {
      title: `Chat with ${other?.name || 'User'}`,
      conversation: { id: convId },
      other,
      messages: messages.map(m => ({ ...m, timeAgo: timeAgo(m.created_at), isMine: m.sender_id === uid })),
      currentUserId: uid,
      conversations: convList,
      activeConvId: convId,
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not load conversation.');
    res.redirect('/messages');
  }
};

/* ── Start or open a conversation ────────────────────────────────────────── */
exports.create = async (req, res) => {
  try {
    const uid      = req.session.user.id;
    const targetId = parseInt(req.body.user_id);

    if (!targetId || targetId === uid) {
      req.flash('error', 'Invalid recipient.');
      return res.redirect('/messages');
    }

    // Does a conversation already exist?
    const existing = await queryOne(
      `SELECT c.id FROM conversations c
       JOIN conversation_participants cp1 ON c.id = cp1.conversation_id AND cp1.user_id = ?
       JOIN conversation_participants cp2 ON c.id = cp2.conversation_id AND cp2.user_id = ?`,
      [uid, targetId]
    );
    if (existing) return res.redirect(`/messages/${existing.id}`);

    // Create new
    const [result] = await pool.execute('INSERT INTO conversations (created_at) VALUES (NOW())');
    const convId = result.insertId;
    await Promise.all([
      query('INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)', [convId, uid]),
      query('INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)', [convId, targetId]),
    ]);

    res.redirect(`/messages/${convId}`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not start conversation.');
    res.redirect('/messages');
  }
};

/* ── Send a message ───────────────────────────────────────────────────────── */
exports.send = async (req, res) => {
  try {
    const uid    = req.session.user.id;
    const convId = parseInt(req.params.id);
    const content = (req.body.content || '').trim();

    if (!content) return res.status(400).json({ error: 'Empty message' });

    const part = await queryOne(
      'SELECT * FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
      [convId, uid]
    );
    if (!part) return res.status(403).json({ error: 'Not a participant' });

    const msgId = await insert('messages', { conversation_id: convId, sender_id: uid, content });
    await query('UPDATE conversations SET updated_at = NOW() WHERE id = ?', [convId]);

    const message = await queryOne(
      `SELECT m.id, m.content, m.created_at, m.sender_id,
              u.name AS sender_name, u.avatar AS sender_avatar
       FROM messages m JOIN users u ON m.sender_id = u.id
       WHERE m.id = ?`,
      [msgId]
    );

    const isAjax = req.headers['x-requested-with'] === 'XMLHttpRequest'
                || (req.headers.accept || '').includes('application/json');
    if (isAjax) {
      return res.json({ success: true, message: { ...message, isMine: true, timeAgo: timeAgo(message.created_at) } });
    }
    res.redirect(`/messages/${convId}`);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

/* ── Polling endpoint (returns messages after given id) ──────────────────── */
exports.poll = async (req, res) => {
  try {
    const uid     = req.session.user.id;
    const convId  = parseInt(req.params.id);
    const afterId = parseInt(req.query.after) || 0;

    const part = await queryOne(
      'SELECT * FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
      [convId, uid]
    );
    if (!part) return res.status(403).json({ error: 'Not a participant' });

    const messages = await query(
      `SELECT m.id, m.content, m.created_at, m.sender_id,
              u.name AS sender_name, u.avatar AS sender_avatar
       FROM messages m JOIN users u ON m.sender_id = u.id
       WHERE m.conversation_id = ? AND m.id > ?
       ORDER BY m.created_at ASC`,
      [convId, afterId]
    );

    if (messages.length) {
      await query(
        'UPDATE conversation_participants SET last_read_at = NOW() WHERE conversation_id = ? AND user_id = ?',
        [convId, uid]
      );
    }

    res.json({
      messages: messages.map(m => ({ ...m, isMine: m.sender_id === uid, timeAgo: timeAgo(m.created_at) })),
    });
  } catch (err) {
    console.error(err);
    res.json({ messages: [] });
  }
};

/* ── Unread count (for nav badge) ────────────────────────────────────────── */
exports.unreadCount = async (req, res) => {
  try {
    const uid = req.session.user?.id;
    if (!uid) return res.json({ count: 0 });

    const row = await queryOne(
      `SELECT COUNT(*) AS count FROM messages m
       JOIN conversation_participants cp ON m.conversation_id = cp.conversation_id AND cp.user_id = ?
       WHERE m.sender_id <> ?
         AND m.created_at > COALESCE(cp.last_read_at, '1970-01-01 00:00:00')`,
      [uid, uid]
    );
    res.json({ count: row?.count || 0 });
  } catch (err) {
    res.json({ count: 0 });
  }
};
