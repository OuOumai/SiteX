/**
 * explore.tsx — DEPRECATED
 *
 * This file is retained to avoid breaking existing deep links or cached
 * Expo Router references, but the "Explore" tab has been replaced by the
 * domain-specific "Carte" and "Projets" tabs in this milestone.
 *
 * The tab is hidden from the bottom navigation in _layout.tsx.
 * This screen is kept as an empty redirect target only.
 */
import { Redirect } from 'expo-router';

export default function ExploreRedirect() {
  return <Redirect href="/(tabs)" />;
}
