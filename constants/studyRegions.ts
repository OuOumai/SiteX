export interface StudyRegionPreset {
  id: string;
  nom: string;
  description: string;
  center: [number, number]; // [lat, lng]
  zoom: number;
}

export const STUDY_REGIONS: StudyRegionPreset[] = [
  {
    id: 'kenitra-rabat',
    nom: 'Kénitra – Rabat – Salé',
    description: 'Corridor ferroviaire & autoroutier central (PK 0 – PK 45)',
    center: [34.12, -6.70],
    zoom: 11,
  },
  {
    id: 'tanger-kenitra',
    nom: 'Tanger – Kénitra (LGV Nord)',
    description: 'Ligne à Grande Vitesse Al Boraq Nord',
    center: [35.25, -5.90],
    zoom: 10,
  },
  {
    id: 'rabat-casablanca',
    nom: 'Rabat – Mohammédia – Casablanca',
    description: 'Axe métropolitain atlantique à forte densité',
    center: [33.75, -7.25],
    zoom: 10,
  },
  {
    id: 'casablanca-marrakech',
    nom: 'Casablanca – Settat – Marrakech',
    description: 'Ligne classique & projet d\'extension LGV Sud',
    center: [32.50, -7.80],
    zoom: 9,
  },
  {
    id: 'fes-meknes-oujda',
    nom: 'Fès – Meknès – Taza – Oujda',
    description: 'Axe ferroviaire Oriental & Plaine du Saïss',
    center: [34.10, -5.30],
    zoom: 10,
  },
  {
    id: 'marrakech-agadir',
    nom: 'Marrakech – Agadir (Axe Souss)',
    description: 'Corridor d\'extension Sud Atlantique',
    center: [31.00, -8.80],
    zoom: 9,
  },
];
