/**
 * server/test_photo_upload.js
 *
 * Verifies Multer multipart photo upload to POST /users/me/photo.
 */

'use strict';

require('dotenv').config();
const { pool } = require('./src/db');
const jwt = require('jsonwebtoken');

const API_BASE = 'http://localhost:5000';

async function runTest() {
  console.log('🧪 Testing Multer photo upload endpoint...');

  try {
    // 1. Get or create test user
    const testEmail = 'photo_multer_test@sitex.com';
    await pool.query('DELETE FROM public.utilisateur WHERE email = $1', [testEmail]);

    const roleRes = await pool.query("SELECT id FROM public.role WHERE nom = 'AgentTerrain'");
    const roleId = roleRes.rows[0].id;

    const userRes = await pool.query(
      `INSERT INTO public.utilisateur (role_id, nom, prenom, email, mot_de_passe)
       VALUES ($1, 'TestNom', 'TestPrenom', $2, 'hash')
       RETURNING id, role_id, nom, prenom, email`,
      [roleId, testEmail]
    );
    const userId = userRes.rows[0].id;

    // Generate JWT
    const token = jwt.sign({ id: userId, email: testEmail, role_id: roleId }, process.env.JWT_SECRET);

    // 2. Build multipart FormData
    const formData = new FormData();
    const fakeImageBuffer = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    const blob = new Blob([fakeImageBuffer], { type: 'image/gif' });
    formData.append('photo', blob, 'test_avatar.gif');

    // 3. Send request
    const response = await fetch(`${API_BASE}/users/me/photo`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    });

    const data = await response.json();
    console.log('  ✓ Response Status:', response.status);
    console.log('  ✓ Response Data:', data);

    if (response.status === 200 && data.photo_url) {
      console.log('🎉 MULTER PHOTO UPLOAD PASSED SUCCESSFULLY!');
    } else {
      console.error('❌ Multer upload test failed with response:', data);
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ Upload test error:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runTest();
