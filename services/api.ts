import { Platform, NativeModules } from 'react-native';
import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system/legacy';

/**
 * Dynamic API URL resolver — priority order:
 *
 * 1. EXPO_PUBLIC_API_URL env variable (explicit override, highest priority)
 * 2. LAN IP extracted from Metro hostUri IF it looks like a real LAN IP (192.168.x.x / 10.x.x.x / 172.x.x.x)
 * 3. Hardcoded DEV_LAN_IP for development on physical devices
 * 4. Emulator / web localhost fallback
 *
 * NOTE: When using --tunnel, hostUri is a public ngrok hostname — we intentionally
 * SKIP that and fall through to DEV_LAN_IP so the backend is still reachable over LAN.
 *
 * YOUR MACHINE'S WI-FI IP: 10.61.129.155
 * Update DEV_LAN_IP below if your router assigns a different IP.
 */
const DEV_LAN_IP = '10.61.129.155';
const BACKEND_PORT = 5000;

/** Returns true only for reachable RFC-1918 private LAN addresses (excluding VirtualBox host-only network) */
function isPrivateLanIp(host: string): boolean {
  if (/^192\.168\.56\./.test(host)) return false;
  return (
    /^192\.168\./.test(host) ||
    /^10\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}

let cachedApiUrl: string | null = null;
let hasLoggedApiUrl = false;

export function resetApiUrlCache(): void {
  cachedApiUrl = null;
}

function resolveApiUrl(): string {
  // 1. WEB: Always use window.location hostname (or localhost) so web never breaks
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.location?.hostname) {
      const webHost = window.location.hostname;
      return `http://${webHost}:${BACKEND_PORT}`;
    }
    return `http://localhost:${BACKEND_PORT}`;
  }

  // 2. MOBILE: Extract host IP directly from bundle URL or Metro connection
  // Try NativeModules.SourceCode.scriptURL first — 100% reliable as it is the exact URL downloaded
  if (NativeModules?.SourceCode?.scriptURL) {
    const match = (NativeModules.SourceCode.scriptURL as string).match(/:\/\/([^:/]+)/);
    if (match && match[1] && isPrivateLanIp(match[1])) {
      return `http://${match[1]}:${BACKEND_PORT}`;
    }
  }

  const hostUri =
    Constants.expoConfig?.hostUri ||
    (Constants as any).manifest2?.launchAsset?.url ||
    (Constants as any).manifest?.debuggerHost ||
    (Constants as any).experienceUrl ||
    (Constants as any).linkingUri;

  if (hostUri) {
    const rawHost = hostUri.replace(/^https?:\/\//, '').replace(/^exp:\/\//, '');
    const host = rawHost.split(':')[0].split('/')[0];
    if (host && isPrivateLanIp(host)) {
      return `http://${host}:${BACKEND_PORT}`;
    }
  }

  // 3. Explicit env override (if specified)
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL;
  }

  // 4. Development physical device fallback
  if (__DEV__) {
    return `http://${DEV_LAN_IP}:${BACKEND_PORT}`;
  }

  // 5. Emulator default
  return Platform.select({
    android: `http://10.0.2.2:${BACKEND_PORT}`,
    default: `http://localhost:${BACKEND_PORT}`,
  }) as string;
}

function getApiUrl(): string {
  if (cachedApiUrl) {
    return cachedApiUrl;
  }
  cachedApiUrl = resolveApiUrl();
  if (__DEV__ && !hasLoggedApiUrl) {
    hasLoggedApiUrl = true;
    console.log('[API] Auto-detected Metro LAN IP:', cachedApiUrl);
  }
  return cachedApiUrl;
}

export const API_URL = getApiUrl();

export function getMediaUrl(relativeOrAbsolute?: string | null): string {
  if (!relativeOrAbsolute) return '';
  if (
    relativeOrAbsolute.startsWith('http://') ||
    relativeOrAbsolute.startsWith('https://') ||
    relativeOrAbsolute.startsWith('data:')
  ) {
    return relativeOrAbsolute;
  }
  const base = getApiUrl();
  const cleanPath = relativeOrAbsolute.startsWith('/') ? relativeOrAbsolute : `/${relativeOrAbsolute}`;
  return `${base}${cleanPath}`;
}

export interface RoleRequest {
  id: number;
  utilisateur_id: number;
  requested_role_id: number;
  statut: 'PENDING' | 'APPROVED' | 'REJECTED';
  date_demande: string;
  role_nom?: string;
  role_description?: string;
}

export interface DashboardProject {
  id: number;
  nom: string;
  description?: string;
  type_projet?: string | null;
  date_debut?: string;
  date_fin?: string;
  nombreChantiers: number;
  avancement: number;
  nouvellesImages: number;
  reclamations: number;
  derniereMiseAJour: string;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
  hasPrev: boolean;
}

export interface GetProjectsParams {
  page?: number;
  limit?: number;
  search?: string;
  statut?: string;
}

export interface GetProjectsResponse {
  projects: Project[];
  pagination?: PaginationMeta;
  statusCounts?: Record<string, number>;
}

export interface Project {
  id: number;
  nom: string;
  description?: string | null;
  type_projet?: string | null;
  cover_image_url?: string | null;
  date_debut?: string | null;
  date_fin?: string | null;
  statut?: string | null;
}

export interface ProjectChantier {
  id: number;
  projet_id: number;
  nom: string;
  statut: string;
  surface?: number | null;
  surface_reference?: number | null;
  d_max_position_meters?: number;
  date_debut?: string | null;
  date_fin_prevue?: string | null;
  date_creation?: string;
  avancement: number;
  avancement_date?: string | null;
  avancement_commentaire?: string | null;
  responsable_nom?: string | null;
  reference_alignment_id?: number | null;
  reference_alignment_nom?: string | null;
  direction_reversed?: boolean;
  length_km?: number | null;
  nombre_troncons?: number;
  gis_status?: 'NON_CONFIGURE' | 'ALIGNEMENT_IMPORTE' | 'PRET_POUR_SUIVI' | string;
  localisation?: any;
}

export interface ChantierImage {
  id: number;
  chantier_id: number;
  date_acquisition?: string | null;
  source?: string | null;
  type_image?: string | null;
  url_fichier?: string | null;
  resolution?: number | null;
  cloud_coverage?: number | null;
  indice_spectral?: string | null;
}

export interface ChantierAvancement {
  id: number;
  chantier_id: number;
  pourcentage: number;
  date: string;
  commentaire?: string | null;
}

export interface ChantierTroncon {
  id: number;
  nom: string;
  pk_debut?: number | null;
  pk_fin?: number | null;
  statut?: 'NON_COMMENCE' | 'EN_COURS' | 'TERMINE' | 'PROBLEME' | string;
  avancement?: number;
  length_meters?: number | null;
  length_km?: number | null;
  authoritative_progress_meters?: number | null;
  geometry?: any;
  date_creation?: string;
  agent_id?: number | null;
  agent_nom?: string | null;
  agent_prenom?: string | null;
  agent_nom_complet?: string | null;
  agent_photo_url?: string | null;
}

export interface ChantierAvancementTroncon {
  id: number;
  nom: string;
  code: string;
  pk_debut?: number | null;
  pk_fin?: number | null;
  statut: string;
  avancement: number;
  planned_meters: number;
  completed_meters: number;
  remaining_meters: number;
  length_km: number;
  agent_id?: number | null;
  agent_nom_complet?: string | null;
  agent_photo_url?: string | null;
  observations_count: number;
  latest_observation_date?: string | null;
}

export interface ChantierOperationalStats {
  jours_avec_releves: number;
  dernier_releve_date?: string | null;
  dernier_releve_label: string;
  nombre_total_observations: number;
  total_planned_meters: number;
  total_completed_meters: number;
  total_remaining_meters: number;
}

export interface ChantierDailyHistoryPoint {
  date: string;
  dayOfMonth: string;
  monthLabel: string;
  fullLabel: string;
  avancement: number;
  observations_count: number;
  is_synthetic_baseline: boolean;
}

export interface ChantierObservationHistoryItem {
  id: number;
  troncon_id: number;
  troncon_nom: string;
  troncon_code: string;
  agent_nom: string | null;
  date_heure: string;
  chainage?: string | number | null;
  progress_percentage: number;
  phase?: string | null;
  phase_statut?: string | null;
  commentaire?: string | null;
  agent_lat?: number | null;
  agent_lng?: number | null;
  projected_lat?: number | null;
  projected_lng?: number | null;
  distance_from_start?: number | null;
  photos: Array<{ id: number; url: string; description?: string | null }>;
}

export interface ChantierAvancementResponse {
  chantier: {
    id: number;
    nom: string;
    statut: string;
    date_debut?: string | null;
    date_fin_prevue?: string | null;
    date_creation: string;
    avancement: number;
  };
  troncons: ChantierAvancementTroncon[];
  stats: ChantierOperationalStats;
  historique: {
    timeline: ChantierDailyHistoryPoint[];
    observations: ChantierObservationHistoryItem[];
  };
}

export interface ChantierJournalTronconObservation {
  id: number;
  heure_str: string;
  progress_percentage: number;
  authoritative_progress_percentage: number;
  chainage?: number | null;
  phase?: string | null;
  phase_statut?: string | null;
  commentaire?: string | null;
  photo_count: number;
  agent_nom?: string | null;
}

export interface ChantierJournalTronconDay {
  troncon_id: number;
  nom: string;
  code: string;
  statut: 'RELEVE' | 'NON_TRAVAILLE' | 'ABSENCE_AGENT' | 'CHANTIER_ARRETE' | 'SANS_RELEVE' | 'A_VENIR' | string;
  statut_label: string;
  avancement: number;
  planned_meters: number;
  agent_id?: number | null;
  agent_nom?: string | null;
  agent_photo_url?: string | null;
  observations_count: number;
  derniere_heure?: string | null;
  max_progression_jour?: number | null;
  absence_info?: {
    id: number;
    motif: string;
    statut: string;
    date_debut: string;
    date_fin: string;
  } | null;
  demande_explication?: {
    id: number;
    statut: 'EN_ATTENTE' | 'REPONDUE' | 'ACCEPTEE' | 'REJETEE' | 'ANNULEE' | string;
    message_responsable?: string | null;
    motif_agent?: string | null;
    reponse_agent?: string | null;
    date_demande?: string | null;
    date_reponse?: string | null;
    responsable_nom?: string | null;
    agent_nom?: string | null;
  } | null;
  observations?: ChantierJournalTronconObservation[];
}

export interface ChantierJournalDay {
  date: string;
  day_of_month: number;
  day_of_week: number;
  day_label: string;
  is_today: boolean;
  is_future: boolean;
  is_prior_to_start: boolean;
  is_non_travaille: boolean;
  is_ferie: boolean;
  ferie_nom?: string | null;
  statut_jour: 'ACTIVITE' | 'ACTIVITE_PARTIELLE' | 'NON_TRAVAILLE' | 'ABSENCE' | 'CHANTIER_ARRETE' | 'INACTIVITE_A_VERIFIER' | 'A_VENIR' | string;
  statut_jour_label: string;
  consolidated_progress: number;
  observations_count: number;
  troncons: ChantierJournalTronconDay[];
}

export interface ChantierJournalResponse {
  chantier: {
    id: number;
    nom: string;
    statut: string;
    date_debut?: string | null;
    date_fin_prevue?: string | null;
  };
  month: string;
  troncons_count: number;
  summary: {
    total_jours_calendrier: number;
    jours_travailles_passes: number;
    jours_avec_activite: number;
    jours_sans_releve: number;
    jours_feries_chomes: number;
    jours_absence_agent: number;
    demandes_en_attente: number;
  };
  days: ChantierJournalDay[];
}

export interface DemandeExplicationPayload {
  troncon_id: number;
  date_concernee: string;
  message: string;
}

export interface ReponseExplicationPayload {
  motif: string;
  reponse: string;
}

export interface AgentAbsenceItem {
  id: number;
  agent_id: number;
  date_debut: string;
  date_fin: string;
  motif: string;
  statut: 'EN_ATTENTE' | 'VALIDE' | 'REFUSE' | string;
  justificatif_url?: string | null;
  commentaire_traitement?: string | null;
  date_creation: string;
  agent_nom?: string | null;
}

export interface ChantierDetails {

  id: number;
  projet_id: number;
  responsable_id?: number | null;
  nom: string;
  statut: string;
  surface?: number | null;
  surface_reference?: number | null;
  d_max_position_meters?: number;
  date_debut?: string | null;
  date_fin_prevue?: string | null;
  date_creation?: string | null;
  projet_nom?: string | null;
  projet_description?: string | null;
  projet_type?: string | null;
  responsable_nom?: string | null;
  avancement: number;
  avancement_date?: string | null;
  avancement_commentaire?: string | null;
  pk_debut?: string | number | null;
  pk_fin?: string | number | null;
  gis_status?: 'NON_CONFIGURE' | 'ALIGNEMENT_IMPORTE' | 'PRET_POUR_SUIVI' | string;
  localisation?: any;
  reference_alignment?: ReferenceAlignment | null;
  avancements?: ChantierAvancement[];
  images?: ChantierImage[];
  troncons?: ChantierTroncon[];
}

export interface ProjectIndicators {
  nombreChantiers: number;
  avancementGlobal: number;
  imagesSatellite: number;
  reclamations: number;
  derniereMiseAJour?: string | null;
}

export interface ProjectDetails extends Project {
  indicateurs: ProjectIndicators;
  chantiers: ProjectChantier[];
}

export interface User {
  id: number;
  role_id: number;
  role_nom?: string;
  role_description?: string;
  nom: string;
  prenom: string;
  email: string;
  actif: boolean;
  date_creation?: string;
  date_naissance?: string;
  photo_url?: string;
  telephone?: string;
  adresse?: string;
  ville?: string;
  profession?: string;
  entreprise?: string;
  poste?: string;
  numero_pro?: string;
  ville_pro?: string;
  region_pro?: string;
  adresse_pro?: string;
  latitude?: number | null;
  longitude?: number | null;
  code_postal?: string;
  pays?: string;
  latitude_pro?: number | null;
  longitude_pro?: number | null;
  pays_pro?: string;
  role_request?: RoleRequest | null;
}

export interface AdminRoleRequest {
  id: number;
  utilisateur_id: number;
  requested_role_id: number;
  statut: 'PENDING' | 'APPROVED' | 'REJECTED';
  date_demande: string;
  date_traitement?: string | null;
  traite_par?: number | null;
  applicant_nom: string;
  applicant_prenom: string;
  applicant_email: string;
  applicant_photo?: string | null;
  applicant_telephone?: string | null;
  applicant_entreprise?: string | null;
  applicant_poste?: string | null;
  applicant_ville?: string | null;
  applicant_adresse?: string | null;
  applicant_date_creation?: string;
  current_role_nom?: string | null;
  requested_role_nom: string;
  requested_role_description?: string | null;
  admin_nom?: string | null;
  admin_prenom?: string | null;
}

export interface AdminStats {
  pendingRequests: number;
  totalUsers: number;
  roles: { id: number; nom: string; user_count: number }[];
}

export interface AuthResponse {
  token: string;
  refreshToken?: string;
  user: User;
}

export interface RegisterPayload {
  nom: string;
  prenom: string;
  email: string;
  mot_de_passe: string;
}

export interface LoginPayload {
  email: string;
  mot_de_passe: string;
}

export interface UpdateProfilePayload {
  nom?: string;
  prenom?: string;
  email?: string;
  date_naissance?: string;
  photo_url?: string;
  telephone?: string;
  adresse?: string;
  ville?: string;
  profession?: string;
  entreprise?: string;
  poste?: string;
  numero_pro?: string;
  ville_pro?: string;
  region_pro?: string;
  adresse_pro?: string;
  latitude?: number | null;
  longitude?: number | null;
  code_postal?: string;
  pays?: string;
  latitude_pro?: number | null;
  longitude_pro?: number | null;
  pays_pro?: string;
}

export interface ChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
}

export interface CreateProjectPayload {
  nom: string;
  description?: string;
  type_projet?: string;
  date_debut?: string;
  date_fin?: string;
  statut?: string;
  nombre_chantiers?: number;
}

export interface CreateChantierPayload {
  nom: string;
  surface_reference?: number;
  surface?: number;
  date_debut?: string;
  date_fin_prevue?: string;
  statut?: string;
  localisation?: any;
  d_max_position_meters?: number;
}

export interface SupportedCrs {
  srid: number;
  code: string;
  name: string;
  zone_label?: string;
  type: 'geographic' | 'projected' | string;
  unit: string;
  description: string;
}

export interface CrsDetectionInfo {
  detected_srid: number | null;
  crs_name: string;
  epsg_code: string | null;
  confidence: 'HIGH' | 'MEDIUM' | 'UNCERTAIN' | 'NONE';
  unit: string;
  type: string;
  explanation: string;
  is_ambiguous: boolean;
  candidates: SupportedCrs[];
  raw_bounds?: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    samplePointsCount: number;
  };
}

export interface KmlLatLonBox {
  north: number;
  south: number;
  east: number;
  west: number;
  rotation?: number;
}

export interface KmlGroundOverlay {
  id: string;
  type: 'GroundOverlay';
  name: string | null;
  description: string | null;
  folders: string[];
  icon: {
    href: string;
    refreshMode?: string | null;
    refreshInterval?: number | null;
    viewBoundScale?: number | null;
  };
  latLonBox: KmlLatLonBox | null;
  color?: string | null;
  opacity: number;
  drawOrder: number;
  isRemote: boolean;
  isSafe: boolean;
  isAvailable: boolean;
  securityWarning?: string | null;
}

export interface KmlPhotoOverlay {
  id: string;
  type: 'PhotoOverlay';
  name: string | null;
  description: string | null;
  folders: string[];
  icon: {
    href: string;
  };
  position: [number, number] | null; // [longitude, latitude]
  altitude?: number | null;
  heading?: number | null;
  tilt?: number | null;
  roll?: number | null;
  shape?: string | null;
  viewVolume?: {
    leftFov?: number | null;
    rightFov?: number | null;
    bottomFov?: number | null;
    topFov?: number | null;
    near?: number | null;
  } | null;
  isRemote: boolean;
  isSafe: boolean;
  isAvailable: boolean;
  securityWarning?: string | null;
}

export interface KmlMetadata {
  name: string;
  description?: string | null;
  folders?: string[];
  styleUrl?: string | null;
  styles?: {
    styleUrl?: string | null;
    line?: { color?: string | null; width?: number | null } | null;
    styleMap?: { id?: string; pairs?: Array<{ key: string; styleUrl: string }> } | null;
    definedStylesCount?: number;
    definedStyleMapsCount?: number;
  } | null;
  extendedData?: Record<string, string>;
  time?: {
    type: 'timestamp' | 'timespan';
    when?: string;
    begin?: string;
    end?: string;
  } | null;
  documentName?: string | null;
  generator?: string | null;
  groundOverlays?: KmlGroundOverlay[];
  photoOverlays?: KmlPhotoOverlay[];
  altitudeCoordinates?: Array<[number, number, number]> | null;
  hasAltitude?: boolean;
  altitudeRange?: { min: number; max: number } | null;
}

export interface CrsDetectionResponse extends CrsDetectionInfo {
  message?: string;
  supported_crs: SupportedCrs[];
  normalized_geojson?: any;
  source_format?: string;
  source_crs?: string;
  kml_metadata?: KmlMetadata | null;
}

export interface ReferenceAlignment {
  id: number;
  chantier_id: number;
  nom: string;
  source: string;
  original_filename?: string;
  direction_reversed?: boolean;
  source_srid?: number;
  source_crs_name?: string;
  date_import?: string;
  length_meters?: number;
  length_km?: number;
  geometry: any;
  original_geometry?: any;
  kml_metadata?: KmlMetadata | null;
}

export interface GeoJSONCandidateCorridor {
  id: number;
  nom: string;
  length_km: number;
  length_meters: number;
  points_count: number;
  start_point: [number, number];
  end_point: [number, number];
  intersects_aoi?: boolean;
  length_in_aoi_km?: number;
  length_in_aoi_meters?: number;
  coverage_aoi_percent?: number;
  distance_to_aoi_meters?: number;
  is_recommended?: boolean;
  status?: 'RECOMMANDE' | 'PERTINENT' | 'HORS_ZONE' | 'DISPONIBLE' | string;
  recommendation_reason?: string;
  geometry: any;
}

export interface GeoJSONAnalysisResponse {
  message: string;
  original_filename: string;
  total_features: number;
  is_single_continuous: boolean;
  total_network_km: number;
  total_network_meters: number;
  has_aoi?: boolean;
  aoi_geometry?: any;
  aoi_surface_m2?: number;
  aoi_surface_hectares?: number;
  corridors_count: number;
  candidate_corridors: GeoJSONCandidateCorridor[];
  selected_alignment_geometry?: any;
  selected_alignment_length_km?: number;
  crs_info?: CrsDetectionInfo;
  source_srid?: number;
  source_format?: string;
  kml_metadata?: KmlMetadata | null;
}

export interface AoiConflictItem {
  chantierId: number;
  chantierName: string;
  overlapAreaM2: number;
}

export interface AoiConflictCheckResponse {
  conflict: boolean;
  conflicts: AoiConflictItem[];
  message?: string;
}

export interface SiblingChantierAoiItem {
  id: number;
  nom: string;
  geometry: any;
  surface_m2?: number;
}

export interface TronconItem {
  id?: number;
  step?: number;
  chantier_id?: number;
  reference_alignment_id?: number;
  nom: string;
  pk_debut: number;
  pk_fin: number;
  statut?: 'NON_COMMENCE' | 'EN_COURS' | 'TERMINE' | 'PROBLEME' | string;
  avancement?: number;
  length_meters?: number;
  length_km?: number;
  geometry: any;
  start_lat?: number;
  start_lng?: number;
  end_lat?: number;
  end_lng?: number;
}

export interface GenerateTronconsResponse {
  reference_alignment_id: number;
  direction_reversed?: boolean;
  total_length_meters: number;
  total_length_km: number;
  aoi_constrained?: boolean;
  aoi_pk_start?: number;
  aoi_pk_end?: number;
  aoi_length_km?: number;
  aoi_length_meters?: number;
  count: number;
  average_length_km: number;
  troncons: TronconItem[];
}
export interface ChantierStatusDistribution {
  statut: string;
  count: number;
  percentage: number;
  color: string;
}

export interface ResponsableDashboardStats {
  totalProjects: number;
  projectsEnCours?: number;
  projectsTermines?: number;
  totalChantiers: number;
  chantiersEnCours?: number;
  chantiersEnAttente?: number;
  chantiersTermines?: number;
  chantiersPrets: number;
  avancementMoyen: number;
  totalObservations: number;
  totalReclamations: number;
  totalAlerts?: number;
  chantiersDistribution?: ChantierStatusDistribution[];
  equipeTerrain?: {
    totalAvailable: number;
    totalAssigned: number;
    totalAssignments: number;
    totalUnassigned: number;
  };
}

export interface ResponsableDashboardAlert {
  id: string;
  type: 'GIS_NON_CONFIGURE' | 'AUCUN_TRONCON' | 'PROJET_SANS_CHANTIER' | 'EXPLICATION_EN_ATTENTE' | 'RECLAMATION' | string;
  category?: 'GIS' | 'TRONCON' | 'PROJET' | 'AT' | 'RECLAMATION' | string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  title?: string;
  chantierId?: number;
  chantierNom?: string;
  tronconId?: number;
  tronconNom?: string;
  projectId?: number;
  projetNom?: string;
  message: string;
  actionLabel?: string;
  actionRoute?: string;
}

export interface ResponsableProjectItem {
  id: number;
  nom: string;
  description?: string | null;
  type_projet?: string | null;
  cover_image_url?: string | null;
  date_debut?: string | null;
  date_fin?: string | null;
  statut?: string | null;
  nombre_chantiers: number;
  avancement_moyen: number;
  total_km?: string | number;
  agents_count?: number;
  image_url?: string | null;
  derniere_activite?: string | null;
}

export interface ResponsableChantierItem extends ProjectChantier {
  projet_nom: string;
  projet_type?: string | null;
}

export interface DashboardClientItem {
  id: number;
  nom: string;
  prenom: string;
  email: string;
  entreprise?: string;
}

export interface ResponsableDashboardData {
  stats: ResponsableDashboardStats;
  projects: ResponsableProjectItem[];
  chantiers: ResponsableChantierItem[];
  observations: any[];
  reclamations: any[];
  explications?: any[];
  clients?: DashboardClientItem[];
  alerts?: ResponsableDashboardAlert[];
}

export interface AssignedAgentItem {
  affectation_id: number;
  troncon_id?: number;
  agent_id: number;
  nom: string;
  prenom: string;
  email: string;
  telephone?: string;
  photo_url?: string;
  profession?: string;
  entreprise?: string;
  poste?: string;
  date_affectation: string;
  statut: string;
  notes?: string;
  affecte_par_nom?: string;
}

export interface AvailableAgentItem {
  id: number;
  nom: string;
  prenom: string;
  email: string;
  telephone?: string;
  photo_url?: string;
  profession?: string;
  entreprise?: string;
  poste?: string;
}

export interface EquipeTerrainStats {
  totalAvailable: number;
  totalAssigned: number;
  totalAssignments: number;
  totalUnassigned: number;
}

export interface EquipeAgentAffectation {
  affectation_id: number;
  troncon_id: number;
  troncon_nom: string;
  pk_debut: number;
  pk_fin: number;
  chantier_id: number;
  chantier_nom: string;
  projet_id: number;
  projet_nom: string;
  date_affectation: string;
  notes?: string;
  statut: string;
}

export interface EquipeAgentItem {
  id: number;
  nom: string;
  prenom: string;
  email: string;
  telephone?: string;
  photo_url?: string;
  profession?: string;
  entreprise?: string;
  poste?: string;
  actif: boolean;
  date_creation: string;
  assignments_count: number;
  projects_count: number;
  chantiers_count: number;
  affectations: EquipeAgentAffectation[];
}

export interface EquipeTerrainResponse {
  stats: EquipeTerrainStats;
  agents: EquipeAgentItem[];
}

export interface HierarchyTronconItem {
  id: number;
  nom: string;
  pk_debut: number;
  pk_fin: number;
  length_km: number;
  statut: string;
}

export interface HierarchyChantierItem {
  id: number;
  nom: string;
  troncons: HierarchyTronconItem[];
}

export interface HierarchyProjectItem {
  id: number;
  nom: string;
  type_projet?: string;
  chantiers: HierarchyChantierItem[];
}

export interface HierarchyTreeResponse {
  projects: HierarchyProjectItem[];
}

export interface CreateAffectationPayload {
  agent_id: number;
  projet_id?: number;
  chantier_id?: number;
  troncon_id: number;
  notes?: string;
  reassign?: boolean;
  replace_current?: boolean;
}

export interface AgentAssignmentItem {
  affectation_id: number;
  date_affectation: string;
  affectation_statut: string;
  affectation_notes?: string;
  troncon_id: number;
  troncon_nom: string;
  pk_debut: number;
  pk_fin: number;
  troncon_statut: string;
  troncon_avancement: number;
  length_km: number;
  length_meters: number;
  geometry: any;
  chantier_id: number;
  chantier_nom: string;
  projet_id: number;
  projet_nom: string;
  type_projet?: string;
  responsable_nom?: string;
  responsable_telephone?: string;
  responsable_email?: string;
}

export interface AgentDashboardStats {
  totalAssignments: number;
  totalProjects: number;
  totalKmAssigned: number;
  avancementMoyen: number;
}

export interface AgentDashboardResponse {
  stats: AgentDashboardStats;
  affectations: AgentAssignmentItem[];
}

export interface SpatialProjectionPreview {
  troncon_id: number;
  chantier_id: number;
  troncon_nom: string;
  pk_debut: number;
  pk_fin: number;
  measurement_crs: {
    srid: number;
    code: string;
    name: string;
    unit: string;
  };
  agent_location: {
    latitude: number;
    longitude: number;
    accuracy?: number | null;
  };
  projected_location: {
    latitude: number;
    longitude: number;
  };
  distance_from_start_meters: number;
  distance_from_start_km: number;
  total_length_meters: number;
  total_length_km: number;
  fraction: number;
  progress_percentage: number;
  daily_progress_meters?: number;
  daily_progress_percentage?: number;
  authoritative_progress_meters?: number;
  authoritative_progress_percentage?: number;
  calculated_pk: number;
  offset_distance_meters: number;
  d_max_position_meters: number;
  proximity_status: 'normal' | 'exceptional_confirmation_required';
  requires_exceptional_confirmation: boolean;
}

export interface TerrainObservationPhoto {
  id: number;
  url: string;
  date_prise?: string;
  description?: string;
}

export interface TerrainObservationItem {
  id: number;
  chantier_id?: number;
  troncon_id: number;
  agent_id: number;
  agent_nom?: string;
  date_heure: string;
  agent_lat: number;
  agent_lng: number;
  projected_lat: number;
  projected_lng: number;
  distance_from_start: number;
  progress_percentage: number;
  daily_progress_meters?: number;
  daily_progress_percentage?: number;
  authoritative_progress_meters?: number;
  authoritative_progress_percentage?: number;
  chainage?: number;
  accuracy?: number;
  distance_offset?: number;
  validation_status?: 'normal' | 'exceptional';
  phase?: string;
  phase_statut?: string;
  statut?: string;
  type_observation?: string;
  commentaire?: string;
  photos?: TerrainObservationPhoto[];
}

export interface CreateObservationPayload {
  latitude: number;
  longitude: number;
  accuracy?: number;
  phase?: string;
  phase_statut?: string;
  commentaire?: string;
  type_observation?: string;
  photos?: string[];
  exceptional_confirmation?: boolean;
}

export interface InAppNotification {
  id: number;
  titre: string;
  message?: string;
  type?: string;
  related_entity_type?: string | null;
  related_entity_id?: number | null;
  metadata?: { chantier_id?: number; [key: string]: unknown };
  is_read: boolean;
  created_at: string;
  read_at?: string | null;
}

export interface AgentTronconDetailsResponse {
  troncon: {
    id: number;
    nom: string;
    chantier_id: number;
    chantier_nom: string;
    projet_id: number;
    projet_nom: string;
    type_projet?: string;
    pk_debut: number;
    pk_fin: number;
    length_km: number;
    length_meters: number;
    statut: string;
    avancement: number;
    start_lat?: number;
    start_lng?: number;
    end_lat?: number;
    end_lng?: number;
    geometry: any;
    reference_alignment_nom?: string;
    direction_reversed?: boolean;
    responsable_nom?: string;
    responsable_telephone?: string;
    responsable_email?: string;
    affectation?: {
      id: number;
      date_affectation: string;
      statut: string;
      notes?: string;
    };
    latest_observation?: TerrainObservationItem | null;
  };
  siblings: TronconItem[];
  observations?: TerrainObservationItem[];
}

export interface TronconDetailsResponse {
  troncon: TronconItem & {
    chantier_nom: string;
    projet_id: number;
    projet_nom: string;
    projet_type?: string;
    reference_alignment_nom?: string;
    direction_reversed?: boolean;
    observations_count: number;
    anomalies_count: number;
    latest_observation?: TerrainObservationItem | null;
    assigned_agents?: AssignedAgentItem[];
  };
  siblings: TronconItem[];
  observations: TerrainObservationItem[];
  assigned_agents?: AssignedAgentItem[];
}

// ─── Level 6: Spatio-Temporal Timeline Types ─────────────────────────────────

export interface TimelineEventPhoto {
  id: number;
  url: string;
  description?: string | null;
  date_prise?: string | null;
}

/**
 * A single chronological event produced by GET /chantiers/:id/timeline.
 * Each event corresponds to a field observation (observation_terrain row).
 */
export interface TimelineEvent {
  id: string; // e.g. "obs-42"
  type: 'observation';
  date: string;        // ISO 8601 datetime string  e.g. "2026-03-14T09:32:00Z"
  dateDay: string;     // YYYY-MM-DD   e.g. "2026-03-14"
  observationId: number;
  tronconId: number | null;
  tronconNom: string | null;
  rawProgress: number;               // 0-100 raw % at time of observation
  authoritativeProgress: number;     // 0-100 non-regressive tronçon %
  chantierProgress: number;          // 0-100 aggregated chantier %
  coordinates: { lat: number; lng: number } | null;
  agentNom: string | null;
  phase?: string | null;
  phaseStatut?: string | null;
  remarques?: string | null;
  photos: TimelineEventPhoto[];
}

/**
 * A snapshot of chantier progress at a given moment in time.
 * Used to draw the non-regressive progress chart.
 */
export interface TimelineProgressSnapshot {
  date: string;         // YYYY-MM-DD
  dateTime: string;     // ISO 8601
  rawChantierProgress: number;           // 0-100 raw
  authoritativeChantierProgress: number; // 0-100 strictly non-regressive
  tronconsProgress: Record<number, number>; // tronconId → non-regressive %
  observationsCount: number;
  photosCount: number;
  isBaseline?: boolean;
}

/**
 * A tronçon summary as returned in the timeline (geometry included for replay).
 */
export interface TimelineTroncon {
  id: number;
  nom: string;
  pk_debut: number;
  pk_fin: number;
  length_km?: number | null;
  current_avancement: number;
  geometry?: any;
}

/**
 * Full response of GET /chantiers/:chantierId/timeline  (Level 6)
 */
export interface ChantierTimelineResponse {
  chantierId: number;
  chantierNom: string;
  dateDebut: string | null;
  dateFinPrevue: string | null;
  troncons: TimelineTroncon[];
  events: TimelineEvent[];
  progressHistory: TimelineProgressSnapshot[];
  temporalBounds: {
    minDate: string | null;
    maxDate: string | null;
  };
}

// ─── End Level 6 Types ───────────────────────────────────────────────────────

class ApiClient {
  private currentToken: string | null = null;
  private currentRefreshToken: string | null = null;
  private refreshPromise: Promise<AuthResponse | null> | null = null;
  private onTokenRefreshedListeners: Array<(token: string, refreshToken?: string, user?: User) => void> = [];
  private onSessionExpiredListeners: Array<() => void> = [];

  get baseUrl(): string {
    return getApiUrl();
  }

  constructor(initialBaseUrl?: string) {}

  public setTokens(token: string | null, refreshToken: string | null): void {
    this.currentToken = token;
    this.currentRefreshToken = refreshToken;
  }

  public addTokenRefreshedListener(cb: (token: string, refreshToken?: string, user?: User) => void): () => void {
    this.onTokenRefreshedListeners.push(cb);
    return () => {
      this.onTokenRefreshedListeners = this.onTokenRefreshedListeners.filter((l) => l !== cb);
    };
  }

  public addSessionExpiredListener(cb: () => void): () => void {
    this.onSessionExpiredListeners.push(cb);
    return () => {
      this.onSessionExpiredListeners = this.onSessionExpiredListeners.filter((l) => l !== cb);
    };
  }

  private notifyTokenRefreshed(token: string, refreshToken?: string, user?: User): void {
    this.onTokenRefreshedListeners.forEach((listener) => {
      try {
        listener(token, refreshToken, user);
      } catch (e) {
        console.warn('[API] Listener error on token refreshed:', e);
      }
    });
  }

  private notifySessionExpired(): void {
    this.onSessionExpiredListeners.forEach((listener) => {
      try {
        listener();
      } catch (e) {
        console.warn('[API] Listener error on session expired:', e);
      }
    });
  }

  public async refreshAuthSession(refreshToken?: string, oldToken?: string): Promise<AuthResponse> {
    const candidateRefresh = refreshToken || this.currentRefreshToken;
    const candidateAccess = oldToken || this.currentToken;

    const url = `${this.baseUrl}/auth/refresh`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'bypass-tunnel-reminder': 'true',
        'ngrok-skip-browser-warning': 'true',
        ...(candidateAccess ? { Authorization: `Bearer ${candidateAccess}` } : {}),
      },
      body: JSON.stringify({
        refreshToken: candidateRefresh || undefined,
        token: candidateAccess || undefined,
      }),
    });

    const text = await response.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Réponse inattendue lors du rafraîchissement (${response.status})`);
    }

    if (!response.ok) {
      const err: any = new Error(data.message || 'Impossible de rafraîchir la session');
      err.status = response.status;
      err.code = data?.code;
      throw err;
    }

    this.currentToken = data.token;
    if (data.refreshToken) {
      this.currentRefreshToken = data.refreshToken;
    }
    this.notifyTokenRefreshed(data.token, data.refreshToken, data.user);
    return data as AuthResponse;
  }

  private async performTokenRefresh(): Promise<AuthResponse | null> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
      try {
        if (__DEV__) console.log('[API] Auto-refreshing session token...');
        const res = await this.refreshAuthSession();
        return res;
      } catch (err: any) {
        if (__DEV__) console.log('[API] Token auto-refresh failed:', err?.message);
        return null;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}, retryCount = 0): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      // Attempt to bypass localtunnel's "click to continue" interstitial page
      'bypass-tunnel-reminder': 'true',
      'ngrok-skip-browser-warning': 'true',
      ...(options.headers as Record<string, string>),
    };

    // If Authorization header was not explicitly set but ApiClient has an active token, provide it
    if (!headers.Authorization && !headers.authorization && this.currentToken) {
      headers.Authorization = `Bearer ${this.currentToken}`;
    }

    const timeoutMs = (options as any).timeoutMs ?? 10000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      // Read as text first — response.json() crashes with a cryptic error when
      // a tunnel proxy (localtunnel, ngrok) returns an HTML interstitial page
      const text = await response.text();

      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        // Non-JSON body — likely a tunnel interstitial or proxy error page
        const preview = text.slice(0, 120).trim();
        if (__DEV__) {
          console.warn(`[API] Non-JSON response from ${url}:`, preview);
        }
        if (
          preview.toLowerCase().includes('localtunnel') ||
          preview.toLowerCase().includes('loca.lt') ||
          preview.toLowerCase().includes('ngrok') ||
          preview.toLowerCase().includes('tunnel') ||
          preview.startsWith('<')
        ) {
          throw new Error(
            `Le tunnel proxy a intercepté la requête. Ouvrez ${this.baseUrl} dans votre navigateur, cliquez "Continue", puis réessayez.`
          );
        }
        throw new Error(`Réponse inattendue du serveur : ${preview}`);
      }

      if (!response.ok) {
        // Intercept expired / invalid token errors (HTTP 401 or HTTP 403 with expired message)
        const isAuthExpired =
          (response.status === 401 && (data?.code === 'TOKEN_EXPIRED' || data?.code === 'TOKEN_INVALID' || data?.message?.includes('expiré') || data?.message?.includes('invalide'))) ||
          (response.status === 403 && (data?.message?.includes('Token invalide ou expiré') || data?.message?.includes('expiré')));

        if (
          isAuthExpired &&
          !endpoint.startsWith('/auth/login') &&
          !endpoint.startsWith('/auth/refresh') &&
          retryCount === 0
        ) {
          const refreshed = await this.performTokenRefresh();
          if (refreshed && refreshed.token) {
            // Update Authorization header with the fresh token and retry the exact same request
            const retryHeaders = {
              ...headers,
              Authorization: `Bearer ${refreshed.token}`,
            };
            return this.request<T>(endpoint, { ...options, headers: retryHeaders }, retryCount + 1);
          } else {
            this.notifySessionExpired();
          }
        }

        const error: any = new Error(data.message || data.error || `Erreur HTTP ${response.status}`);
        error.status = response.status;
        error.data = data;
        error.code = data?.code;
        throw error;
      }

      return data as T;
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError' || err.message?.includes('aborted')) {
        throw new Error(
          `Délai d'attente dépassé (${Math.round(timeoutMs / 1000)}s) pour contacter le serveur (${this.baseUrl}). Vérifiez que le serveur Node.js est accessible.`
        );
      }
      if (
        err.message === 'Network request failed' ||
        err.message?.includes('fetch failed') ||
        err.message?.includes('Failed to fetch')
      ) {
        throw new Error(
          `Impossible de contacter le serveur (${this.baseUrl}). Vérifiez que le serveur Node.js tourne et que le tunnel est actif.`
        );
      }
      throw err;
    }
  }

  async login(payload: LoginPayload): Promise<AuthResponse> {
    const res = await this.request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    this.setTokens(res.token, res.refreshToken || null);
    return res;
  }

  async register(payload: RegisterPayload): Promise<AuthResponse> {
    const res = await this.request<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    this.setTokens(res.token, res.refreshToken || null);
    return res;
  }

  async getCurrentUser(token: string): Promise<User> {
    return this.request<User>('/users/me', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  }

  async updateProfile(token: string, payload: UpdateProfilePayload): Promise<User> {
    const response = await this.request<{ user: User }>('/users/me', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    return response.user;
  }

  async changePassword(token: string, payload: ChangePasswordPayload): Promise<{ message: string }> {
    return this.request<{ message: string }>('/users/me/password', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
  }

  async uploadPhoto(token: string, imageUri: string): Promise<User> {
    // 1. If imageUri is already a base64 data URI, send clean JSON
    if (imageUri.startsWith('data:') || (imageUri.length > 500 && !imageUri.startsWith('http') && !imageUri.startsWith('file:'))) {
      const res = await this.request<{ photo_url?: string; user: User }>('/users/me/photo', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ imageBase64: imageUri }),
      });
      return res.user;
    }

    // 2. Try FormData multipart upload
    try {
      const formData = new FormData();
      const cleanFilename = imageUri.split('/').pop()?.split('?')[0] || 'photo.jpg';
      const fileNameToUse = cleanFilename.includes('.') ? cleanFilename : 'photo.jpg';
      const match = /\.(\w+)$/.exec(fileNameToUse);
      const ext = match ? match[1].toLowerCase() : 'jpg';
      const type = `image/${ext === 'jpg' ? 'jpeg' : ext}`;

      if (Platform.OS === 'web') {
        const res = await fetch(imageUri);
        const blob = await res.blob();
        formData.append('photo', blob, fileNameToUse);
      } else {
        formData.append('photo', {
          uri: imageUri,
          name: fileNameToUse,
          type,
        } as any);
      }

      const url = `${this.baseUrl}/users/me/photo`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      const text = await response.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Erreur serveur (${response.status})`);
      }

      if (!response.ok) {
        throw new Error(data.message || data.error || `Erreur HTTP ${response.status}`);
      }

      return data.user as User;
    } catch (formErr: any) {
      // 3. Fallback: on Web, if multipart failed, read as DataURL base64 and send JSON
      if (Platform.OS === 'web') {
        try {
          const res = await fetch(imageUri);
          const blob = await res.blob();
          const base64Data = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          const resJson = await this.request<{ photo_url?: string; user: User }>('/users/me/photo', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ imageBase64: base64Data }),
          });
          return resJson.user;
        } catch {
          throw formErr;
        }
      }
      throw formErr;
    }
  }

  async deletePhoto(token: string): Promise<User> {
    const response = await this.request<{ message: string; user: User }>('/users/me/photo', {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    return response.user;
  }

  async submitRoleRequest(token: string, roleId: number): Promise<{ message: string; role_request: RoleRequest }> {
    return this.request<{ message: string; role_request: RoleRequest }>('/users/me/role-request', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ role_id: roleId }),
    });
  }

  async getRoleRequest(token: string): Promise<{ role_request: RoleRequest | null }> {
    return this.request<{ role_request: RoleRequest | null }>('/users/me/role-request', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  }

  async getDashboardProject(token: string): Promise<{ project: DashboardProject | null }> {
    return this.request<{ project: DashboardProject | null }>('/dashboard/project', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  }

  async getProjects(token: string, params?: GetProjectsParams): Promise<GetProjectsResponse> {
    let query = '';
    if (params) {
      const qParts: string[] = [];
      if (params.page !== undefined) qParts.push(`page=${encodeURIComponent(params.page)}`);
      if (params.limit !== undefined) qParts.push(`limit=${encodeURIComponent(params.limit)}`);
      if (params.search) qParts.push(`search=${encodeURIComponent(params.search)}`);
      if (params.statut && params.statut !== 'Tous') qParts.push(`statut=${encodeURIComponent(params.statut)}`);
      if (qParts.length > 0) query = `?${qParts.join('&')}`;
    }

    return this.request<GetProjectsResponse>(`/projects${query}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  }

  async getProjectDetails(token: string, id: number | string): Promise<{ project: ProjectDetails }> {
    return this.request<{ project: ProjectDetails }>(`/projects/${id}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  }

  async uploadProjectCover(
    token: string,
    projectId: number | string,
    imageUri: string
  ): Promise<{ message: string; cover_image_url: string; project_id: number }> {
    // 1. If imageUri is already a base64 data URI or raw base64, send clean JSON
    if (
      imageUri.startsWith('data:') ||
      (imageUri.length > 500 && !imageUri.startsWith('http') && !imageUri.startsWith('file:') && !imageUri.startsWith('content:'))
    ) {
      const base64Payload = imageUri.startsWith('data:') ? imageUri : `data:image/jpeg;base64,${imageUri}`;
      return this.request<{ message: string; cover_image_url: string; project_id: number }>(`/projects/${projectId}/cover`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ imageBase64: base64Payload }),
      });
    }

    // 2. On Native (Android / iOS): Read file as base64 using expo-file-system to completely avoid React Native fetch multipart bug
    if (Platform.OS !== 'web' && (imageUri.startsWith('file:') || imageUri.startsWith('content:'))) {
      try {
        const base64 = await FileSystem.readAsStringAsync(imageUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        const cleanUri = imageUri.split('?')[0];
        const match = /\.(\w+)$/.exec(cleanUri);
        const ext = match ? match[1].toLowerCase() : 'jpg';
        const dataUri = `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${base64}`;
        return this.request<{ message: string; cover_image_url: string; project_id: number }>(`/projects/${projectId}/cover`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ imageBase64: dataUri }),
        });
      } catch (fsErr) {
        console.warn('[uploadProjectCover] FileSystem base64 notice, trying multipart:', fsErr);
      }
    }

    // 3. On Web: Convert blob/image to base64 Data URL
    if (Platform.OS === 'web') {
      try {
        const res = await fetch(imageUri);
        const blob = await res.blob();
        const base64Data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        return this.request<{ message: string; cover_image_url: string; project_id: number }>(`/projects/${projectId}/cover`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ imageBase64: base64Data }),
        });
      } catch (webErr) {
        console.warn('[uploadProjectCover] Web base64 notice, trying multipart:', webErr);
      }
    }

    // 4. Multipart FormData fallback
    try {
      const formData = new FormData();
      const cleanFilename = imageUri.split('/').pop()?.split('?')[0] || 'cover.jpg';
      const fileNameToUse = cleanFilename.includes('.') ? cleanFilename : 'cover.jpg';
      const match = /\.(\w+)$/.exec(fileNameToUse);
      const ext = match ? match[1].toLowerCase() : 'jpg';
      const type = `image/${ext === 'jpg' ? 'jpeg' : ext}`;

      if (Platform.OS === 'web') {
        const res = await fetch(imageUri);
        const blob = await res.blob();
        formData.append('cover', blob, fileNameToUse);
      } else {
        const formattedUri = Platform.OS === 'android' ? imageUri : imageUri.replace('file://', '');
        formData.append('cover', {
          uri: formattedUri,
          name: fileNameToUse,
          type,
        } as any);
      }

      const url = `${this.baseUrl}/projects/${projectId}/cover`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'bypass-tunnel-reminder': 'true',
          'ngrok-skip-browser-warning': 'true',
        },
        body: formData,
      });

      const text = await response.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Erreur serveur (${response.status})`);
      }

      if (!response.ok) {
        throw new Error(data.message || data.error || `Erreur HTTP ${response.status}`);
      }

      return data;
    } catch (formErr: any) {
      throw formErr;
    }
  }

  async resetProjectCover(
    token: string,
    projectId: number | string
  ): Promise<{ message: string; cover_image_url: null; project_id: number }> {
    return this.request<{ message: string; cover_image_url: null; project_id: number }>(`/projects/${projectId}/cover`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  }

  async getChantierDetails(token: string, id: number | string): Promise<{ chantier: ChantierDetails }> {
    return this.request<{ chantier: ChantierDetails }>(`/chantiers/${id}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  }

  async getChantierAvancement(token: string, id: number | string): Promise<ChantierAvancementResponse> {
    return this.request<ChantierAvancementResponse>(`/chantiers/${id}/avancement`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  }

  async getChantierJournal(
    token: string,
    id: number | string,
    month?: string
  ): Promise<ChantierJournalResponse> {
    const query = month ? `?month=${encodeURIComponent(month)}` : '';
    return this.request<ChantierJournalResponse>(`/chantiers/${id}/journal${query}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  }

  async requestJustification(
    token: string,
    chantierId: number | string,
    payload: DemandeExplicationPayload
  ): Promise<{ message: string; demande: any }> {
    return this.request<{ message: string; demande: any }>(`/chantiers/${chantierId}/justifications/demander`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
  }

  async respondJustification(
    token: string,
    demandeId: number | string,
    payload: ReponseExplicationPayload
  ): Promise<{ message: string; demande: any }> {
    return this.request<{ message: string; demande: any }>(`/agent/justifications/${demandeId}/repondre`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
  }

  async getJustificationDetails(
    token: string,
    demandeId: number | string
  ): Promise<{ demande: any }> {
    return this.request<{ demande: any }>(`/agent/justifications/${demandeId}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  }

  async getAgentAbsences(
    token: string,
    agentId?: number | string
  ): Promise<{ absences: AgentAbsenceItem[] }> {
    const query = agentId ? `?agent_id=${encodeURIComponent(agentId)}` : '';
    return this.request<{ absences: AgentAbsenceItem[] }>(`/agent/absences${query}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  }

  async createAgentAbsence(
    token: string,
    payload: { date_debut: string; date_fin: string; motif: string; justificatif_url?: string }
  ): Promise<{ message: string; absence: AgentAbsenceItem }> {
    return this.request<{ message: string; absence: AgentAbsenceItem }>(`/agent/absences`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
  }


  async createProject(token: string, payload: CreateProjectPayload): Promise<{ message: string; project: Project }> {
    return this.request<{ message: string; project: Project }>('/projects', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
  }

  async deleteProject(token: string, id: number | string): Promise<{ message: string }> {
    return this.request<{ message: string }>(`/projects/${id}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  }

  async bulkDeleteProjects(
    token: string,
    ids: number[]
  ): Promise<{ message: string; deleted_count: number; deleted_ids: number[] }> {
    // Uses POST instead of DELETE so the JSON body is reliably parsed by Express
    return this.request<{ message: string; deleted_count: number; deleted_ids: number[] }>(
      '/projects/bulk-delete',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ids }),
      }
    );
  }

  async createChantier(
    token: string,
    projectId: number | string,
    payload: CreateChantierPayload
  ): Promise<{ message: string; chantier: ProjectChantier }> {
    return this.request<{ message: string; chantier: ProjectChantier }>(`/projects/${projectId}/chantiers`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
  }

  async initializeProjectChantiers(
    token: string,
    projectId: number | string,
    count: number
  ): Promise<{ message: string; chantiers: ProjectChantier[] }> {
    return this.request<{ message: string; chantiers: ProjectChantier[] }>(`/projects/${projectId}/chantiers/init`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ count }),
    });
  }

  async updateChantierConfiguration(
    token: string,
    chantierId: number | string,
    payload: { d_max_position_meters: number }
  ): Promise<{ message: string; chantier: { id: number; d_max_position_meters: number } }> {
    return this.request(`/chantiers/${chantierId}/configuration`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
  }

  async saveChantierAoi(
    token: string,
    chantierId: number | string,
    aoiData: any
  ): Promise<{ message: string; chantier: ChantierDetails }> {
    return this.request<{ message: string; chantier: ChantierDetails }>(
      `/chantiers/${chantierId}/aoi`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ aoi: aoiData }),
      }
    );
  }

  async checkChantierAoiConflict(
    token: string,
    chantierId: number | string,
    aoiData: any
  ): Promise<AoiConflictCheckResponse> {
    return this.request<AoiConflictCheckResponse>(
      `/chantiers/${chantierId}/aoi/check-conflict`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ aoi: aoiData }),
      }
    );
  }

  async getSiblingChantierAois(
    token: string,
    chantierId: number | string
  ): Promise<{ chantiers: SiblingChantierAoiItem[] }> {
    return this.request<{ chantiers: SiblingChantierAoiItem[] }>(
      `/chantiers/${chantierId}/sibling-aois`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );
  }

  async detectCrs(
    token: string,
    chantierId: number | string,
    payload: {
      fileUri?: string;
      fileName?: string;
      geojson?: any;
      kmlText?: string;
      aoi?: any;
      source_srid?: number;
      assets?: Array<{ name: string; data?: string; url?: string }>;
    }
  ): Promise<CrsDetectionResponse> {
    if (payload.geojson || payload.kmlText) {
      return this.request<CrsDetectionResponse>(`/chantiers/${chantierId}/crs/detect`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          geojson: payload.geojson,
          kmlText: payload.kmlText,
          original_filename: payload.fileName || (payload.kmlText ? 'source.kml' : 'source.geojson'),
          aoi: payload.aoi,
          source_srid: payload.source_srid,
          assets: payload.assets,
        }),
      });
    }

    if (payload.fileUri) {
      const formData = new FormData();
      const fileName = payload.fileName || 'source.geojson';
      const isKml = fileName.toLowerCase().endsWith('.kml');

      if (Platform.OS === 'web') {
        const res = await fetch(payload.fileUri);
        const blob = await res.blob();
        formData.append('geojson', blob, fileName);
      } else {
        formData.append('geojson', {
          uri: payload.fileUri,
          name: fileName,
          type: isKml ? 'application/vnd.google-earth.kml+xml' : 'application/geo+json',
        } as any);
      }

      if (payload.aoi) {
        formData.append('aoi', JSON.stringify(payload.aoi));
      }
      if (payload.source_srid) {
        formData.append('source_srid', String(payload.source_srid));
      }
      if (payload.assets && payload.assets.length > 0) {
        formData.append('assets', JSON.stringify(payload.assets));
      }

      const url = `${this.baseUrl}/chantiers/${chantierId}/crs/detect`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      const text = await response.text();
      const data = JSON.parse(text);
      if (!response.ok) {
        throw new Error(data.message || data.error || `Erreur HTTP ${response.status}`);
      }
      return data;
    }

    throw new Error('Aucune donnée spatiale fournie pour la détection du CRS.');
  }

  async analyzeGeoJSONSource(
    token: string,
    chantierId: number | string,
    fileData: {
      fileUri?: string;
      fileName?: string;
      geojson?: any;
      aoi?: any;
      source_srid?: number;
      assets?: Array<{ name: string; data?: string; url?: string }>;
    }
  ): Promise<GeoJSONAnalysisResponse> {
    if (fileData.geojson) {
      return this.request<GeoJSONAnalysisResponse>(
        `/chantiers/${chantierId}/reference-alignment/analyze`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            geojson: fileData.geojson,
            original_filename: fileData.fileName || 'source.geojson',
            aoi: fileData.aoi,
            source_srid: fileData.source_srid,
            assets: fileData.assets,
          }),
        }
      );
    }

    if (fileData.fileUri) {
      const formData = new FormData();
      const fileName = fileData.fileName || 'source.geojson';

      if (Platform.OS === 'web') {
        const res = await fetch(fileData.fileUri);
        const blob = await res.blob();
        formData.append('geojson', blob, fileName);
      } else {
        formData.append('geojson', {
          uri: fileData.fileUri,
          name: fileName,
          type: 'application/geo+json',
        } as any);
      }

      if (fileData.aoi) {
        formData.append('aoi', JSON.stringify(fileData.aoi));
      }
      if (fileData.source_srid) {
        formData.append('source_srid', String(fileData.source_srid));
      }
      if (fileData.assets && fileData.assets.length > 0) {
        formData.append('assets', JSON.stringify(fileData.assets));
      }

      const url = `${this.baseUrl}/chantiers/${chantierId}/reference-alignment/analyze`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      const text = await response.text();
      const data = JSON.parse(text);
      if (!response.ok) {
        throw new Error(data.message || data.error || `Erreur HTTP ${response.status}`);
      }
      return data;
    }

    throw new Error('Aucune donnée GeoJSON fournie pour l\'analyse.');
  }

  async uploadReferenceAlignment(
    token: string,
    chantierId: number | string,
    fileData: {
      fileUri?: string;
      fileName?: string;
      geojson?: any;
      geometry?: any;
      nom?: string;
      source?: 'KML';
      source_srid?: number;
      source_crs_name?: string;
      kml_metadata?: KmlMetadata | null;
      assets?: Array<{ name: string; data?: string; url?: string }>;
    }
  ): Promise<{ message: string; reference_alignment: ReferenceAlignment }> {
    // 1. If direct GeoJSON object / string / geometry provided, send as JSON body
    if (fileData.geojson || fileData.geometry) {
      return this.request<{ message: string; reference_alignment: ReferenceAlignment }>(
        `/chantiers/${chantierId}/reference-alignment`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            geojson: fileData.geojson || fileData.geometry,
            geometry: fileData.geometry,
            original_filename: fileData.fileName || 'alignment.geojson',
            nom: fileData.nom,
            source: fileData.source,
            source_srid: fileData.source_srid,
            source_crs_name: fileData.source_crs_name,
            kml_metadata: fileData.kml_metadata,
            assets: fileData.assets,
          }),
        }
      );
    }

    // 2. If file URI provided (mobile/web file upload)
    if (fileData.fileUri) {
      try {
        const formData = new FormData();
        const fileName = fileData.fileName || 'railway_alignment.geojson';

        if (Platform.OS === 'web') {
          const res = await fetch(fileData.fileUri);
          const blob = await res.blob();
          formData.append('geojson', blob, fileName);
        } else {
          formData.append('geojson', {
            uri: fileData.fileUri,
            name: fileName,
            type: 'application/geo+json',
          } as any);
        }

        if (fileData.nom) {
          formData.append('nom', fileData.nom);
        }
        if (fileData.source_srid) {
          formData.append('source_srid', String(fileData.source_srid));
        }
        if (fileData.source_crs_name) {
          formData.append('source_crs_name', fileData.source_crs_name);
        }
        if (fileData.kml_metadata) {
          formData.append('kml_metadata', JSON.stringify(fileData.kml_metadata));
        }

        const url = `${this.baseUrl}/chantiers/${chantierId}/reference-alignment`;
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: formData,
        });

        const text = await response.text();
        const data = JSON.parse(text);
        if (!response.ok) {
          throw new Error(data.message || data.error || `Erreur HTTP ${response.status}`);
        }
        return data;
      } catch (err: any) {
        throw err;
      }
    }

    throw new Error('Aucune donnée GeoJSON fournie pour l\'importation.');
  }

  async getReferenceAlignment(
    token: string,
    chantierId: number | string
  ): Promise<{ reference_alignment: ReferenceAlignment }> {
    return this.request<{ reference_alignment: ReferenceAlignment }>(
      `/chantiers/${chantierId}/reference-alignment`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );
  }

  async toggleAlignmentDirection(
    token: string,
    chantierId: number | string
  ): Promise<{ message: string; reference_alignment: ReferenceAlignment }> {
    return this.request<{ message: string; reference_alignment: ReferenceAlignment }>(
      `/chantiers/${chantierId}/reference-alignment/direction`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );
  }

  async generateTronconsPreview(
    token: string,
    chantierId: number | string,
    params: { count?: number; target_length_km?: number } | number
  ): Promise<GenerateTronconsResponse> {
    const body = typeof params === 'number' ? { count: params } : params;
    return this.request<GenerateTronconsResponse>(`/chantiers/${chantierId}/troncons/generate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  }

  async recalculateTronconsChainage(
    token: string,
    chantierId: number | string,
    payload: {
      troncons: TronconItem[];
      modified_index?: number;
      new_pk_debut?: number;
      new_pk_fin?: number;
      reference_alignment_id?: number;
    }
  ): Promise<{
    message: string;
    reference_alignment_id: number;
    total_length_km: number;
    total_length_meters: number;
    troncons: TronconItem[];
  }> {
    return this.request<{
      message: string;
      reference_alignment_id: number;
      total_length_km: number;
      total_length_meters: number;
      troncons: TronconItem[];
    }>(`/chantiers/${chantierId}/troncons/recalculate-chainage`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
  }

  async saveTroncons(
    token: string,
    chantierId: number | string,
    payload: { troncons: TronconItem[]; reference_alignment_id?: number }
  ): Promise<{ message: string; troncons: TronconItem[] }> {
    return this.request<{ message: string; troncons: TronconItem[] }>(`/chantiers/${chantierId}/troncons`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
  }

  async getChantierTroncons(
    token: string,
    chantierId: number | string
  ): Promise<{ troncons: TronconItem[] }> {
    return this.request<{ troncons: TronconItem[] }>(`/chantiers/${chantierId}/troncons`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  }

  async getTronconDetails(
    token: string,
    tronconId: number | string
  ): Promise<TronconDetailsResponse> {
    return this.request<TronconDetailsResponse>(`/responsable/troncon/${tronconId}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  }

  async renameResponsableTroncon(token: string, tronconId: number | string, nom: string) {
    return this.request<{ message: string; troncon: { id: number; nom: string; chantier_id: number } }>(`/responsable/troncon/${tronconId}`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ nom }),
    });
  }

  async deleteResponsableTroncon(token: string, tronconId: number | string) {
    return this.request<{ message: string }>(`/responsable/troncon/${tronconId}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
    });
  }

  async renameResponsableChantier(token: string, chantierId: number | string, nom: string) {
    return this.request<{ message: string; chantier: { id: number; nom: string } }>(`/responsable/chantier/${chantierId}`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ nom }),
    });
  }

  async deleteResponsableChantier(token: string, chantierId: number | string) {
    return this.request<{ message: string }>(`/responsable/chantier/${chantierId}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
    });
  }

  async getResponsableDashboard(token: string): Promise<ResponsableDashboardData> {
    return this.request<ResponsableDashboardData>('/responsable/dashboard', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  }

  // ─── Administrator API Methods ───────────────────────────────────────────────

  async getAdminRoleRequests(token: string, statut?: string): Promise<{ demandes: AdminRoleRequest[]; total: number }> {
    const query = statut ? `?statut=${encodeURIComponent(statut)}` : '';
    return this.request<{ demandes: AdminRoleRequest[]; total: number }>(`/admin/demandes${query}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  }

  async getAdminRoleRequestDetails(token: string, id: number | string): Promise<{ demande: AdminRoleRequest }> {
    return this.request<{ demande: AdminRoleRequest }>(`/admin/demandes/${id}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  }

  async acceptAdminRoleRequest(
    token: string,
    id: number | string
  ): Promise<{ message: string; demande_role: any; assigned_role: string }> {
    return this.request<{ message: string; demande_role: any; assigned_role: string }>(
      `/admin/demandes/${id}/accept`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );
  }

  async rejectAdminRoleRequest(
    token: string,
    id: number | string
  ): Promise<{ message: string; demande_role: any }> {
    return this.request<{ message: string; demande_role: any }>(
      `/admin/demandes/${id}/reject`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );
  }

  async getAdminStats(token: string): Promise<AdminStats> {
    return this.request<AdminStats>('/admin/stats', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  }

  // ─── Responsable Assignment Methods ──────────────────────────────────────────

  async getAvailableAgents(token: string): Promise<{ agents: AvailableAgentItem[] }> {
    return this.request<{ agents: AvailableAgentItem[] }>('/responsable/agents-terrain', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  }

  async getTronconAssignments(
    token: string,
    tronconId: number | string
  ): Promise<{ troncon_id: number; troncon_nom: string; chantier_nom: string; projet_nom: string; assignments: AssignedAgentItem[] }> {
    return this.request<{ troncon_id: number; troncon_nom: string; chantier_nom: string; projet_nom: string; assignments: AssignedAgentItem[] }>(
      `/responsable/troncon/${tronconId}/agents`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );
  }

  async assignAgentToTroncon(
    token: string,
    tronconId: number | string,
    payload: { agent_id: number; notes?: string }
  ): Promise<{ message: string; affectation: AssignedAgentItem }> {
    return this.request<{ message: string; affectation: AssignedAgentItem }>(
      `/responsable/troncon/${tronconId}/agents`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      }
    );
  }

  async removeAgentFromTroncon(
    token: string,
    tronconId: number | string,
    agentId: number | string
  ): Promise<{ message: string }> {
    return this.request<{ message: string }>(
      `/responsable/troncon/${tronconId}/agents/${agentId}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );
  }

  async getEquipeTerrain(token: string): Promise<EquipeTerrainResponse> {
    return this.request<EquipeTerrainResponse>('/responsable/equipe-terrain', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  }

  async getHierarchyTree(token: string): Promise<HierarchyTreeResponse> {
    return this.request<HierarchyTreeResponse>('/responsable/hierarchy-tree', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  }

  async createAffectation(
    token: string,
    payload: CreateAffectationPayload
  ): Promise<{ message: string; affectation: any }> {
    return this.request<{ message: string; affectation: any }>('/responsable/affectations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
  }

  async removeAffectation(
    token: string,
    affectationId: number | string
  ): Promise<{ message: string }> {
    return this.request<{ message: string }>(`/responsable/affectations/${affectationId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  }

  // ─── Agent de Terrain (A.T.) Methods ─────────────────────────────────────────

  async getAgentDashboard(token: string): Promise<AgentDashboardResponse> {
    return this.request<AgentDashboardResponse>('/agent/dashboard', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  }

  async getAgentTronconDetails(
    token: string,
    tronconId: number | string
  ): Promise<AgentTronconDetailsResponse> {
    return this.request<AgentTronconDetailsResponse>(`/agent/troncon/${tronconId}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  }

  async getNotifications(token: string): Promise<{ notifications: InAppNotification[]; unread_count: number }> {
    return this.request('/notifications', { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
  }

  async markNotificationRead(token: string, id: number): Promise<{ message: string }> {
    return this.request(`/notifications/${id}/read`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}` } });
  }

  async markAllNotificationsRead(token: string): Promise<{ message: string; updated_count: number }> {
    return this.request('/notifications/read-all', { method: 'PATCH', headers: { Authorization: `Bearer ${token}` } });
  }

  async calculateTronconProjection(
    token: string,
    tronconId: number | string,
    payload: { latitude: number; longitude: number; accuracy?: number }
  ): Promise<SpatialProjectionPreview> {
    return this.request<SpatialProjectionPreview>(`/agent/troncon/${tronconId}/calculate-projection`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
  }

  async createTronconObservation(
    token: string,
    tronconId: number | string,
    payload: CreateObservationPayload
  ): Promise<{ message: string; observation: TerrainObservationItem; projection: SpatialProjectionPreview }> {
    return this.request<{ message: string; observation: TerrainObservationItem; projection: SpatialProjectionPreview }>(
      `/agent/troncon/${tronconId}/observations`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      }
    );
  }

  async getTronconObservationHistory(token: string, tronconId: number | string, month: string): Promise<{ month: string; observations: TerrainObservationItem[] }> {
    return this.request(`/agent/troncon/${tronconId}/observations?month=${encodeURIComponent(month)}`, {
      method: 'GET', headers: { Authorization: `Bearer ${token}` },
    });
  }

  // ─── Level 6: Spatio-Temporal Timeline (Chantier Replay) ─────────────────

  /**
   * GET /chantiers/:chantierId/timeline
   * Returns the complete chronological event stream, non-regressive progress snapshots,
   * and tronçon geometry needed for the Level 6 spatio-temporal replay.
   */
  async getChantierTimeline(
    token: string,
    chantierId: number | string
  ): Promise<ChantierTimelineResponse> {
    return this.request<ChantierTimelineResponse>(`/chantiers/${chantierId}/timeline`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
  }
}


export const api = new ApiClient(API_URL);
