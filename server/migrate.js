/**
 * server/migrate.js
 *
 * Applies PostgreSQL database schema updates for SiteX Profile System & Role Requests.
 */
'use strict';

require('dotenv').config();
const { pool } = require('./src/db');

async function runMigration() {
  console.log('🚀 Running database migrations...');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Add profile columns to public.utilisateur if they don't already exist
    const columns = [
      { name: 'date_naissance', type: 'VARCHAR(20)' },
      { name: 'photo_url',      type: 'TEXT' },
      { name: 'telephone',      type: 'VARCHAR(30)' },
      { name: 'adresse',        type: 'TEXT' },
      { name: 'ville',          type: 'VARCHAR(100)' },
      { name: 'profession',     type: 'VARCHAR(100)' },
      { name: 'entreprise',     type: 'VARCHAR(100)' },
      { name: 'poste',          type: 'VARCHAR(100)' },
      { name: 'numero_pro',     type: 'VARCHAR(50)' },
      { name: 'region_pro',     type: 'VARCHAR(100)' },
      { name: 'adresse_pro',    type: 'TEXT' },
      { name: 'latitude',       type: 'DOUBLE PRECISION' },
      { name: 'longitude',      type: 'DOUBLE PRECISION' },
      { name: 'code_postal',    type: 'VARCHAR(30)' },
      { name: 'pays',           type: 'VARCHAR(100)' },
      { name: 'latitude_pro',   type: 'DOUBLE PRECISION' },
      { name: 'longitude_pro',  type: 'DOUBLE PRECISION' },
      { name: 'pays_pro',       type: 'VARCHAR(100)' },
    ];

    for (const col of columns) {
      await client.query(`
        ALTER TABLE public.utilisateur 
        ADD COLUMN IF NOT EXISTS ${col.name} ${col.type};
      `);
      console.log(`  └─ Column public.utilisateur.${col.name} ready (${col.type})`);
    }

    // 2. Create public.demande_role table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.demande_role (
        id SERIAL PRIMARY KEY,
        utilisateur_id INTEGER NOT NULL REFERENCES public.utilisateur(id) ON DELETE CASCADE,
        requested_role_id INTEGER NOT NULL REFERENCES public.role(id),
        statut VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        date_demande TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        date_traitement TIMESTAMP WITH TIME ZONE,
        traite_par INTEGER REFERENCES public.utilisateur(id)
      );
    `);
    console.log('  └─ Table public.demande_role ready');

    // 3. Add CRS tracking columns to public.reference_alignment if table exists
    await client.query(`
      ALTER TABLE public.reference_alignment
      ADD COLUMN IF NOT EXISTS source_srid INTEGER DEFAULT 4326,
      ADD COLUMN IF NOT EXISTS source_crs_name VARCHAR(100) DEFAULT 'WGS 84';
    `);
    console.log('  └─ Columns source_srid, source_crs_name in public.reference_alignment ready');

    // 4. Create public.affectation_troncon table for Agent de Terrain assignments
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.affectation_troncon (
        id SERIAL PRIMARY KEY,
        troncon_id INTEGER NOT NULL REFERENCES public.troncon(id) ON DELETE CASCADE,
        agent_id INTEGER NOT NULL REFERENCES public.utilisateur(id) ON DELETE CASCADE,
        affecte_par INTEGER REFERENCES public.utilisateur(id) ON DELETE SET NULL,
        date_affectation TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        statut VARCHAR(20) NOT NULL DEFAULT 'ACTIF',
        notes TEXT,
        CONSTRAINT uq_troncon_agent UNIQUE(troncon_id, agent_id)
      );
      CREATE INDEX IF NOT EXISTS idx_affectation_agent ON public.affectation_troncon(agent_id);
      CREATE INDEX IF NOT EXISTS idx_affectation_troncon ON public.affectation_troncon(troncon_id);
    `);
    console.log('  └─ Table public.affectation_troncon ready');

    // 5. Add GPS & Spatial projection, Phase and Phase Status columns to public.observation_terrain
    await client.query(`
      ALTER TABLE public.observation_terrain
      ADD COLUMN IF NOT EXISTS agent_lat DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS agent_lng DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS projected_lat DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS projected_lng DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS distance_from_start DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS progress_percentage DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS position_projetee GEOMETRY(Point, 4326),
      ADD COLUMN IF NOT EXISTS accuracy DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS distance_offset DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS phase VARCHAR(50),
      ADD COLUMN IF NOT EXISTS phase_statut VARCHAR(30) DEFAULT 'En cours';
    `);
    console.log('  └─ Columns for GPS projection, phase & progress in public.observation_terrain ready');

    await client.query('COMMIT');
    console.log('✅ Database migration completed successfully!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();
