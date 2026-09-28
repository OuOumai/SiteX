/**
 * components/gis/kmlStyleUtils.ts
 *
 * Reusable utilities for Level 3 KML 2D styling and color conversion.
 * Converts KML AABBGGRR hexadecimal colors into Leaflet-compatible
 * #RRGGBB colors and opacity values (0.0 - 1.0) with robust fallbacks.
 */

export interface LeafletStyleResult {
  color: string;
  opacity: number;
}

export interface KmlResolvedLineStyle {
  color: string;
  weight: number;
  opacity: number;
  isDefault: boolean;
}

export const DEFAULT_KML_LINE_COLOR = '#F97316'; // Vibrant Coral/Orange distinct from SiteX layers
export const DEFAULT_KML_LINE_WEIGHT = 4.5;
export const DEFAULT_KML_LINE_OPACITY = 0.95;

/**
 * Converts a KML color string (AABBGGRR) into Leaflet-compatible styling (#RRGGBB + opacity).
 *
 * KML color format:
 * - Chars 0-1: Alpha (AA) -> opacity float [0.0 - 1.0]
 * - Chars 2-3: Blue  (BB)
 * - Chars 4-5: Green (GG)
 * - Chars 6-7: Red   (RR)
 *
 * Example:
 * 'ff0000ff' -> Alpha=ff (1.0), Blue=00, Green=00, Red=ff -> { color: '#ff0000', opacity: 1.0 }
 *
 * @param kmlColorHex - Raw KML color string (e.g. 'ff0000ff', '#ff0000ff')
 * @param defaultColor - Fallback hex color if missing/invalid (default #F97316)
 * @param defaultOpacity - Fallback opacity if missing/invalid (default 0.95)
 */
export function convertKmlColorToLeaflet(
  kmlColorHex?: string | null,
  defaultColor = DEFAULT_KML_LINE_COLOR,
  defaultOpacity = DEFAULT_KML_LINE_OPACITY
): LeafletStyleResult {
  if (!kmlColorHex || typeof kmlColorHex !== 'string') {
    return { color: defaultColor, opacity: defaultOpacity };
  }

  const clean = kmlColorHex.trim().replace(/^#/, '');

  // 1. Standard 8-character KML format: AABBGGRR
  if (/^[0-9a-fA-F]{8}$/.test(clean)) {
    const aHex = clean.slice(0, 2);
    const bHex = clean.slice(2, 4);
    const gHex = clean.slice(4, 6);
    const rHex = clean.slice(6, 8);

    const alphaInt = parseInt(aHex, 16);
    const opacity = isNaN(alphaInt) ? defaultOpacity : Math.round((alphaInt / 255) * 100) / 100;
    const color = `#${rHex}${gHex}${bHex}`.toLowerCase();

    return {
      color,
      opacity: Math.max(0, Math.min(1, opacity)),
    };
  }

  // 2. Standard 6-character web format fallback: RRGGBB
  if (/^[0-9a-fA-F]{6}$/.test(clean)) {
    return {
      color: `#${clean.toLowerCase()}`,
      opacity: defaultOpacity,
    };
  }

  // 3. Fallback for invalid formats
  return { color: defaultColor, opacity: defaultOpacity };
}

/**
 * Resolves full Leaflet styling for KML line geometry following priority order:
 * 1. Resolved KML normal style / LineStyle
 * 2. Usable KML LineStyle color & width
 * 3. Default SiteX KML visualization style fallback
 *
 * @param stylesObj - Extracted KML styles object from Level 2 metadata
 */
export function resolveKmlLeafletStyle(stylesObj?: {
  line?: { color?: string | null; width?: number | null } | null;
  styleUrl?: string | null;
} | null): KmlResolvedLineStyle {
  const line = stylesObj?.line;

  if (line) {
    const hasColor = Boolean(line.color && typeof line.color === 'string');
    const hasWidth = typeof line.width === 'number' && !isNaN(line.width) && line.width > 0;

    if (hasColor || hasWidth) {
      const converted = convertKmlColorToLeaflet(line.color);
      const weight = hasWidth ? Math.max(1, Math.min(15, Number(line.width))) : DEFAULT_KML_LINE_WEIGHT;

      return {
        color: converted.color,
        weight,
        opacity: converted.opacity,
        isDefault: !hasColor,
      };
    }
  }

  return {
    color: DEFAULT_KML_LINE_COLOR,
    weight: DEFAULT_KML_LINE_WEIGHT,
    opacity: DEFAULT_KML_LINE_OPACITY,
    isDefault: true,
  };
}
