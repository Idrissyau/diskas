const { query, queryOne, insert } = require('../helpers/db');
const { pool } = require('../config/database');
const { timeAgo } = require('../helpers/utils');
const fs   = require('fs');
const path = require('path');

// Ensure upload dir exists
const MSG_UPLOAD_DIR = 'public/uploads/messages';
if (!fs.existsSync(MSG_UPLOAD_DIR)) fs.mkdirSync(MSG_UPLOAD_DIR, { recursive: true });

const IMAGE_EXTS = new Set(['jpg','jpeg','png','gif','webp','svg']);
const VIDEO_EXTS = new Set(['mp4','webm','mov','ogg']);
const MAX_SIZE   = 20 * 1024 * 1024; // 20 MB

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
              m.file_url, m.file_type, m.file_name,
              m.reply_to_id, m.reply_to_content, m.reply_to_name,
              u.name AS sender_name, u.avatar AS sender_avatar,
              (SELECT COUNT(*) FROM message_reactions WHERE message_id = m.id AND reaction = 'like')    AS like_count,
              (SELECT COUNT(*) FROM message_reactions WHERE message_id = m.id AND reaction = 'dislike') AS dislike_count,
              (SELECT reaction  FROM message_reactions WHERE message_id = m.id AND user_id = ?)         AS my_reaction
       FROM messages m
       JOIN users u ON m.sender_id = u.id
       WHERE m.conversation_id = ?
       ORDER BY m.created_at ASC`,
      [uid, convId]
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

/* ── Send a message (text + optional file) ────────────────────────────────── */
exports.send = async (req, res) => {
  try {
    const uid     = req.session.user.id;
    const convId  = parseInt(req.params.id);
    const content = (req.body.content || '').trim();

    const part = await queryOne(
      'SELECT * FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
      [convId, uid]
    );
    if (!part) return res.status(403).json({ error: 'Not a participant' });

    // ── Handle optional file upload ───────────────────────────────────────
    let file_url  = null;
    let file_type = null;
    let file_name = null;

    if (req.files && req.files.file) {
      const f   = req.files.file;
      const ext = f.name.split('.').pop().toLowerCase();

      if (f.size > MAX_SIZE) return res.status(400).json({ error: 'File too large (max 20 MB).' });

      const fname = `msg_${uid}_${Date.now()}.${ext}`;
      await f.mv(path.join(MSG_UPLOAD_DIR, fname));
      file_url  = `/uploads/messages/${fname}`;
      file_name = f.name;
      file_type = IMAGE_EXTS.has(ext) ? 'image'
                : VIDEO_EXTS.has(ext) ? 'video'
                : 'file';
    }

    // Must have content OR a file
    if (!content && !file_url) return res.status(400).json({ error: 'Nothing to send.' });

    // ── Handle optional reply context ─────────────────────────────────────
    const replyToId      = parseInt(req.body.reply_to_id) || null;
    const replyToContent = (req.body.reply_to_content || '').trim().substring(0, 120) || null;
    const replyToName    = (req.body.reply_to_name    || '').trim().substring(0, 100) || null;

    const msgData = { conversation_id: convId, sender_id: uid, content: content || '' };
    if (file_url)      msgData.file_url         = file_url;
    if (file_type)     msgData.file_type        = file_type;
    if (file_name)     msgData.file_name        = file_name;
    if (replyToId)     msgData.reply_to_id      = replyToId;
    if (replyToContent)msgData.reply_to_content = replyToContent;
    if (replyToName)   msgData.reply_to_name    = replyToName;

    const msgId = await insert('messages', msgData);
    await query('UPDATE conversations SET updated_at = NOW() WHERE id = ?', [convId]);

    const message = await queryOne(
      `SELECT m.id, m.content, m.created_at, m.sender_id,
              m.file_url, m.file_type, m.file_name,
              m.reply_to_id, m.reply_to_content, m.reply_to_name,
              u.name AS sender_name, u.avatar AS sender_avatar,
              0 AS like_count, 0 AS dislike_count, NULL AS my_reaction
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
              m.file_url, m.file_type, m.file_name,
              m.reply_to_id, m.reply_to_content, m.reply_to_name,
              u.name AS sender_name, u.avatar AS sender_avatar,
              (SELECT COUNT(*) FROM message_reactions WHERE message_id = m.id AND reaction = 'like')    AS like_count,
              (SELECT COUNT(*) FROM message_reactions WHERE message_id = m.id AND reaction = 'dislike') AS dislike_count,
              (SELECT reaction  FROM message_reactions WHERE message_id = m.id AND user_id = ?)         AS my_reaction
       FROM messages m JOIN users u ON m.sender_id = u.id
       WHERE m.conversation_id = ? AND m.id > ?
       ORDER BY m.created_at ASC`,
      [uid, convId, afterId]
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

/* ── React to a message (like / dislike) ─────────────────────────────────── */
exports.react = async (req, res) => {
  try {
    const uid      = req.session.user.id;
    const msgId    = parseInt(req.params.msgId);
    const convId   = parseInt(req.params.id);
    const reaction = req.body.reaction; // 'like' | 'dislike'

    if (!['like', 'dislike'].includes(reaction))
      return res.status(400).json({ error: 'Invalid reaction' });

    // Must be a participant
    const part = await queryOne(
      'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?',
      [convId, uid]
    );
    if (!part) return res.status(403).json({ error: 'Not a participant' });

    const existing = await queryOne(
      'SELECT reaction FROM message_reactions WHERE message_id = ? AND user_id = ?',
      [msgId, uid]
    );

    let myReaction = null;
    if (existing) {
      if (existing.reaction === reaction) {
        // Toggle off
        await query('DELETE FROM message_reactions WHERE message_id = ? AND user_id = ?', [msgId, uid]);
      } else {
        // Switch to the other
        await query('UPDATE message_reactions SET reaction = ? WHERE message_id = ? AND user_id = ?', [reaction, msgId, uid]);
        myReaction = reaction;
      }
    } else {
      await query('INSERT INTO message_reactions (message_id, user_id, reaction) VALUES (?, ?, ?)', [msgId, uid, reaction]);
      myReaction = reaction;
    }

    const [likeRow, dislikeRow] = await Promise.all([
      queryOne('SELECT COUNT(*) AS count FROM message_reactions WHERE message_id = ? AND reaction = "like"',    [msgId]),
      queryOne('SELECT COUNT(*) AS count FROM message_reactions WHERE message_id = ? AND reaction = "dislike"', [msgId]),
    ]);

    res.json({ success: true, myReaction, likes: likeRow?.count || 0, dislikes: dislikeRow?.count || 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

/* ── Delete a message ────────────────────────────────────────────────────── */
exports.deleteMessage = async (req, res) => {
  try {
    const uid   = req.session.user.id;
    const msgId = parseInt(req.params.msgId);

    // Fetch the message — must be the sender
    const msg = await queryOne(
      'SELECT id, sender_id, file_url, conversation_id FROM messages WHERE id = ?',
      [msgId]
    );
    if (!msg)             return res.status(404).json({ error: 'Message not found' });
    if (msg.sender_id !== uid) return res.status(403).json({ error: 'Not your message' });

    // Delete the physical file if one exists
    if (msg.file_url) {
      const filePath = path.join(__dirname, '..', 'public', msg.file_url);
      fs.unlink(filePath, () => {}); // fire-and-forget; ignore if already gone
    }

    // Hard-delete the row
    await query('DELETE FROM messages WHERE id = ?', [msgId]);

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
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
