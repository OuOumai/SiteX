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

    // 3. Add CRS tracking and original_geometry columns to public.reference_alignment if table exists
    await client.query(`
      ALTER TABLE public.reference_alignment
      ADD COLUMN IF NOT EXISTS source_srid INTEGER DEFAULT 4326,
      ADD COLUMN IF NOT EXISTS source_crs_name VARCHAR(100) DEFAULT 'WGS 84',
      ADD COLUMN IF NOT EXISTS original_geometry GEOMETRY(LineString, 4326);
    `);
    console.log('  └─ Columns source_srid, source_crs_name, original_geometry in public.reference_alignment ready');

    // Backfill existing records for backward compatibility
    await client.query(`
      UPDATE public.reference_alignment
      SET original_geometry = geometry
      WHERE original_geometry IS NULL;
    `);
    console.log('  └─ Existing reference_alignment records backfilled (original_geometry initialized)');


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

    // 6. Chantier proximity policy and observation validation audit
    await client.query(`
      ALTER TABLE public.chantier
      ADD COLUMN IF NOT EXISTS d_max_position_meters NUMERIC(10, 2) NOT NULL DEFAULT 50;

      ALTER TABLE public.chantier DROP CONSTRAINT IF EXISTS chantier_d_max_position_meters_check;
      ALTER TABLE public.chantier
      ADD CONSTRAINT chantier_d_max_position_meters_check
      CHECK (d_max_position_meters > 0);

      ALTER TABLE public.observation_terrain
      ADD COLUMN IF NOT EXISTS validation_status VARCHAR(20) NOT NULL DEFAULT 'normal';

      ALTER TABLE public.observation_terrain DROP CONSTRAINT IF EXISTS observation_validation_status_check;
      ALTER TABLE public.observation_terrain
      ADD CONSTRAINT observation_validation_status_check
      CHECK (validation_status IN ('normal', 'exceptional'));
    `);
    console.log('  └─ D_max and observation validation status ready');

    // 6b. Observation progress snapshots and precise authoritative tronçon progress.
    // Spatial positions remain sourced from distance_from_start/chainage; these fields
    // preserve the business result as it was when an observation was accepted.
    await client.query(`
      ALTER TABLE public.observation_terrain
      ADD COLUMN IF NOT EXISTS daily_progress_meters DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS daily_progress_percentage DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS authoritative_progress_meters DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS authoritative_progress_percentage DOUBLE PRECISION;

      ALTER TABLE public.troncon
      ADD COLUMN IF NOT EXISTS authoritative_progress_meters DOUBLE PRECISION NOT NULL DEFAULT 0;

      WITH maxima AS (
        SELECT troncon_id, MAX(COALESCE(distance_from_start, 0)) AS max_meters
        FROM public.observation_terrain
        GROUP BY troncon_id
      )
      UPDATE public.troncon t
      SET authoritative_progress_meters = GREATEST(t.authoritative_progress_meters, m.max_meters),
          avancement = GREATEST(COALESCE(t.avancement, 0), LEAST(100, ROUND(
            100.0 * m.max_meters / NULLIF(ST_Length(t.geometry::geography), 0)
          )))
      FROM maxima m
      WHERE t.id = m.troncon_id;

      WITH snapshots AS (
        SELECT o.id,
          MAX(COALESCE(o.distance_from_start, 0)) OVER (
            PARTITION BY o.troncon_id ORDER BY o.date_heure, o.id ROWS UNBOUNDED PRECEDING
          ) AS authoritative_meters,
          COALESCE((SELECT MAX(prev.distance_from_start)
            FROM public.observation_terrain prev
            WHERE prev.troncon_id = o.troncon_id
              AND prev.date_heure < DATE_TRUNC('day', o.date_heure)), 0) AS day_baseline
        FROM public.observation_terrain o
      )
      UPDATE public.observation_terrain o
      SET daily_progress_meters = COALESCE(o.daily_progress_meters,
            GREATEST(0, COALESCE(o.distance_from_start, 0) - s.day_baseline)),
          daily_progress_percentage = COALESCE(o.daily_progress_percentage,
            GREATEST(0, o.progress_percentage - 100.0 * s.day_baseline /
              NULLIF(ST_Length(t.geometry::geography), 0))),
          authoritative_progress_meters = COALESCE(o.authoritative_progress_meters, s.authoritative_meters),
          authoritative_progress_percentage = COALESCE(o.authoritative_progress_percentage,
            LEAST(100, 100.0 * s.authoritative_meters / NULLIF(ST_Length(t.geometry::geography), 0)))
      FROM snapshots s, public.troncon t
      WHERE o.id = s.id AND t.id = o.troncon_id;

      CREATE INDEX IF NOT EXISTS idx_observation_troncon_date_progress
      ON public.observation_terrain(troncon_id, date_heure, distance_from_start);
    `);
    console.log('  └─ Daily and authoritative progress snapshots ready');

    // 7. A live operational assignment is one-to-one in both directions.
    await client.query(`
      WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY agent_id ORDER BY date_affectation DESC, id DESC) AS rn
        FROM public.affectation_troncon WHERE statut = 'ACTIF'
      )
      UPDATE public.affectation_troncon a SET statut = 'INACTIF'
      FROM ranked r WHERE a.id = r.id AND r.rn > 1;

      WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY troncon_id ORDER BY date_affectation DESC, id DESC) AS rn
        FROM public.affectation_troncon WHERE statut = 'ACTIF'
      )
      UPDATE public.affectation_troncon a SET statut = 'INACTIF'
      FROM ranked r WHERE a.id = r.id AND r.rn > 1;

      CREATE UNIQUE INDEX IF NOT EXISTS uq_active_affectation_per_troncon
      ON public.affectation_troncon(troncon_id)
      WHERE statut = 'ACTIF';

      CREATE UNIQUE INDEX IF NOT EXISTS uq_active_affectation_per_agent
      ON public.affectation_troncon(agent_id)
      WHERE statut = 'ACTIF';
    `);
    console.log('  └─ One active tronçon per Agent de Terrain enforced');

    // 8. Persistent in-app notifications (extends the legacy role notification table).
    await client.query(`
      ALTER TABLE public.notification
      ADD COLUMN IF NOT EXISTS titre VARCHAR(160),
      ADD COLUMN IF NOT EXISTS related_entity_type VARCHAR(40),
      ADD COLUMN IF NOT EXISTS related_entity_id INTEGER,
      ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

      UPDATE public.notification SET titre = COALESCE(titre, 'Notification SiteX') WHERE titre IS NULL;
      ALTER TABLE public.notification ALTER COLUMN titre SET NOT NULL;
      ALTER TABLE public.notification ALTER COLUMN lu SET DEFAULT false;
      CREATE INDEX IF NOT EXISTS idx_notification_user_date ON public.notification(utilisateur_id, date_envoi DESC);
      CREATE INDEX IF NOT EXISTS idx_notification_user_unread ON public.notification(utilisateur_id) WHERE lu = false;

      CREATE OR REPLACE FUNCTION public.notify_assignment_event() RETURNS trigger AS $$
      DECLARE t_nom text; c_nom text;
      BEGIN
        IF NEW.statut = 'ACTIF' THEN
          SELECT t.nom, c.nom INTO t_nom, c_nom FROM public.troncon t JOIN public.chantier c ON c.id = t.chantier_id WHERE t.id = NEW.troncon_id;
          INSERT INTO public.notification(utilisateur_id, titre, message, type, related_entity_type, related_entity_id, metadata, date_envoi, lu)
          VALUES (NEW.agent_id, 'Nouvelle affectation', 'Vous avez été affecté au tronçon ' || COALESCE(t_nom, '') || ' du chantier ' || COALESCE(c_nom, '') || '.',
                  'AFFECTATION_AGENT', 'troncon', NEW.troncon_id, jsonb_build_object('affectation_id', NEW.id), NOW(), false);
        END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS trg_notify_assignment ON public.affectation_troncon;
      CREATE TRIGGER trg_notify_assignment AFTER INSERT ON public.affectation_troncon FOR EACH ROW EXECUTE FUNCTION public.notify_assignment_event();

      CREATE OR REPLACE FUNCTION public.notify_chantier_event() RETURNS trigger AS $$
      DECLARE recipient integer; c_nom text; event_title text; event_type text; entity_type text;
      BEGIN
        SELECT nom INTO c_nom FROM public.chantier WHERE id = NEW.chantier_id;
        event_title := CASE WHEN TG_TABLE_NAME = 'rapport' THEN 'Nouveau rapport' ELSE 'Nouvelle réclamation' END;
        event_type := CASE WHEN TG_TABLE_NAME = 'rapport' THEN 'NOUVEAU_RAPPORT' ELSE 'NOUVELLE_RECLAMATION' END;
        entity_type := TG_TABLE_NAME;
        FOR recipient IN
          SELECT responsable_id FROM public.chantier WHERE id = NEW.chantier_id AND responsable_id IS NOT NULL
          UNION
          SELECT a.agent_id FROM public.affectation_troncon a JOIN public.troncon t ON t.id = a.troncon_id
          WHERE t.chantier_id = NEW.chantier_id AND a.statut = 'ACTIF'
        LOOP
          IF TG_TABLE_NAME = 'rapport' THEN
            INSERT INTO public.notification(utilisateur_id, titre, message, type, related_entity_type, related_entity_id, metadata, date_envoi, lu)
            VALUES (recipient, event_title, event_title || ' pour le chantier ' || COALESCE(c_nom, '') || '.', event_type,
                    entity_type, NEW.id, jsonb_build_object('chantier_id', NEW.chantier_id), NOW(), false);
          ELSIF recipient <> NEW.utilisateur_id THEN
            INSERT INTO public.notification(utilisateur_id, titre, message, type, related_entity_type, related_entity_id, metadata, date_envoi, lu)
            VALUES (recipient, event_title, event_title || ' pour le chantier ' || COALESCE(c_nom, '') || '.', event_type,
                    entity_type, NEW.id, jsonb_build_object('chantier_id', NEW.chantier_id), NOW(), false);
          END IF;
        END LOOP;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql;
      DROP TRIGGER IF EXISTS trg_notify_rapport ON public.rapport;
      CREATE TRIGGER trg_notify_rapport AFTER INSERT ON public.rapport FOR EACH ROW EXECUTE FUNCTION public.notify_chantier_event();
      DROP TRIGGER IF EXISTS trg_notify_reclamation ON public.reclamation;
      CREATE TRIGGER trg_notify_reclamation AFTER INSERT ON public.reclamation FOR EACH ROW EXECUTE FUNCTION public.notify_chantier_event();
    `);
    console.log('  └─ Persistent notifications and server-side event triggers ready');

    // 9. Operational Chantier Journal & Calendar models
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.chantier_calendrier (
        id SERIAL PRIMARY KEY,
        chantier_id INTEGER NOT NULL REFERENCES public.chantier(id) ON DELETE CASCADE,
        jours_travailles INTEGER[] NOT NULL DEFAULT '{1,2,3,4,5,6}',
        date_creation TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        date_modification TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_chantier_calendrier UNIQUE(chantier_id)
      );

      CREATE TABLE IF NOT EXISTS public.jour_ferie (
        id SERIAL PRIMARY KEY,
        date DATE NOT NULL,
        nom VARCHAR(120) NOT NULL,
        est_chome BOOLEAN NOT NULL DEFAULT true,
        chantier_id INTEGER REFERENCES public.chantier(id) ON DELETE CASCADE,
        date_creation TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uq_jour_ferie_date_chantier UNIQUE(date, chantier_id)
      );
      CREATE INDEX IF NOT EXISTS idx_jour_ferie_date ON public.jour_ferie(date);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_uq_jour_ferie_national ON public.jour_ferie(date) WHERE chantier_id IS NULL;

      CREATE TABLE IF NOT EXISTS public.agent_absence (
        id SERIAL PRIMARY KEY,
        agent_id INTEGER NOT NULL REFERENCES public.utilisateur(id) ON DELETE CASCADE,
        date_debut DATE NOT NULL,
        date_fin DATE NOT NULL,
        motif VARCHAR(255) NOT NULL,
        statut VARCHAR(20) NOT NULL DEFAULT 'EN_ATTENTE',
        justificatif_url TEXT,
        traite_par INTEGER REFERENCES public.utilisateur(id) ON DELETE SET NULL,
        date_traitement TIMESTAMP WITH TIME ZONE,
        commentaire_traitement TEXT,
        date_creation TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT chk_agent_absence_statut CHECK (statut IN ('EN_ATTENTE', 'VALIDE', 'REFUSE')),
        CONSTRAINT chk_agent_absence_dates CHECK (date_fin >= date_debut)
      );
      CREATE INDEX IF NOT EXISTS idx_agent_absence_dates ON public.agent_absence(agent_id, date_debut, date_fin);

      CREATE TABLE IF NOT EXISTS public.demande_explication (
        id SERIAL PRIMARY KEY,
        chantier_id INTEGER NOT NULL REFERENCES public.chantier(id) ON DELETE CASCADE,
        troncon_id INTEGER NOT NULL REFERENCES public.troncon(id) ON DELETE CASCADE,
        agent_id INTEGER NOT NULL REFERENCES public.utilisateur(id) ON DELETE CASCADE,
        responsable_id INTEGER NOT NULL REFERENCES public.utilisateur(id) ON DELETE CASCADE,
        date_concernee DATE NOT NULL,
        statut VARCHAR(20) NOT NULL DEFAULT 'EN_ATTENTE',
        message_responsable TEXT,
        motif_agent VARCHAR(100),
        reponse_agent TEXT,
        date_demande TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        date_reponse TIMESTAMP WITH TIME ZONE,
        CONSTRAINT chk_demande_statut CHECK (statut IN ('EN_ATTENTE', 'REPONDUE', 'ACCEPTEE', 'REJETEE', 'ANNULEE')),
        CONSTRAINT uq_demande_troncon_date UNIQUE(troncon_id, date_concernee)
      );
      CREATE INDEX IF NOT EXISTS idx_demande_chantier_date ON public.demande_explication(chantier_id, date_concernee);
      CREATE INDEX IF NOT EXISTS idx_demande_agent_date ON public.demande_explication(agent_id, date_concernee);
    `);
    console.log('  └─ Tables chantier_calendrier, jour_ferie, agent_absence, demande_explication ready');

    // Seed official Moroccan public holidays (national, chantier_id IS NULL)
    const moroccanHolidays = [
      // 2025 Civil
      { date: '2025-01-01', nom: 'Nouvel An' },
      { date: '2025-01-11', nom: "Manifeste de l'Indépendance" },
      { date: '2025-01-14', nom: 'Nouvel An Amazigh' },
      { date: '2025-05-01', nom: 'Fête du Travail' },
      { date: '2025-07-30', nom: 'Fête du Trône' },
      { date: '2025-08-14', nom: 'Allégeance Oued Eddahab' },
      { date: '2025-08-20', nom: 'Révolution du Roi et du Peuple' },
      { date: '2025-08-21', nom: 'Fête de la Jeunesse' },
      { date: '2025-11-06', nom: 'Anniversaire de la Marche Verte' },
      { date: '2025-11-18', nom: "Fête de l'Indépendance" },
      // 2025 Religious (Kingdom of Morocco Ministry of Habous)
      { date: '2025-03-31', nom: 'Aïd Al-Fitr' },
      { date: '2025-04-01', nom: 'Aïd Al-Fitr (2e jour)' },
      { date: '2025-06-06', nom: 'Aïd Al-Adha' },
      { date: '2025-06-07', nom: 'Aïd Al-Adha (2e jour)' },
      { date: '2025-06-26', nom: "1er Moharram (Nouvel An de l'Hégire)" },
      { date: '2025-09-04', nom: 'Aïd Al-Mawlid Annabawi' },
      { date: '2025-09-05', nom: 'Aïd Al-Mawlid Annabawi (2e jour)' },

      // 2026 Civil
      { date: '2026-01-01', nom: 'Nouvel An' },
      { date: '2026-01-11', nom: "Manifeste de l'Indépendance" },
      { date: '2026-01-14', nom: 'Nouvel An Amazigh' },
      { date: '2026-05-01', nom: 'Fête du Travail' },
      { date: '2026-07-30', nom: 'Fête du Trône' },
      { date: '2026-08-14', nom: 'Allégeance Oued Eddahab' },
      { date: '2026-08-20', nom: 'Révolution du Roi et du Peuple' },
      { date: '2026-08-21', nom: 'Fête de la Jeunesse' },
      { date: '2026-11-06', nom: 'Anniversaire de la Marche Verte' },
      { date: '2026-11-18', nom: "Fête de l'Indépendance" },
      // 2026 Religious
      { date: '2026-03-20', nom: 'Aïd Al-Fitr' },
      { date: '2026-03-21', nom: 'Aïd Al-Fitr (2e jour)' },
      { date: '2026-05-27', nom: 'Aïd Al-Adha' },
      { date: '2026-05-28', nom: 'Aïd Al-Adha (2e jour)' },
      { date: '2026-06-17', nom: "1er Moharram (Nouvel An de l'Hégire)" },
      { date: '2026-08-26', nom: 'Aïd Al-Mawlid Annabawi' },
      { date: '2026-08-27', nom: 'Aïd Al-Mawlid Annabawi (2e jour)' },

      // 2027 Civil
      { date: '2027-01-01', nom: 'Nouvel An' },
      { date: '2027-01-11', nom: "Manifeste de l'Indépendance" },
      { date: '2027-01-14', nom: 'Nouvel An Amazigh' },
      { date: '2027-05-01', nom: 'Fête du Travail' },
      { date: '2027-07-30', nom: 'Fête du Trône' },
      { date: '2027-08-14', nom: 'Allégeance Oued Eddahab' },
      { date: '2027-08-20', nom: 'Révolution du Roi et du Peuple' },
      { date: '2027-08-21', nom: 'Fête de la Jeunesse' },
      { date: '2027-11-06', nom: 'Anniversaire de la Marche Verte' },
      { date: '2027-11-18', nom: "Fête de l'Indépendance" },
      // 2027 Religious
      { date: '2027-03-10', nom: 'Aïd Al-Fitr' },
      { date: '2027-03-11', nom: 'Aïd Al-Fitr (2e jour)' },
      { date: '2027-05-17', nom: 'Aïd Al-Adha' },
      { date: '2027-05-18', nom: 'Aïd Al-Adha (2e jour)' },
      { date: '2027-06-07', nom: "1er Moharram (Nouvel An de l'Hégire)" },
      { date: '2027-08-16', nom: 'Aïd Al-Mawlid Annabawi' },
      { date: '2027-08-17', nom: 'Aïd Al-Mawlid Annabawi (2e jour)' },
    ];

    for (const h of moroccanHolidays) {
      await client.query(`
        INSERT INTO public.jour_ferie (date, nom, est_chome, chantier_id)
        VALUES ($1, $2, true, NULL)
        ON CONFLICT (date) WHERE chantier_id IS NULL
        DO UPDATE SET nom = EXCLUDED.nom, est_chome = EXCLUDED.est_chome;
      `, [h.date, h.nom]);
    }
    console.log('  └─ Official Moroccan public holidays seeded successfully');

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
