/**
 * server/src/controllers/user.controller.js
 *
 * User profile business logic for SiteX.
 * Communicates with PostgreSQL via the db.js query wrapper.
 */

'use strict';

const fs     = require('fs');
const path   = require('path');
const bcrypt = require('bcryptjs');
const db     = require('../db');

// ─── Constants ────────────────────────────────────────────────────────────────

const ALLOWED_FIELDS = [
  'nom',
  'prenom',
  'email',
  'date_naissance',
  'photo_url',
  'telephone',
  'adresse',
  'ville',
  'profession',
  'entreprise',
  'poste',
  'numero_pro',
  'region_pro',
  'adresse_pro',
  'latitude',
  'longitude',
  'code_postal',
  'pays',
  'latitude_pro',
  'longitude_pro',
  'pays_pro',
];

const BCRYPT_ROUNDS = 10;

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatUserResponse(row) {
  if (!row) return null;
  const { mot_de_passe, ...safeUser } = row;
  return safeUser;
}

// ─── Controller Methods ───────────────────────────────────────────────────────

/**
 * GET /users/me
 * Retrieves the complete authenticated user profile + role request status.
 */
async function getMe(req, res) {
  try {
    const userResult = await db.query(
      `SELECT u.*, r.nom AS role_nom, r.description AS role_description
       FROM public.utilisateur u
       LEFT JOIN public.role r ON u.role_id = r.id
       WHERE u.id = $1`,
      [req.user.id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: 'Utilisateur non trouvé.' });
    }

    const user = formatUserResponse(userResult.rows[0]);

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

    if (roleReqResult.rows.length > 0) {
      user.role_request = roleReqResult.rows[0];
    } else {
      user.role_request = null;
    }

    return res.status(200).json(user);
  } catch (error) {
    console.error('❌ GetMe error:', error.message);
    return res.status(500).json({ message: 'Erreur serveur.' });
  }
}

/**
 * PATCH /users/me
 * Updates personal, contact, professional, and location profile information in public.utilisateur.
 */
async function updateMe(req, res) {
  try {
    const updates = {};
    for (const field of ALLOWED_FIELDS) {
      if (req.body[field] !== undefined) {
        let val = req.body[field];
        if (typeof val === 'string' && val.trim() === '') {
          val = null;
        }
        updates[field] = val;
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        message: 'Veuillez fournir au moins un champ valide à mettre à jour.',
      });
    }

    const fields = Object.keys(updates);
    const values = Object.values(updates);

    const setClauses = fields.map((col, idx) => `${col} = $${idx + 1}`).join(', ');
    const idParam = `$${fields.length + 1}`;

    const result = await db.query(
      `UPDATE public.utilisateur
          SET ${setClauses}
        WHERE id = ${idParam}
        RETURNING *`,
      [...values, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Utilisateur non trouvé.' });
    }

    // Fetch updated user with role
    const fullUserRes = await db.query(
      `SELECT u.*, r.nom AS role_nom, r.description AS role_description
       FROM public.utilisateur u
       LEFT JOIN public.role r ON u.role_id = r.id
       WHERE u.id = $1`,
      [req.user.id]
    );

    const updatedUser = formatUserResponse(fullUserRes.rows[0]);

    // Include role_request status
    const roleReqResult = await db.query(
      `SELECT dr.*, r.nom AS role_nom, r.description AS role_description
         FROM public.demande_role dr
         JOIN public.role r ON dr.requested_role_id = r.id
        WHERE dr.utilisateur_id = $1
        ORDER BY dr.date_demande DESC
        LIMIT 1`,
      [req.user.id]
    );
    updatedUser.role_request = roleReqResult.rows[0] ?? null;

    return res.status(200).json({
      user: updatedUser,
    });
  } catch (error) {
    console.error('❌ UpdateMe error:', error.message);
    return res.status(500).json({
      message: 'Erreur interne du serveur lors de la mise à jour du profil.',
    });
  }
}

/**
 * PATCH /users/me/password
 * Changes the user password securely via bcrypt.
 */
async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        message: 'Veuillez fournir le mot de passe actuel et le nouveau mot de passe.',
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        message: 'Le nouveau mot de passe doit contenir au moins 6 caractères.',
      });
    }

    // 1. Fetch current password hash
    const userResult = await db.query(
      `SELECT mot_de_passe FROM public.utilisateur WHERE id = $1`,
      [req.user.id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: 'Utilisateur non trouvé.' });
    }

    const storedHash = userResult.rows[0].mot_de_passe;

    // 2. Verify current password
    const isMatch = await bcrypt.compare(currentPassword, storedHash);
    if (!isMatch) {
      return res.status(401).json({ message: 'Mot de passe actuel incorrect.' });
    }

    // 3. Hash new password
    const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    // 4. Update in PostgreSQL
    await db.query(
      `UPDATE public.utilisateur SET mot_de_passe = $1 WHERE id = $2`,
      [newHash, req.user.id]
    );

    return res.status(200).json({
      message: 'Mot de passe modifié avec succès.',
    });
  } catch (error) {
    console.error('❌ ChangePassword error:', error.message);
    return res.status(500).json({
      message: 'Erreur lors du changement de mot de passe.',
    });
  }
}

/**
 * POST /users/me/photo
 * Uploads a profile picture via Multer and saves it to server static storage.
 */
async function uploadPhoto(req, res) {
  try {
    let filename;

    if (req.file) {
      filename = req.file.filename;
    } else if (req.body && (req.body.imageBase64 || req.body.image)) {
      const base64Str = req.body.imageBase64 || req.body.image;
      const matches = base64Str.match(/^data:image\/([a-zA-Z+]+);base64,(.+)$/);
      let ext = 'jpg';
      let dataBuffer;
      if (matches && matches.length === 3) {
        ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
        dataBuffer = Buffer.from(matches[2], 'base64');
      } else {
        dataBuffer = Buffer.from(base64Str, 'base64');
      }
      filename = `avatar_${req.user.id}_${Date.now()}.${ext}`;
      const uploadDir = path.join(__dirname, '../../uploads/avatars');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      fs.writeFileSync(path.join(uploadDir, filename), dataBuffer);
    } else {
      return res.status(400).json({ message: 'Aucune image fournie.' });
    }

    // 1. Check existing photo and clean up old avatar file
    const currentUser = await db.query(
      `SELECT photo_url FROM public.utilisateur WHERE id = $1`,
      [req.user.id]
    );

    if (currentUser.rows.length > 0 && currentUser.rows[0].photo_url) {
      const oldUrl = currentUser.rows[0].photo_url;
      if (oldUrl.startsWith('/uploads/avatars/')) {
        const oldFileName = path.basename(oldUrl);
        const oldFilePath = path.join(__dirname, '../../uploads/avatars', oldFileName);
        if (fs.existsSync(oldFilePath)) {
          try {
            fs.unlinkSync(oldFilePath);
          } catch (e) {
            console.warn('Could not delete old avatar:', e.message);
          }
        }
      }
    }

    const relativeUrl = `/uploads/avatars/${filename}`;

    // 2. Update in database
    const updateResult = await db.query(
      `UPDATE public.utilisateur SET photo_url = $1 WHERE id = $2 RETURNING *`,
      [relativeUrl, req.user.id]
    );

    const updatedUser = formatUserResponse(updateResult.rows[0]);

    return res.status(200).json({
      photo_url: relativeUrl,
      user: updatedUser,
    });
  } catch (error) {
    console.error('❌ UploadPhoto error:', error.message);
    if (req.file && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (e) {}
    }
    return res.status(500).json({
      message: "Erreur lors de l'enregistrement de la photo de profil.",
    });
  }
}

/**
 * DELETE /users/me/photo
 * Removes the profile picture and cleans up the filesystem.
 */
async function deletePhoto(req, res) {
  try {
    const currentUser = await db.query(
      `SELECT photo_url FROM public.utilisateur WHERE id = $1`,
      [req.user.id]
    );

    if (currentUser.rows.length === 0) {
      return res.status(404).json({ message: 'Utilisateur non trouvé.' });
    }

    const oldUrl = currentUser.rows[0].photo_url;
    if (oldUrl) {
      if (oldUrl.startsWith('/uploads/avatars/')) {
        const oldFileName = path.basename(oldUrl);
        const oldFilePath = path.join(__dirname, '../../uploads/avatars', oldFileName);
        if (fs.existsSync(oldFilePath)) {
          fs.unlinkSync(oldFilePath);
        }
      }

      const updateResult = await db.query(
        `UPDATE public.utilisateur SET photo_url = NULL WHERE id = $1 RETURNING *`,
        [req.user.id]
      );

      const updatedUser = formatUserResponse(updateResult.rows[0]);

      return res.status(200).json({
        message: 'Photo supprimée avec succès.',
        user: updatedUser,
      });
    }

    return res.status(400).json({ message: "L'utilisateur n'a pas de photo de profil." });
  } catch (error) {
    console.error('❌ DeletePhoto error:', error.message);
    return res.status(500).json({
      message: 'Erreur lors de la suppression de la photo de profil.',
    });
  }
}

module.exports = {
  getMe,
  updateMe,
  changePassword,
  uploadPhoto,
  deletePhoto,
};
