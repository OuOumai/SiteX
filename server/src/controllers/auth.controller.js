/**
 * server/src/controllers/auth.controller.js
 *
 * Authentication business logic for SiteX.
 * Communicates with PostgreSQL via the db.js query wrapper.
 *
 * Endpoints handled:
 *   POST /auth/register  → register()
 *   POST /auth/login     → login()
 *   GET  /auth/me        → getMe()
 *
 * Security guarantees:
 *   - Passwords are hashed with bcrypt before storage (never stored plaintext)
 *   - Password hashes are never returned in API responses
 *   - role_id for public registration is resolved semantically from the DB
 *     (SELECT id FROM public.role WHERE nom = 'AgentTerrain') — never taken
 *     from the client request body, never hardcoded as a numeric constant.
 *   - JWT_SECRET is read from process.env and never exported
 *   - Parameterized SQL queries are used exclusively (no string concatenation)
 *
 * PROVISIONAL ROLE NOTE:
 *   All publicly registered users currently receive the 'AgentTerrain' role.
 *   This is a temporary placeholder to keep the authorization architecture
 *   intact. The final workflow will be:
 *     Registration → account created (AgentTerrain) → user completes profile
 *     → user requests professional role → administrator verifies → role assigned.
 *
 * TODO (Phase: Role Verification):
 *   Add POST /auth/request-role { role_id } endpoint that creates a pending
 *   verification record. Administrator approves/rejects via admin panel.
 *   Role is only changed by the backend after admin approval.
 */

'use strict';

const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const db     = require('../db');

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * The display name of the role assigned to every publicly registered user.
 * Resolved at registration time via:
 *   SELECT id FROM public.role WHERE nom = 'AgentTerrain'
 *
 * This is INTENTIONALLY a string name, not a numeric ID, so that database
 * migrations that renumber rows do not silently assign the wrong role.
 *
 * PROVISIONAL: 'AgentTerrain' is used as the default until the role-request
 * / administrator-verification workflow is implemented.
 * Do NOT change this to a numeric constant.
 */
const DEFAULT_REGISTRATION_ROLE_NAME = 'AgentTerrain';

/** bcrypt work factor */
const BCRYPT_ROUNDS = 10;

/** JWT expiry — 7 days, matching the original contract expected by AuthContext */
const JWT_EXPIRES_IN = '7d';

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * Signs a JWT for the given user.
 * Payload: { id, email, role_id, role_nom } — minimal, no sensitive data.
 *
 * @param {{ id: number, email: string, role_id: number, role_nom?: string }} user
 * @returns {string} signed JWT
 */
function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role_id: user.role_id, role_nom: user.role_nom },
    process.env.JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

/**
 * Strips mot_de_passe from a database row before sending it to the client.
 * Preserves the exact shape expected by AuthContext / services/api.ts:
 *   { id, role_id, role_nom, nom, prenom, email, actif, date_creation }
 *
 * @param {object} row - Raw row from public.utilisateur
 * @returns {object}   - Safe user object (no password hash)
 */
function formatUserResponse(row) {
  const { mot_de_passe, ...safeUser } = row;
  return safeUser;
}

// ─── Controller Methods ───────────────────────────────────────────────────────

/**
 * POST /auth/register
 *
 * Registers a new user in public.utilisateur.
 * The role_id is resolved semantically from the database using
 * DEFAULT_REGISTRATION_ROLE_NAME ('AgentTerrain') — never taken from the
 * client request body and never stored as a hardcoded numeric constant.
 *
 * Request body: { nom, prenom, email, mot_de_passe }  (role_id is ignored)
 * Response:     { token, user }
 */
async function register(req, res) {
  try {
    const { nom, prenom, email, mot_de_passe } = req.body;

    // 1. Validate required fields
    if (!nom || !prenom || !email || !mot_de_passe) {
      return res.status(400).json({
        message: 'Tous les champs sont requis : nom, prenom, email, mot_de_passe.',
      });
    }

    // 2. Resolve the provisional registration role from the database.
    const roleResult = await db.query(
      "SELECT id, nom FROM public.role WHERE nom = $1",
      [DEFAULT_REGISTRATION_ROLE_NAME]
    );
    if (roleResult.rows.length === 0) {
      console.error(
        `❌ Register: role '${DEFAULT_REGISTRATION_ROLE_NAME}' not found in public.role. ` +
        'Verify that the database seed has been run.'
      );
      return res.status(500).json({
        message: "Erreur de configuration du serveur. Veuillez contacter un administrateur.",
      });
    }
    const provisionalRoleId = roleResult.rows[0].id;
    const provisionalRoleNom = roleResult.rows[0].nom;

    // 3. Check for duplicate email (case-insensitive via LOWER())
    const existingResult = await db.query(
      'SELECT id FROM public.utilisateur WHERE LOWER(email) = LOWER($1)',
      [email]
    );
    if (existingResult.rows.length > 0) {
      return res.status(409).json({
        message: 'Un utilisateur avec cette adresse email existe déjà.',
      });
    }

    // 4. Hash the password — never store plaintext
    const hashedPassword = await bcrypt.hash(mot_de_passe, BCRYPT_ROUNDS);

    // 5. Insert the new user with the provisionally resolved role_id.
    const insertResult = await db.query(
      `INSERT INTO public.utilisateur (role_id, nom, prenom, email, mot_de_passe)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, role_id, nom, prenom, email, actif, date_creation`,
      [provisionalRoleId, nom.trim(), prenom.trim(), email.toLowerCase(), hashedPassword]
    );

    const newUser = {
      ...insertResult.rows[0],
      role_nom: provisionalRoleNom,
    };

    // 6. Generate JWT
    const token = generateToken(newUser);

    // 7. Return { token, user } — matching the contract expected by AuthContext
    return res.status(201).json({
      token,
      user: formatUserResponse(newUser),
    });
  } catch (error) {
    console.error('❌ Register error:', error.message);
    return res.status(500).json({
      message: "Erreur interne du serveur lors de la création du compte.",
    });
  }
}

/**
 * POST /auth/login
 *
 * Authenticates a user against public.utilisateur.
 *
 * Request body: { email, mot_de_passe }
 * Response:     { token, user }
 */
async function login(req, res) {
  try {
    const { email, mot_de_passe } = req.body;

    // 1. Validate required fields
    if (!email || !mot_de_passe) {
      return res.status(400).json({
        message: 'Veuillez fournir un email et un mot de passe.',
      });
    }

    // 2. Look up the user by email (case-insensitive) joined with role
    const userResult = await db.query(
      `SELECT u.id, u.role_id, u.nom, u.prenom, u.email, u.mot_de_passe, u.actif, u.date_creation,
              r.nom AS role_nom, r.description AS role_description
       FROM public.utilisateur u
       LEFT JOIN public.role r ON u.role_id = r.id
       WHERE LOWER(u.email) = LOWER($1)`,
      [email]
    );

    // 3. Use a generic error message whether the user exists or not
    if (userResult.rows.length === 0) {
      return res.status(401).json({ message: 'Email ou mot de passe incorrect.' });
    }

    const user = userResult.rows[0];

    // 4. Reject inactive accounts
    if (!user.actif) {
      return res.status(403).json({
        message: 'Compte désactivé. Veuillez contacter un administrateur.',
      });
    }

    // 5. Compare submitted password against stored hash
    const isMatch = await bcrypt.compare(mot_de_passe, user.mot_de_passe);
    if (!isMatch) {
      return res.status(401).json({ message: 'Email ou mot de passe incorrect.' });
    }

    // 6. Fetch active role request if exists
    const roleReqResult = await db.query(
      `SELECT dr.*, r.nom AS role_nom, r.description AS role_description
         FROM public.demande_role dr
         JOIN public.role r ON dr.requested_role_id = r.id
        WHERE dr.utilisateur_id = $1
        ORDER BY dr.date_demande DESC
        LIMIT 1`,
      [user.id]
    );
    user.role_request = roleReqResult.rows[0] || null;

    // 7. Generate JWT (includes role_nom)
    const token = generateToken(user);

    // 8. Return { token, user } — password hash stripped via formatUserResponse
    return res.status(200).json({
      token,
      user: formatUserResponse(user),
    });
  } catch (error) {
    console.error('❌ Login error:', error.message);
    return res.status(500).json({
      message: 'Erreur interne du serveur lors de la connexion.',
    });
  }
}

/**
 * GET /auth/me
 *
 * Returns the currently authenticated user's profile.
 * Requires a valid Bearer JWT (handled by authenticateToken middleware).
 *
 * Response: user (no password hash)
 */
async function getMe(req, res) {
  try {
    const userResult = await db.query(
      `SELECT u.id, u.role_id, u.nom, u.prenom, u.email, u.actif, u.date_creation,
              r.nom AS role_nom, r.description AS role_description
       FROM public.utilisateur u
       LEFT JOIN public.role r ON u.role_id = r.id
       WHERE u.id = $1`,
      [req.user.id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: 'Utilisateur non trouvé.' });
    }

    const user = userResult.rows[0];

    // Fetch active role request if exists
    const roleReqResult = await db.query(
      `SELECT dr.*, r.nom AS role_nom, r.description AS role_description
         FROM public.demande_role dr
         JOIN public.role r ON dr.requested_role_id = r.id
        WHERE dr.utilisateur_id = $1
        ORDER BY dr.date_demande DESC
        LIMIT 1`,
      [req.user.id]
    );
    user.role_request = roleReqResult.rows[0] || null;

    return res.status(200).json(user);
  } catch (error) {
    console.error('❌ GetMe error:', error.message);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = { register, login, getMe };
