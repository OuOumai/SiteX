/**
 * constants/projectCover.ts
 *
 * Resolves project cover images based on user upload or infrastructure category defaults.
 * Uses the 4 authoritative images provided:
 *  - ROUTIER / AUTOROUTIER: Highway through arid mountains (IMAGE 1)
 *  - FERROVIAIRE: Modern high-speed train on railway tracks (IMAGE 2)
 *  - HYDRAULIQUE: Massive curved concrete hydroelectric dam (IMAGE 3)
 *  - AUTRE INFRASTRUCTURE: Construction site with concrete drainage pipes (IMAGE 4)
 */

import { ImageSourcePropType } from 'react-native';
import { getMediaUrl } from '@/services/api';

export type ProjectInfrastructureCategory = 'ROUTIER' | 'FERROVIAIRE' | 'HYDRAULIQUE' | 'AUTRE';

export const PROJECT_CATEGORY_IMAGES = {
  ROUTIER: require('@/assets/images/project-cover-routier.jpg'),
  FERROVIAIRE: require('@/assets/images/project-cover-ferroviaire.jpg'),
  HYDRAULIQUE: require('@/assets/images/project-cover-hydraulique.jpg'),
  AUTRE: require('@/assets/images/project-cover-autre.jpg'),
} as const;

export const PROJECT_CATEGORY_META: Record<
  ProjectInfrastructureCategory,
  { label: string; icon: string; defaultImage: ImageSourcePropType }
> = {
  ROUTIER: {
    label: 'Routier / Autoroutier',
    icon: 'car-sport-outline',
    defaultImage: PROJECT_CATEGORY_IMAGES.ROUTIER,
  },
  FERROVIAIRE: {
    label: 'Ferroviaire',
    icon: 'train-outline',
    defaultImage: PROJECT_CATEGORY_IMAGES.FERROVIAIRE,
  },
  HYDRAULIQUE: {
    label: 'Hydraulique',
    icon: 'water-outline',
    defaultImage: PROJECT_CATEGORY_IMAGES.HYDRAULIQUE,
  },
  AUTRE: {
    label: 'Autre Infrastructure',
    icon: 'business-outline',
    defaultImage: PROJECT_CATEGORY_IMAGES.AUTRE,
  },
};

/**
 * Detect the infrastructure category for a project based on type_projet, nom, or description.
 */
export function getProjectCategory(project: {
  type_projet?: string | null;
  nom?: string | null;
  description?: string | null;
}): ProjectInfrastructureCategory {
  const type = (project.type_projet || '').toLowerCase().trim();
  const name = (project.nom || '').toLowerCase();
  const desc = (project.description || '').toLowerCase();
  const combined = `${name} ${desc}`;

  // 1. Explicit type matching
  if (type.includes('ferroviaire') || type.includes('rail') || type.includes('train')) {
    return 'FERROVIAIRE';
  }
  if (type.includes('routier') || type.includes('route') || type.includes('autoroute')) {
    return 'ROUTIER';
  }
  if (type.includes('hydraulique') || type.includes('barrage') || type.includes('eau')) {
    return 'HYDRAULIQUE';
  }

  // 2. Keyword fallback in project name or description
  if (
    combined.includes('lgv') ||
    combined.includes('train') ||
    combined.includes('rail') ||
    combined.includes('ferroviaire') ||
    combined.includes('gare')
  ) {
    return 'FERROVIAIRE';
  }

  if (
    combined.includes('autoroute') ||
    combined.includes('route') ||
    combined.includes('routier') ||
    combined.includes('voie express') ||
    combined.includes('rocade') ||
    combined.includes('pénétrante') ||
    combined.includes('penetrante') ||
    combined.includes('échangeur') ||
    combined.includes('echangeur') ||
    combined.includes('viaduc') ||
    combined.includes('pont')
  ) {
    return 'ROUTIER';
  }

  if (
    combined.includes('barrage') ||
    combined.includes('canal') ||
    combined.includes('hydraulique') ||
    combined.includes('assainissement') ||
    combined.includes('station d’épuration') ||
    combined.includes('château d’eau')
  ) {
    return 'HYDRAULIQUE';
  }

  return 'AUTRE';
}

export interface ResolvedProjectCover {
  source: ImageSourcePropType;
  isCustom: boolean;
  category: ProjectInfrastructureCategory;
  categoryLabel: string;
  categoryIcon: string;
}

/**
 * Resolves the display cover image for a project:
 * - If cover_image_url is present, returns the custom uploaded image.
 * - Otherwise returns the exact local category image asset.
 */
export function getProjectCover(project: {
  cover_image_url?: string | null;
  type_projet?: string | null;
  nom?: string | null;
  description?: string | null;
}): ResolvedProjectCover {
  const category = getProjectCategory(project);
  const meta = PROJECT_CATEGORY_META[category];

  if (project.cover_image_url && project.cover_image_url.trim().length > 0) {
    return {
      source: { uri: getMediaUrl(project.cover_image_url) },
      isCustom: true,
      category,
      categoryLabel: meta.label,
      categoryIcon: meta.icon,
    };
  }

  return {
    source: meta.defaultImage,
    isCustom: false,
    category,
    categoryLabel: meta.label,
    categoryIcon: meta.icon,
  };
}
