/**
 * server/src/controllers/dashboard.controller.js
 *
 * Controller handling dashboard-specific aggregated data.
 * Adheres to SiteX architecture & PostgreSQL real data models.
 */

'use strict';

const db = require('../db');

/**
 * GET /dashboard/project
 * Returns the project overview summary for the dashboard.
 * Calculates summary derived from real relational database records:
 * - nombre_chantiers: COUNT(DISTINCT chantier)
 * - avancement: AVG(latest avancement per chantier)
 * - nouvelles_images: COUNT(DISTINCT image_satellite)
 * - reclamations: COUNT(DISTINCT reclamation WHERE statut IN ('Ouverte', 'En cours'))
 * - derniere_mise_a_jour: GREATEST update timestamp across project entities
 */
async function getProjectOverview(req, res) {
  try {
    // For now, fetch the current active project (e.g. #1 or first available)
    // Structured so that user role/permissions can filter authorized projects later
    const query = `
      SELECT 
        p.id,
        p.nom,
        p.description,
        p.date_debut,
        p.date_fin,
        COUNT(DISTINCT c.id)::int AS nombre_chantiers,
        COALESCE(ROUND(AVG(latest_avancement.pourcentage))::int, 0) AS avancement,
        COALESCE(COUNT(DISTINCT img.id)::int, 0) AS nouvelles_images,
        COALESCE(COUNT(DISTINCT rec.id)::int, 0) AS reclamations,
        GREATEST(
          MAX(c.date_creation),
          MAX(latest_avancement.date::timestamp),
          MAX(img.date_acquisition::timestamp),
          MAX(rec.date_creation),
          p.date_debut::timestamp
        ) AS derniere_mise_a_jour
      FROM public.projet p
      LEFT JOIN public.chantier c ON c.projet_id = p.id
      LEFT JOIN LATERAL (
        SELECT a.pourcentage, a.date
        FROM public.avancement a
        WHERE a.chantier_id = c.id
        ORDER BY a.date DESC, a.id DESC
        LIMIT 1
      ) latest_avancement ON true
      LEFT JOIN public.image_satellite img ON img.chantier_id = c.id
      LEFT JOIN public.reclamation rec ON rec.chantier_id = c.id AND rec.statut IN ('Ouverte', 'En cours')
      GROUP BY p.id
      ORDER BY p.id ASC
      LIMIT 1;
    `;

    const result = await db.query(query);

    if (result.rows.length === 0) {
      return res.status(200).json({
        project: null,
      });
    }

    const row = result.rows[0];

    const projectData = {
      id: row.id,
      nom: row.nom,
      description: row.description,
      date_debut: row.date_debut,
      date_fin: row.date_fin,
      nombreChantiers: row.nombre_chantiers,
      avancement: row.avancement,
      nouvellesImages: row.nouvelles_images,
      reclamations: row.reclamations,
      derniereMiseAJour: row.derniere_mise_a_jour,
    };

    return res.status(200).json({
      project: projectData,
    });
  } catch (error) {
    console.error('❌ GetProjectOverview error:', error.message);
    return res.status(500).json({
      message: 'Erreur lors de la récupération des données du projet.',
    });
  }
}

module.exports = {
  getProjectOverview,
};
