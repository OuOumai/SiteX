'use strict';

require('dotenv').config();
const db = require('./src/db');
const jwt = require('jsonwebtoken');
const http = require('http');

async function run() {
  console.log('🧪 Testing Admin Role Request Approval Flow...');

  // 1. Get or create admin user
  const adminRes = await db.query(`
    SELECT u.id, u.email, r.nom AS role_nom
    FROM public.utilisateur u
    JOIN public.role r ON u.role_id = r.id
    WHERE r.nom = 'Administrateur' OR u.role_id = 1
    LIMIT 1
  `);

  if (adminRes.rows.length === 0) {
    throw new Error('No admin user found in database.');
  }

  const admin = adminRes.rows[0];
  const adminToken = jwt.sign(
    { id: admin.id, email: admin.email, role_id: 1, role_nom: 'Administrateur' },
    process.env.JWT_SECRET || 'sitex_super_secret_jwt_key_development_2026',
    { expiresIn: '1h' }
  );

  // 2. Create a temporary test user with a pending role request
  const testEmail = `test.applicant.${Date.now()}@sitex.com`;
  const userRes = await db.query(`
    INSERT INTO public.utilisateur (nom, prenom, email, mot_de_passe, role_id, actif)
    VALUES ('Applicant', 'Test', $1, 'dummyhash', 4, true)
    RETURNING id
  `, [testEmail]);
  const applicantId = userRes.rows[0].id;

  const reqRes = await db.query(`
    INSERT INTO public.demande_role (utilisateur_id, requested_role_id, statut, date_demande)
    VALUES ($1, 2, 'PENDING', NOW())
    RETURNING id
  `, [applicantId]);
  const demandeId = reqRes.rows[0].id;

  console.log(`  Created test applicant #${applicantId} with pending demande #${demandeId} (Role: Responsable #2)`);

  // 3. Make HTTP request to /admin/demandes/:id/accept
  const port = process.env.PORT || 5000;

  const postData = JSON.stringify({});
  const options = {
    hostname: '127.0.0.1',
    port: port,
    path: `/admin/demandes/${demandeId}/accept`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`,
      'Content-Length': Buffer.byteLength(postData),
    },
  };

  const response = await new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, body: JSON.parse(body) });
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });

  console.log('  Response status:', response.statusCode);
  console.log('  Response body:', response.body);

  if (response.statusCode !== 200) {
    throw new Error(`Admin accept failed with status ${response.statusCode}: ${JSON.stringify(response.body)}`);
  }

  // 4. Verify DB updates
  const checkUser = await db.query('SELECT role_id FROM public.utilisateur WHERE id = $1', [applicantId]);
  const checkDemande = await db.query('SELECT statut, traite_par FROM public.demande_role WHERE id = $1', [demandeId]);
  const checkNotif = await db.query('SELECT * FROM public.notification WHERE utilisateur_id = $1', [applicantId]);

  console.log('  Updated user role_id:', checkUser.rows[0].role_id, '(Expected: 2)');
  console.log('  Updated demande statut:', checkDemande.rows[0].statut, '(Expected: APPROVED)');
  console.log('  Notification created:', checkNotif.rows.length > 0 ? checkNotif.rows[0].titre : 'None');

  if (checkUser.rows[0].role_id !== 2) throw new Error('User role_id was not updated!');
  if (checkDemande.rows[0].statut !== 'APPROVED') throw new Error('Demande statut was not set to APPROVED!');
  if (checkNotif.rows.length === 0) throw new Error('Notification was not created!');

  // 5. Cleanup
  await db.query('DELETE FROM public.notification WHERE utilisateur_id = $1', [applicantId]);
  await db.query('DELETE FROM public.demande_role WHERE id = $1', [demandeId]);
  await db.query('DELETE FROM public.utilisateur WHERE id = $1', [applicantId]);

  console.log('🎉 Admin acceptance flow test passed 100% successfully!');
  process.exit(0);
}

run().catch((err) => {
  console.error('❌ Test failed:', err.message);
  process.exit(1);
});
