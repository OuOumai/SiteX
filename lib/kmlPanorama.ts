import type { KmlGroundOverlay, KmlPhotoOverlay, ReferenceAlignment } from '@/services/api';

// Explicit source declarations win over filename hints, especially GeoJSON.
export function isKmlSource(source?: string | null, filename?: string | null): boolean {
  if (source?.trim()) return source.trim().toUpperCase() === 'KML';
  return /\.kml$/i.test(filename || '');
}

export function kmlMetadataForSource(alignment?: Pick<ReferenceAlignment, 'source' | 'original_filename' | 'kml_metadata'> | null) {
  return alignment && isKmlSource(alignment.source, alignment.original_filename) ? alignment.kml_metadata : null;
}

export function isKmlPanoramaEligible(source: string | null | undefined, overlay: KmlGroundOverlay | KmlPhotoOverlay | null, width: number, height: number): overlay is KmlPhotoOverlay {
  // Aspect ratio alone cannot distinguish a panorama from a cropped landscape photo.
  return isKmlSource(source) && overlay?.type === 'PhotoOverlay' &&
    overlay.isSafe === true && overlay.isAvailable === true && !!overlay.icon?.href &&
    overlay.shape?.toLowerCase() === 'sphere' && Number.isFinite(width) && Number.isFinite(height) &&
    width >= 1024 && height >= 512 && Math.abs(width / height - 2) <= 0.01;
}
