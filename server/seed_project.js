/**
 * server/seed_project.js
 *
 * Seed script for SiteX development data respecting the UML class diagram & PostgreSQL schema.
 * Seeds 1 Projet with 3 Chantiers, Avancements, Images Satellites, and Réclamations.
 */

'use strict';

require('dotenv').config({ path: __dirname + '/.env' });
const db = require('./src/db');

async function seed() {
  console.log('🌱 Starting Project & Chantier seeding...');

  try {
    // 1. Check if project already exists
    const existingProjets = await db.query('SELECT * FROM public.projet WHERE id = 1;');
    
    let projetId = 1;
    if (existingProjets.rows.length === 0) {
      const projetRes = await db.query(`
        INSERT INTO public.projet (id, nom, description, date_debut, date_fin, statut)
        VALUES (
          1,
          'Construction de la Route X',
          'Projet d''aménagement et de construction de l''axe routier express reliant le pôle industriel au port.',
          '2026-01-15',
          '2026-12-30',
          'En cours'
        )
        RETURNING id, nom;
      `);
      projetId = projetRes.rows[0].id;
      console.log(`✅ Projet created: #${projetId} - ${projetRes.rows[0].nom}`);
    } else {
      console.log(`ℹ️ Projet #1 already exists: ${existingProjets.rows[0].nom}`);
    }

    // 2. Ensure at least one user exists for responsable_id / utilisateur_id
    const userRes = await db.query('SELECT id FROM public.utilisateur LIMIT 1;');
    const userId = userRes.rows.length > 0 ? userRes.rows[0].id : 1;

    // 3. Seed Chantiers for Projet #1
    const existingChantiers = await db.query('SELECT * FROM public.chantier WHERE projet_id = $1;', [projetId]);
    
    let chantier1Id, chantier2Id, chantier3Id;

    if (existingChantiers.rows.length === 0) {
      const c1 = await db.query(`
        INSERT INTO public.chantier (projet_id, responsable_id, nom, localisation, surface, date_creation, date_debut, date_fin_prevue, statut)
        VALUES (
          $1, $2, 'Tronçon Nord - Terrassement & Déblais',
          ST_SetSRID(ST_MakePolygon(ST_GeomFromText('LINESTRING(-6.85 33.98, -6.83 33.98, -6.83 33.96, -6.85 33.96, -6.85 33.98)')), 4326),
          12500.0, '2026-01-20 09:00:00', '2026-02-01', '2026-06-30', 'En cours'
        )
        RETURNING id;
      `, [projetId, userId]);
      chantier1Id = c1.rows[0].id;

      const c2 = await db.query(`
        INSERT INTO public.chantier (projet_id, responsable_id, nom, localisation, surface, date_creation, date_debut, date_fin_prevue, statut)
        VALUES (
          $1, $2, 'Tronçon Centre - Ouvrage d''art & Pont',
          ST_SetSRID(ST_MakePolygon(ST_GeomFromText('LINESTRING(-6.83 33.96, -6.81 33.96, -6.81 33.94, -6.83 33.94, -6.83 33.96)')), 4326),
          8400.0, '2026-02-15 10:00:00', '2026-03-01', '2026-09-30', 'En cours'
        )
        RETURNING id;
      `, [projetId, userId]);
      chantier2Id = c2.rows[0].id;

      const c3 = await db.query(`
        INSERT INTO public.chantier (projet_id, responsable_id, nom, localisation, surface, date_creation, date_debut, date_fin_prevue, statut)
        VALUES (
          $1, $2, 'Tronçon Sud - Revêtement & Signalisation',
          ST_SetSRID(ST_MakePolygon(ST_GeomFromText('LINESTRING(-6.81 33.94, -6.79 33.94, -6.79 33.92, -6.81 33.92, -6.81 33.94)')), 4326),
          15200.0, '2026-03-10 08:30:00', '2026-04-01', '2026-12-15', 'En attente'
        )
        RETURNING id;
      `, [projetId, userId]);
      chantier3Id = c3.rows[0].id;

      console.log(`✅ 3 Chantiers created: #${chantier1Id}, #${chantier2Id}, #${chantier3Id}`);
    } else {
      chantier1Id = existingChantiers.rows[0].id;
      chantier2Id = existingChantiers.rows[1]?.id || chantier1Id;
      chantier3Id = existingChantiers.rows[2]?.id || chantier1Id;
      console.log(`ℹ️ Chantiers already exist for Projet #${projetId}`);
    }

    // 4. Seed Avancement records (80%, 70%, 50% -> average = 67%)
    const existingAvancement = await db.query('SELECT * FROM public.avancement WHERE chantier_id IN ($1, $2, $3);', [chantier1Id, chantier2Id, chantier3Id]);
    if (existingAvancement.rows.length === 0) {
      await db.query(`
        INSERT INTO public.avancement (chantier_id, pourcentage, date, commentaire)
        VALUES 
          ($1, 80.0, '2026-08-18', 'Terrassement achevé sur 80% du linéaire prévu'),
          ($2, 70.0, '2026-08-19', 'Piles et culées du pont principal en cours de coulage'),
          ($3, 50.0, '2026-08-15', 'Nivellement et préparation du sous-sol');
      `, [chantier1Id, chantier2Id, chantier3Id]);
      console.log('✅ Avancement records created (80%, 70%, 50% -> 67% average)');
    }

    // 5. Seed ImageSatellite records (2 nouvelles images)
    const existingImages = await db.query('SELECT * FROM public.image_satellite WHERE chantier_id IN ($1, $2, $3);', [chantier1Id, chantier2Id, chantier3Id]);
    if (existingImages.rows.length === 0) {
      await db.query(`
        INSERT INTO public.image_satellite (chantier_id, date_acquisition, source, type_image, url_fichier, resolution, cloud_coverage, indice_spectral)
        VALUES 
          ($1, '2026-08-17', 'Sentinel-2', 'Optique Multispectrale', '/uploads/satellites/sentinel2_route_x_nord.tif', 10.0, 1.2, 'NDVI'),
          ($2, '2026-08-19', 'PlanetScope', 'RGB Haute Résolution', '/uploads/satellites/planet_route_x_centre.tif', 3.0, 0.0, 'RGB');
      `, [chantier1Id, chantier2Id]);
      console.log('✅ 2 ImageSatellite records created (Sentinel-2 & PlanetScope)');
    }

    // 6. Seed Reclamation records (1 réclamation)
    const existingReclamations = await db.query('SELECT * FROM public.reclamation WHERE chantier_id IN ($1, $2, $3);', [chantier1Id, chantier2Id, chantier3Id]);
    if (existingReclamations.rows.length === 0) {
      await db.query(`
        INSERT INTO public.reclamation (chantier_id, utilisateur_id, titre, description, date_creation, statut)
        VALUES (
          $1, $2, 'Fissuration bitume PK 12+400',
          'Affaissement mineur observé suite aux pluies récentes sur la voie de déviation.',
          '2026-08-19 10:30:00',
          'Ouverte'
        );
      `, [chantier1Id, userId]);
      console.log('✅ 1 Reclamation record created (Ouverte)');
    }

    console.log('🎉 Seeding completed successfully!');
  } catch (err) {
    console.error('❌ Seeding error:', err);
  } finally {
    process.exit(0);
  }
}

seed();
