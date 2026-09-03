'use strict';

require('dotenv').config();
const { pool } = require('./src/db');

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const user = await client.query('SELECT id FROM public.utilisateur ORDER BY id LIMIT 1');
    if (!user.rows.length) throw new Error('Aucun utilisateur de test disponible.');
    const userId = user.rows[0].id;

    const inserted = await client.query(
      `INSERT INTO public.notification(utilisateur_id, titre, message, type)
       VALUES ($1, 'Test persistance', 'Notification transactionnelle', 'TEST') RETURNING id, lu`,
      [userId],
    );
    if (inserted.rows[0].lu !== false) throw new Error('Une notification neuve doit être non lue.');

    const read = await client.query(
      `UPDATE public.notification SET lu = true, date_lecture = NOW()
       WHERE id = $1 AND utilisateur_id = $2 RETURNING lu, date_lecture`,
      [inserted.rows[0].id, userId],
    );
    if (!read.rows[0]?.lu || !read.rows[0]?.date_lecture) throw new Error('La lecture persistante a échoué.');

    const reportFixture = await client.query(
      `SELECT c.id AS chantier_id FROM public.chantier c
       WHERE c.responsable_id IS NOT NULL
          OR EXISTS (SELECT 1 FROM public.troncon t JOIN public.affectation_troncon a ON a.troncon_id = t.id
                     WHERE t.chantier_id = c.id AND a.statut = 'ACTIF')
       ORDER BY c.id LIMIT 1`,
    );
    let reportRecipients = 0;
    if (reportFixture.rows.length) {
      const report = await client.query(
        `INSERT INTO public.rapport(chantier_id, date_generation, format)
         VALUES ($1, NOW(), 'TEST') RETURNING id`,
        [reportFixture.rows[0].chantier_id],
      );
      const generated = await client.query(
        `SELECT COUNT(*)::int AS count FROM public.notification
         WHERE type = 'NOUVEAU_RAPPORT' AND related_entity_id = $1`,
        [report.rows[0].id],
      );
      reportRecipients = generated.rows[0].count;
      if (!reportRecipients) throw new Error('Le trigger de rapport n’a créé aucune notification.');
    }

    console.log(`OK notifications: lecture persistante; rapport destinataires=${reportRecipients}`);
    await client.query('ROLLBACK');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
