'use strict';

const db = require('../db');

async function listNotifications(req, res) {
  try {
    const result = await db.query(
      `SELECT id, utilisateur_id, titre, message, type, related_entity_type, related_entity_id,
              metadata, lu AS is_read, date_envoi AS created_at, date_lecture AS read_at
       FROM public.notification WHERE utilisateur_id = $1
       ORDER BY date_envoi DESC, id DESC LIMIT 100`,
      [req.user.id]
    );
    const unread = result.rows.reduce((count, item) => count + (item.is_read ? 0 : 1), 0);
    return res.json({ notifications: result.rows, unread_count: unread });
  } catch (error) {
    console.error('❌ ListNotifications error:', error.message);
    return res.status(500).json({ message: 'Impossible de charger les notifications.' });
  }
}

async function markNotificationRead(req, res) {
  const result = await db.query(
    `UPDATE public.notification SET lu = true, date_lecture = COALESCE(date_lecture, NOW())
     WHERE id = $1 AND utilisateur_id = $2 RETURNING id`,
    [req.params.id, req.user.id]
  );
  if (!result.rows.length) return res.status(404).json({ message: 'Notification introuvable.' });
  return res.json({ message: 'Notification marquée comme lue.' });
}

async function markAllNotificationsRead(req, res) {
  const result = await db.query(
    `UPDATE public.notification SET lu = true, date_lecture = COALESCE(date_lecture, NOW())
     WHERE utilisateur_id = $1 AND lu = false`,
    [req.user.id]
  );
  return res.json({ message: 'Toutes les notifications sont lues.', updated_count: result.rowCount });
}

module.exports = { listNotifications, markNotificationRead, markAllNotificationsRead };
