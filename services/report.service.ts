/**
 * services/report.service.ts
 *
 * Project Report Generator & Manager for SiteX.
 * Generates an academic & professional PDF report based on real PostgreSQL data.
 *
 * Provides:
 *  - HTML generation with print & mobile-viewport optimizations
 *  - PDF generation & local caching via expo-print / expo-file-system
 *  - Native file sharing via expo-sharing
 *  - Native device download / save via expo-file-system
 */

import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { ProjectDetails } from './api';

function formatFullFrenchDate(dateStr?: string | null): string {
  if (!dateStr) return 'Non renseigné';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function getStatusBadgeStyle(statut?: string | null): { bg: string; color: string; border: string } {
  const norm = (statut || '').toLowerCase().trim();
  if (norm.includes('termin')) {
    return { bg: '#F3E8FF', color: '#6B21A8', border: '#D8B4FE' }; // Violet
  }
  if (norm.includes('retard')) {
    return { bg: '#FFEDD5', color: '#9A3412', border: '#FDBA74' }; // Orange
  }
  if (norm.includes('attente')) {
    return { bg: '#FEF3C7', color: '#92400E', border: '#FCD34D' }; // Ambre
  }
  return { bg: '#E0F2FE', color: '#0369A1', border: '#BAE6FD' }; // Bleu / En cours
}

/**
 * Builds a standardized, clean filename for the PDF report.
 * Example: SiteX_Report_Route_X_2026-08-22.pdf
 */
export function getReportFileName(projectName: string): string {
  const sanitizedName = (projectName || 'Projet')
    .replace(/[^a-zA-Z0-9_\u00C0-\u017F]/g, '_')
    .replace(/_+/g, '_')
    .substring(0, 30);
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return `SiteX_Report_${sanitizedName}_${dateStr}.pdf`;
}

/**
 * Builds the complete HTML/CSS markup for the academic project report.
 * Supports pinch-to-zoom, responsive viewport, page breaks, and high-DPI print rendering.
 */
export function generateProjectReportHtml(project: ProjectDetails): string {
  const now = new Date();
  const generationDate = now.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const refCode = `SITEX-PRJ-${String(project.id).padStart(4, '0')}-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const chantiers = project.chantiers || [];
  const ind = project.indicateurs || {
    nombreChantiers: chantiers.length,
    avancementGlobal: 0,
    reclamations: 0,
    imagesSatellite: 0,
  };

  const projectStatusStyle = getStatusBadgeStyle(project.statut);
  const responsable = project.chantiers?.[0]?.responsable_nom || 'Non assigné';

  // Table rows for chantiers
  const chantiersRowsHtml = chantiers.length > 0
    ? chantiers.map((ch, idx) => {
        const badge = getStatusBadgeStyle(ch.statut);
        const av = Math.min(100, Math.max(0, ch.avancement || 0));
        const progressColor = av >= 80 ? '#176B5B' : av >= 50 ? '#0284C7' : '#EA580C';

        return `
          <tr>
            <td style="font-weight: 600; color: #0F172A;">
              <span style="color: #64748B; font-size: 11px; margin-right: 4px;">#${idx + 1}</span>
              ${ch.nom}
            </td>
            <td>
              <span class="badge" style="background-color: ${badge.bg}; color: ${badge.color}; border: 1px solid ${badge.border};">
                ${ch.statut || 'En cours'}
              </span>
            </td>
            <td style="color: #334155; font-size: 12px;">
              ${ch.surface ? `${ch.surface.toLocaleString('fr-FR')} m²` : '—'}
            </td>
            <td style="color: #475569; font-size: 12px;">
              ${formatFullFrenchDate(ch.date_debut)} <br/>
              <span style="color: #94A3B8; font-size: 10px;">au</span> ${formatFullFrenchDate(ch.date_fin_prevue)}
            </td>
            <td>
              <div style="display: flex; align-items: center; gap: 8px;">
                <div class="progress-bar-bg">
                  <div class="progress-bar-fill" style="width: ${av}%; background-color: ${progressColor};"></div>
                </div>
                <span style="font-weight: 700; font-size: 12px; color: ${progressColor}; min-width: 32px; text-align: right;">${av}%</span>
              </div>
            </td>
          </tr>
        `;
      }).join('')
    : `
      <tr>
        <td colspan="5" style="text-align: center; color: #94A3B8; padding: 24px;">
          Aucun chantier rattaché à ce projet pour le moment.
        </td>
      </tr>
    `;

  return `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes" />
  <title>Rapport de suivi - ${project.nom}</title>
  <style>
    @page {
      size: A4;
      margin: 16mm 14mm 16mm 14mm;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: #1E293B;
      background-color: #F8FAFC;
      font-size: 13px;
      line-height: 1.5;
      padding: 16px;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .report-sheet {
      background: #FFFFFF;
      max-width: 800px;
      margin: 0 auto;
      padding: 24px 28px;
      border-radius: 12px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06);
      border: 1px solid #E2E8F0;
    }

    /* ── HEADER ── */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #176B5B;
      padding-bottom: 14px;
      margin-bottom: 20px;
    }
    .brand-logo-text {
      font-size: 26px;
      font-weight: 900;
      letter-spacing: -0.5px;
      color: #176B5B;
    }
    .brand-logo-text span {
      color: #D97706;
    }
    .brand-subtitle {
      font-size: 11px;
      color: #64748B;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-top: 2px;
    }
    .header-meta {
      text-align: right;
      font-size: 11px;
      color: #475569;
    }
    .header-meta .ref-badge {
      display: inline-block;
      background: #F1F5F9;
      padding: 3px 8px;
      border-radius: 4px;
      font-family: monospace;
      font-weight: 600;
      color: #334155;
      margin-bottom: 4px;
    }

    /* ── DOCUMENT TITLE ── */
    .doc-title-container {
      background: linear-gradient(135deg, #176B5B 0%, #115044 100%);
      color: #FFFFFF;
      padding: 16px 20px;
      border-radius: 8px;
      margin-bottom: 22px;
    }
    .doc-type-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #A7F3D0;
      font-weight: 700;
      margin-bottom: 4px;
    }
    .doc-project-name {
      font-size: 20px;
      font-weight: 800;
      line-height: 1.25;
    }

    /* ── SECTION CARD ── */
    .section-title {
      font-size: 13.5px;
      font-weight: 700;
      color: #0F172A;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-left: 4px solid #176B5B;
      padding-left: 10px;
      margin-top: 22px;
      margin-bottom: 12px;
    }

    /* ── PROJECT IDENTITY GRID ── */
    .info-card {
      border: 1px solid #E2E8F0;
      border-radius: 8px;
      background-color: #F8FAFC;
      padding: 14px 18px;
      margin-bottom: 18px;
    }
    .info-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px 20px;
    }
    .info-item {
      display: flex;
      flex-direction: column;
    }
    .info-label {
      font-size: 10.5px;
      color: #64748B;
      font-weight: 600;
      text-transform: uppercase;
      margin-bottom: 2px;
    }
    .info-value {
      font-size: 13px;
      color: #0F172A;
      font-weight: 600;
    }
    .project-desc-box {
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px dashed #CBD5E1;
      font-size: 12.5px;
      color: #334155;
      line-height: 1.45;
    }

    /* ── KPI HIGHLIGHTS ── */
    .kpi-row {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
      margin-bottom: 20px;
    }
    .kpi-card {
      border: 1px solid #E2E8F0;
      border-radius: 8px;
      padding: 12px 14px;
      background: #FFFFFF;
      text-align: center;
    }
    .kpi-value {
      font-size: 22px;
      font-weight: 800;
      color: #176B5B;
    }
    .kpi-label {
      font-size: 10.5px;
      color: #64748B;
      font-weight: 600;
      text-transform: uppercase;
      margin-top: 2px;
    }

    /* ── BADGES & PROGRESS ── */
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 700;
    }
    .progress-bar-bg {
      flex: 1;
      height: 8px;
      background-color: #E2E8F0;
      border-radius: 4px;
      overflow: hidden;
    }
    .progress-bar-fill {
      height: 100%;
      border-radius: 4px;
    }

    /* ── TABLE RESPONSIVE WRAPPER ── */
    .table-responsive {
      width: 100%;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      margin-bottom: 20px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    th {
      background-color: #F1F5F9;
      color: #475569;
      font-weight: 700;
      text-align: left;
      padding: 10px 10px;
      border-bottom: 2px solid #CBD5E1;
      font-size: 10.5px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      white-space: nowrap;
    }
    td {
      padding: 9px 10px;
      border-bottom: 1px solid #E2E8F0;
      vertical-align: middle;
    }
    tr:nth-child(even) {
      background-color: #F8FAFC;
    }

    /* ── FOOTER & SIGNATURE ── */
    .footer-section {
      margin-top: 30px;
      padding-top: 14px;
      border-top: 1px solid #E2E8F0;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
    }
    .academic-notice {
      font-size: 10.5px;
      color: #64748B;
      max-width: 60%;
      line-height: 1.4;
    }
    .signature-block {
      border: 1px dashed #CBD5E1;
      border-radius: 6px;
      padding: 10px 16px;
      text-align: center;
      min-width: 150px;
    }
    .signature-label {
      font-size: 9.5px;
      color: #64748B;
      font-weight: 600;
      text-transform: uppercase;
      margin-bottom: 24px;
    }
    .signature-line {
      font-size: 11px;
      color: #334155;
      font-weight: 600;
    }

    /* ── MOBILE PHONE RESPONSIVENESS ── */
    @media screen and (max-width: 640px) {
      body {
        padding: 6px 4px;
        background-color: #FFFFFF;
      }
      .report-sheet {
        padding: 14px 10px;
        box-shadow: none;
        border: none;
        border-radius: 0;
      }
      .header {
        flex-direction: column;
        gap: 8px;
        padding-bottom: 10px;
        margin-bottom: 14px;
      }
      .header-meta {
        text-align: left;
      }
      .brand-logo-text {
        font-size: 22px;
      }
      .doc-title-container {
        padding: 12px 14px;
        margin-bottom: 16px;
      }
      .doc-project-name {
        font-size: 16px;
      }
      .info-card {
        padding: 10px 12px;
      }
      .info-grid {
        grid-template-columns: 1fr;
        gap: 8px;
      }
      .kpi-row {
        gap: 8px;
      }
      .kpi-card {
        padding: 8px 6px;
      }
      .kpi-value {
        font-size: 17px;
      }
      .kpi-label {
        font-size: 9.5px;
      }
      .table-responsive {
        border: 1px solid #E2E8F0;
        border-radius: 6px;
      }
      table {
        min-width: 520px;
      }
      .footer-section {
        flex-direction: column;
        align-items: stretch;
        gap: 14px;
      }
      .academic-notice {
        max-width: 100%;
      }
      .signature-block {
        width: 100%;
        min-width: 0;
      }
    }

    @media print {
      body {
        background-color: #FFFFFF;
        padding: 0;
      }
      .report-sheet {
        box-shadow: none;
        border: none;
        padding: 0;
      }
      table {
        min-width: 100% !important;
      }
    }
  </style>
</head>
<body>
  <div class="report-sheet">
    <!-- 1. En-tête officiel -->
    <div class="header">
      <div>
        <div class="brand-logo-text">Site<span>X</span></div>
        <div class="brand-subtitle">Système Intégré de Suivi de Chantiers</div>
      </div>
      <div class="header-meta">
        <div><span class="ref-badge">${refCode}</span></div>
        <div><strong>Date d'édition :</strong> ${generationDate}</div>
        <div><strong>Système :</strong> SiteX Mobile Core v1.0</div>
      </div>
    </div>

    <!-- 2. Titre et Nom du projet -->
    <div class="doc-title-container">
      <div class="doc-type-label">Rapport de suivi du projet</div>
      <div class="doc-project-name">${project.nom}</div>
    </div>

    <!-- 3. Fiche d'identification du projet -->
    <div class="section-title">1. Identification & Informations Générales</div>
    <div class="info-card">
      <div class="info-grid">
        <div class="info-item">
          <span class="info-label">Statut du projet</span>
          <span class="info-value">
            <span class="badge" style="background-color: ${projectStatusStyle.bg}; color: ${projectStatusStyle.color}; border: 1px solid ${projectStatusStyle.border};">
              ${project.statut || 'En cours'}
            </span>
          </span>
        </div>

        <div class="info-item">
          <span class="info-label">Responsable</span>
          <span class="info-value">${responsable}</span>
        </div>

        <div class="info-item">
          <span class="info-label">Date de début</span>
          <span class="info-value">${formatFullFrenchDate(project.date_debut)}</span>
        </div>

        <div class="info-item">
          <span class="info-label">Date de fin prévue</span>
          <span class="info-value">${formatFullFrenchDate(project.date_fin)}</span>
        </div>
      </div>

      ${
        project.description
          ? `
          <div class="project-desc-box">
            <strong>Description du projet :</strong><br/>
            ${project.description}
          </div>
        `
          : ''
      }
    </div>

    <!-- 4. Synthèse Globale -->
    <div class="section-title">2. Synthèse d'avancement</div>
    <div class="kpi-row">
      <div class="kpi-card">
        <div class="kpi-value">${ind.nombreChantiers}</div>
        <div class="kpi-label">Nombre de Chantiers</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-value" style="color: #0284C7;">${ind.avancementGlobal}%</div>
        <div class="kpi-label">Avancement Global</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-value" style="color: #C2410C;">${ind.reclamations}</div>
        <div class="kpi-label">Réclamations actives</div>
      </div>
    </div>

    <!-- 5. Tableau des Chantiers -->
    <div class="section-title">3. Détail des Chantiers Associés (${chantiers.length})</div>
    <div class="table-responsive">
      <table>
        <thead>
          <tr>
            <th style="width: 28%;">Chantier</th>
            <th style="width: 16%;">Statut</th>
            <th style="width: 14%;">Surface</th>
            <th style="width: 22%;">Période</th>
            <th style="width: 20%;">Avancement</th>
          </tr>
        </thead>
        <tbody>
          ${chantiersRowsHtml}
        </tbody>
      </table>
    </div>

    <!-- 6. Pied de page académique et signature -->
    <div class="footer-section">
      <div class="academic-notice">
        Document généré automatiquement à partir de la base de données PostgreSQL de la plateforme SiteX.<br/>
        Certifié conforme aux relevés de terrain enregistrés.
      </div>

      <div class="signature-block">
        <div class="signature-label">Visa / Validation Direction</div>
        <div class="signature-line">SiteX Supervision</div>
      </div>
    </div>
  </div>
</body>
</html>
  `.trim();
}

export interface GeneratedPdfResult {
  uri: string;
  filename: string;
  html: string;
}

/**
 * Generates the local PDF file and returns its URI and metadata.
 */
export async function generateProjectPdfFile(
  project: ProjectDetails
): Promise<{ success: boolean; data?: GeneratedPdfResult; error?: string }> {
  try {
    const html = generateProjectReportHtml(project);
    const filename = getReportFileName(project.nom);

    if (Platform.OS === 'web') {
      return {
        success: true,
        data: { uri: '', filename, html },
      };
    }

    const { uri } = await Print.printToFileAsync({
      html,
      base64: false,
    });

    if (__DEV__) console.log('[ReportService] Generated PDF at:', uri);

    return {
      success: true,
      data: { uri, filename, html },
    };
  } catch (error: any) {
    console.error('[ReportService] Failed to generate PDF file:', error);
    return {
      success: false,
      error: error?.message || 'Impossible de générer le fichier PDF.',
    };
  }
}

/**
 * Downloads and saves the PDF to the device storage.
 * Handles Android StorageAccessFramework or document directory saving.
 */
export async function downloadAndSavePdf(
  pdfUri: string,
  filename: string,
  htmlContent?: string
): Promise<{ success: boolean; message: string; savedUri?: string }> {
  try {
    if (Platform.OS === 'web') {
      if (htmlContent) {
        await Print.printAsync({ html: htmlContent });
        return { success: true, message: 'La boîte d’impression / enregistrement PDF a été ouverte.' };
      }
      return { success: true, message: 'Téléchargement initié.' };
    }

    // Check if source file exists
    const fileInfo = await FileSystem.getInfoAsync(pdfUri);
    if (!fileInfo.exists) {
      throw new Error('Fichier PDF introuvable sur l’appareil.');
    }

    if (Platform.OS === 'android') {
      // On Android: Use StorageAccessFramework if available, or copy to document directory
      try {
        const permissions = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (permissions.granted) {
          const destinationUri = await FileSystem.StorageAccessFramework.createFileAsync(
            permissions.directoryUri,
            filename,
            'application/pdf'
          );
          const base64Data = await FileSystem.readAsStringAsync(pdfUri, {
            encoding: FileSystem.EncodingType.Base64,
          });
          await FileSystem.writeAsStringAsync(destinationUri, base64Data, {
            encoding: FileSystem.EncodingType.Base64,
          });

          return {
            success: true,
            message: `Rapport enregistré avec succès dans le dossier sélectionné (${filename}).`,
            savedUri: destinationUri,
          };
        }
      } catch (safErr) {
        if (__DEV__) console.log('[ReportService] SAF not available or cancelled, falling back to document directory:', safErr);
      }
    }

    // Standard fallback: Copy to FileSystem.documentDirectory
    const targetPath = `${FileSystem.documentDirectory}${filename}`;
    await FileSystem.copyAsync({
      from: pdfUri,
      to: targetPath,
    });

    return {
      success: true,
      message: `Rapport enregistré avec succès (${filename}).`,
      savedUri: targetPath,
    };
  } catch (error: any) {
    console.error('[ReportService] Save PDF error:', error);
    return {
      success: false,
      message: error?.message || 'Impossible d’enregistrer le PDF.',
    };
  }
}

/**
 * Shares the actual PDF file using the native Android/iOS system sheet.
 */
export async function sharePdfFile(
  pdfUri: string,
  filename: string
): Promise<{ success: boolean; error?: string }> {
  try {
    if (Platform.OS === 'web') {
      return { success: true };
    }

    const isAvailable = await Sharing.isAvailableAsync();
    if (!isAvailable) {
      return { success: false, error: 'Le partage de fichiers n’est pas disponible sur cet appareil.' };
    }

    await Sharing.shareAsync(pdfUri, {
      mimeType: 'application/pdf',
      dialogTitle: `Partager - ${filename}`,
      UTI: 'com.adobe.pdf',
    });

    return { success: true };
  } catch (error: any) {
    console.error('[ReportService] Share error:', error);
    return { success: false, error: error?.message || 'Erreur lors du partage du fichier.' };
  }
}
