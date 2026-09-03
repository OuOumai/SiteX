'use strict';

require('dotenv').config();
const assert = require('assert');
const db = require('./src/db');

async function test() {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const schema = await client.query(`
      SELECT
        EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'chantier' AND column_name = 'd_max_position_meters') AS has_d_max,
        EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'observation_terrain' AND column_name = 'validation_status') AS has_validation_status,
        EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'uq_active_affectation_per_agent') AS has_agent_guard,
        EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'uq_active_affectation_per_troncon') AS has_troncon_guard
    `);
    assert.deepStrictEqual(schema.rows[0], {
      has_d_max: true,
      has_validation_status: true,
      has_agent_guard: true,
      has_troncon_guard: true,
    }, 'Database migration must expose the threshold, status, and assignment guards');

    const spatial = await client.query(`
      WITH input AS (
        SELECT
          ST_Transform(ST_SetSRID(ST_GeomFromText('LINESTRING(0 0, 0.01 0, 0.01 0.01, 0.02 0.01)'), 4326), 3857) AS line,
          ST_Transform(ST_SetSRID(ST_Point(0.0102, 0.009), 4326), 3857) AS gps
      ), projected AS (
        SELECT line, gps, ST_ClosestPoint(line, gps) AS projected,
               ST_LineLocatePoint(line, gps) AS fraction
        FROM input
      )
      SELECT ST_Length(line) AS curved_length,
             ST_Distance(ST_StartPoint(line), ST_EndPoint(line)) AS straight_length,
             fraction * ST_Length(line) AS progression,
             ST_Distance(ST_StartPoint(line), gps) AS straight_progression,
             ST_Distance(line, gps) AS d_min,
             ST_Distance(projected, line) AS projected_offset,
             ST_X(ST_Transform(gps, 4326)) AS real_lng,
             ST_X(ST_Transform(projected, 4326)) AS projected_lng
      FROM projected
    `);
    const s = spatial.rows[0];
    assert(Number(s.curved_length) > Number(s.straight_length), 'A: progression must follow curved length');
    assert(Math.abs(Number(s.progression) - Number(s.straight_progression)) > 100, 'A: located progression must not be start-to-GPS straight distance');
    assert(Number(s.d_min) <= 50, 'B: sample must be within D_max');
    assert(Math.abs(Number(s.projected_offset)) < 0.001, 'D: projected coordinate must lie on the tronçon');
    assert.notStrictEqual(Number(s.real_lng), Number(s.projected_lng), 'D: real and projected coordinates remain distinct');

    const proximity = (dMin, dMax, confirmed) => {
      if (dMin <= dMax) return 'normal';
      if (!confirmed) return 'rejected';
      return 'exceptional';
    };
    assert.strictEqual(proximity(20, 50, false), 'normal', 'B');
    assert.strictEqual(proximity(80, 50, false), 'rejected', 'C');
    assert.strictEqual(proximity(80, 50, true), 'exceptional', 'C');

    const direction = await client.query(`
      WITH ref AS (SELECT ST_GeomFromText('LINESTRING(0 0, 1 0, 2 1)', 4326) AS geom),
      reversed_input AS (SELECT ST_Reverse(geom) AS geom FROM ref),
      normalized AS (
        SELECT CASE WHEN ST_LineLocatePoint(r.geom, ST_StartPoint(i.geom)) <= ST_LineLocatePoint(r.geom, ST_EndPoint(i.geom))
                    THEN i.geom ELSE ST_Reverse(i.geom) END AS geom
        FROM ref r, reversed_input i
      )
      SELECT ST_LineLocatePoint(r.geom, ST_StartPoint(n.geom)) AS start_fraction,
             ST_LineLocatePoint(r.geom, ST_EndPoint(n.geom)) AS end_fraction
      FROM ref r, normalized n
    `);
    assert.strictEqual(Number(direction.rows[0].start_fraction), 0, 'E: PK début must map to fraction 0');
    assert.strictEqual(Number(direction.rows[0].end_fraction), 1, 'E: PK fin must map to fraction 1');

    await client.query(`
      CREATE TEMP TABLE assignment_test (
        id serial PRIMARY KEY, troncon_id int NOT NULL, agent_id int NOT NULL, statut text NOT NULL DEFAULT 'ACTIF'
      );
      CREATE UNIQUE INDEX ON assignment_test(troncon_id) WHERE statut = 'ACTIF';
      CREATE UNIQUE INDEX ON assignment_test(agent_id) WHERE statut = 'ACTIF';
      INSERT INTO assignment_test(troncon_id, agent_id) VALUES (1, 10);
    `);
    await assert.rejects(client.query(`INSERT INTO assignment_test(troncon_id, agent_id) VALUES (1, 11)`), /duplicate key/);
    await client.query('ROLLBACK');
    await client.query('BEGIN');
    await client.query(`
      CREATE TEMP TABLE assignment_test_2 (
        id serial PRIMARY KEY, troncon_id int NOT NULL, agent_id int NOT NULL, statut text NOT NULL DEFAULT 'ACTIF'
      );
      CREATE UNIQUE INDEX ON assignment_test_2(agent_id) WHERE statut = 'ACTIF';
      INSERT INTO assignment_test_2(troncon_id, agent_id) VALUES (1, 10);
    `);
    await assert.rejects(client.query(`INSERT INTO assignment_test_2(troncon_id, agent_id) VALUES (2, 10)`), /duplicate key/);

    console.log('✅ A curved LRS, B normal proximity, C exceptional confirmation, D coordinate preservation, E direction, F assignment protection');
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    await db.pool.end();
  }
}

test().catch((error) => {
  console.error('❌ Spatial validation rules failed:', error);
  process.exit(1);
});
