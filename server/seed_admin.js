/**
 * server/seed_admin.js
 *
 * Seeds the dedicated development administrator account in PostgreSQL.
 *
 * Credentials:
 *   Email:    admin@sitex.local
 *   Password: Sx!Admin#2026_R7pL9
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const bcrypt = require('bcryptjs');
const db = require('./src/db');

const ADMIN_EMAIL = 'admin@sitex.local';
const ADMIN_PASSWORD = 'Sx!Admin#2026_R7pL9';
const ADMIN_ROLE_NAME = 'Administrateur';

async function seedAdmin() {
  try {
    console.log('🔄 Checking database connection...');
    await db.verifyConnection();

    // 1. Resolve Administrateur role by name
    const roleResult = await db.query(
      'SELECT id, nom FROM public.role WHERE nom = $1',
      [ADMIN_ROLE_NAME]
    );

    if (roleResult.rows.length === 0) {
      throw new Error(`Role "${ADMIN_ROLE_NAME}" not found in public.role table.`);
    }

    const adminRoleId = roleResult.rows[0].id;
    console.log(`✅ Resolved role "${ADMIN_ROLE_NAME}" with ID: ${adminRoleId}`);

    // 2. Hash password with bcrypt (10 rounds)
    const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 10);

    // 3. Check if admin already exists
    const existing = await db.query(
      'SELECT id, email, role_id FROM public.utilisateur WHERE LOWER(email) = LOWER($1)',
      [ADMIN_EMAIL]
    );

    if (existing.rows.length > 0) {
      const user = existing.rows[0];
      console.log(`ℹ️ Admin user already exists with ID: ${user.id}. Updating role and password...`);
      await db.query(
        `UPDATE public.utilisateur
            SET role_id = $1,
                mot_de_passe = $2,
                nom = 'Admin',
                prenom = 'SiteX',
                actif = true
          WHERE id = $3`,
        [adminRoleId, hashedPassword, user.id]
      );
      console.log('✅ Admin user successfully updated.');
    } else {
      console.log('➕ Creating new Admin user...');
      const insertResult = await db.query(
        `INSERT INTO public.utilisateur (role_id, nom, prenom, email, mot_de_passe, actif)
         VALUES ($1, 'Admin', 'SiteX', $2, $3, true)
         RETURNING id, email, role_id, nom, prenom`,
        [adminRoleId, ADMIN_EMAIL.toLowerCase(), hashedPassword]
      );
      console.log('✅ Admin user created:', insertResult.rows[0]);
    }

    process.exit(0);
  } catch (err) {
    console.error('❌ Failed to seed admin user:', err.message);
    process.exit(1);
  }
}

seedAdmin();
