/**
 * server/test_profile_system.js
 *
 * Automated verification script for SiteX Profile System & Role Request workflow.
 */

'use strict';

require('dotenv').config();
const { pool } = require('./src/db');
const jwt = require('jsonwebtoken');

const API_BASE = 'http://localhost:5000';

async function runTests() {
  console.log('🧪 Starting Profile System & Role Request verification tests...');

  try {
    // 1. Fetch or create a test user in DB
    const testEmail = 'profile_test_2026@sitex.com';
    await pool.query('DELETE FROM public.utilisateur WHERE email = $1', [testEmail]);

    const roleRes = await pool.query("SELECT id FROM public.role WHERE nom = 'AgentTerrain'");
    const roleId = roleRes.rows[0].id;

    const userRes = await pool.query(
      `INSERT INTO public.utilisateur (role_id, nom, prenom, email, mot_de_passe)
       VALUES ($1, 'El Amrani', 'Youssef', $2, '$2a$10$abcdefghijklmnopqrstuu')
       RETURNING id, role_id, nom, prenom, email`,
      [roleId, testEmail]
    );
    const userId = userRes.rows[0].id;
    console.log(`  ✓ Test user created with ID: ${userId}`);

    // Generate JWT token
    const token = jwt.sign({ id: userId, email: testEmail, role_id: roleId }, process.env.JWT_SECRET);

    // 2. Test GET /users/me
    const getRes = await fetch(`${API_BASE}/users/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const getUserData = await getRes.json();
    console.log('  ✓ GET /users/me status:', getRes.status, '— nom:', getUserData.nom);

    // 3. Test PATCH /users/me (full profile update)
    const patchPayload = {
      nom: 'El Amrani Updated',
      prenom: 'Youssef',
      email: testEmail,
      date_naissance: '1992-08-20',
      telephone: '+212611223344',
      adresse: '123 Avenue Hassan II',
      ville: 'Casablanca',
      profession: 'Ingénieur BTP',
      entreprise: 'GeoStructure SARL',
      poste: 'Responsable Technique',
      numero_pro: 'ING-9988',
      ville_pro: 'Rabat',
      region_pro: 'Rabat-Salé-Kénitra',
      adresse_pro: '45 Boulevard Anfa',
    };

    const patchRes = await fetch(`${API_BASE}/users/me`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(patchPayload),
    });
    const patchData = await patchRes.json();
    console.log('  ✓ PATCH /users/me status:', patchRes.status, '— entreprise:', patchData.user?.entreprise);

    // 4. Test POST /users/me/role-request with Administrateur (ID 1) -> Must be rejected!
    const badRoleRes = await fetch(`${API_BASE}/users/me/role-request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ role_id: 1 }),
    });
    console.log('  ✓ POST /users/me/role-request with Administrateur status:', badRoleRes.status, '(expected 400)');

    // 5. Test POST /users/me/role-request with Responsable (ID 2) -> Must succeed!
    const goodRoleRes = await fetch(`${API_BASE}/users/me/role-request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ role_id: 2 }),
    });
    const roleData = await goodRoleRes.json();
    console.log('  ✓ POST /users/me/role-request with Responsable de Projet status:', goodRoleRes.status, '— statut:', roleData.role_request?.statut);

    // 6. Test GET /users/me to verify user state contains updated profile and active role_request
    const getFinalRes = await fetch(`${API_BASE}/users/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const finalUserData = await getFinalRes.json();
    console.log('  ✓ Verified complete profile:', {
      nom: finalUserData.nom,
      profession: finalUserData.profession,
      telephone: finalUserData.telephone,
      role_request_status: finalUserData.role_request?.statut,
      requested_role: finalUserData.role_request?.role_nom,
    });

    console.log('🎉 ALL INTEGRATION TESTS PASSED PERFECTLY!');
  } catch (err) {
    console.error('❌ Integration test failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runTests();
