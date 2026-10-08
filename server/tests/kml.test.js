/**
 * server/tests/kml.test.js
 *
 * Test suite for SiteX Level 1 & Level 2 KML integration.
 * Tests:
 * - Level 1: Geometry extraction, EPSG:4326, 2D altitude ignore, validation, rejection of multiple LineStrings / non-lines.
 * - Level 2: Placemark name, folder hierarchy, description, styleUrl & style definition, ExtendedData, TimeStamp/TimeSpan, geometry invariance.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const kmlService = require('../src/services/kml.service');

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function runTests() {
  console.log('🧪 Starting KML Service Level 1 & Level 2 Test Suite...\n');
  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}: ${err.message}`);
      failed++;
    }
  }

  // ==========================================
  // LEVEL 1 TESTS (PRESERVED)
  // ==========================================

  // --- Test 1: Real Google Earth KML ---
  test('Test 1 (L1) — Real Google Earth KML (RP4022_Tangier_Test.kml)', () => {
    const kmlPath = path.join(__dirname, '../../RP4022_Tangier_Test.kml');
    const content = fs.readFileSync(kmlPath, 'utf8');

    assert(kmlService.isKml(content), 'isKml should recognize real Google Earth KML');

    const result = kmlService.parseKmlToGeoJson(content);
    assert(result.type === 'Feature', 'Result must be a GeoJSON Feature');
    assert(result.geometry.type === 'LineString', 'Geometry must be LineString');
    assert(result.properties.sourceCrs === 'EPSG:4326', 'Source CRS must be EPSG:4326');
    assert(result.geometry.coordinates.length === 5, 'Must extract exactly 5 vertices');
    assert(result.properties.name === 'RP4022_Tangier_Test', 'Must extract Placemark name');

    // Check first vertex
    const v0 = result.geometry.coordinates[0];
    assert(Math.abs(v0[0] - (-5.891811900290772)) < 1e-9, 'First coordinate longitude matches');
    assert(Math.abs(v0[1] - 35.73431418498011) < 1e-9, 'First coordinate latitude matches');
    assert(v0.length === 2, 'Must be 2D [lon, lat]');
  });

  // --- Test 2: Same geometry as GeoJSON ---
  test('Test 2 (L1) — Numerical equivalence with GeoJSON equivalent', () => {
    const kmlPath = path.join(__dirname, '../../RP4022_Tangier_Test.kml');
    const content = fs.readFileSync(kmlPath, 'utf8');
    const kmlResult = kmlService.parseKmlToGeoJson(content);

    const expectedGeoJSON = {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [-5.891811900290772, 35.73431418498011],
          [-5.889824653353914, 35.73423590912699],
          [-5.889760936770346, 35.73593763702176],
          [-5.88790695693689, 35.73739138743712],
          [-5.884922378829673, 35.73722900146829],
        ],
      },
    };

    assert(
      kmlResult.geometry.coordinates.length === expectedGeoJSON.geometry.coordinates.length,
      'Lengths must match'
    );
    for (let i = 0; i < expectedGeoJSON.geometry.coordinates.length; i++) {
      const cKml = kmlResult.geometry.coordinates[i];
      const cGeo = expectedGeoJSON.geometry.coordinates[i];
      assert(Math.abs(cKml[0] - cGeo[0]) < 1e-9, `Vertex ${i} lon matches`);
      assert(Math.abs(cKml[1] - cGeo[1]) < 1e-9, `Vertex ${i} lat matches`);
    }
  });

  // --- Test 3: Altitude ignored ---
  test('Test 3 (L1) — Altitude values are ignored for 2D baseline', () => {
    const kmlWithAlt = `<?xml version="1.0" encoding="UTF-8"?>
    <kml xmlns="http://www.opengis.net/kml/2.2">
      <Placemark>
        <LineString>
          <coordinates>
            -5.89,35.73,150
            -5.88,35.74,180
          </coordinates>
        </LineString>
      </Placemark>
    </kml>`;

    const res = kmlService.parseKmlToGeoJson(kmlWithAlt);
    assert(res.geometry.coordinates.length === 2, '2 vertices');
    assert(res.geometry.coordinates[0][0] === -5.89 && res.geometry.coordinates[0][1] === 35.73, 'Vertex 0 2D');
    assert(res.geometry.coordinates[1][0] === -5.88 && res.geometry.coordinates[1][1] === 35.74, 'Vertex 1 2D');
    assert(res.geometry.coordinates[0].length === 2, 'Vertex 0 has no altitude in 2D array');
  });

  // --- Test 4: Invalid coordinates rejected ---
  test('Test 4 (L1) — Invalid coordinates (500, 35, 0) are strictly rejected', () => {
    const kmlInvalid = `<?xml version="1.0" encoding="UTF-8"?>
    <kml xmlns="http://www.opengis.net/kml/2.2">
      <Placemark>
        <LineString>
          <coordinates>500,35,0 -5.88,35.74,0</coordinates>
        </LineString>
      </Placemark>
    </kml>`;

    let threw = false;
    try {
      kmlService.parseKmlToGeoJson(kmlInvalid);
    } catch (e) {
      threw = true;
      assert(e.message.includes('hors limites'), `Should mention out of bounds: ${e.message}`);
    }
    assert(threw, 'Should throw error on lon=500');
  });

  // --- Test 5: Single LineString success ---
  test('Test 5 (L1) — Single LineString with arbitrary whitespace/tabs/newlines', () => {
    const kmlTabs = `<?xml version="1.0" encoding="UTF-8"?>
    <kml xmlns="http://www.opengis.net/kml/2.2">
      <Document>
        <Placemark>
          <name>Tracé Test Tabulation</name>
          <LineString>
            <coordinates>
              \t-5.89,35.73\t
              \t-5.88,35.74\t
              \t-5.87,35.75\t
            </coordinates>
          </LineString>
        </Placemark>
      </Document>
    </kml>`;

    const res = kmlService.parseKmlToGeoJson(kmlTabs);
    assert(res.geometry.coordinates.length === 3, 'Must parse 3 vertices');
    assert(res.properties.name === 'Tracé Test Tabulation', 'Must get name');
  });


  // --- Test 6: Multi-LineString KML preserves all features separately without merging ---
  test('Test 6 (L1) — Multi-LineString KML preserved as separate features (no silent merge)', () => {
    const kmlMultiple = `<?xml version="1.0" encoding="UTF-8"?>
    <kml xmlns="http://www.opengis.net/kml/2.2">
      <Document>
        <name>Multi LineStrings Network</name>
        <Placemark>
          <name>Section 1</name>
          <LineString><coordinates>-5.89,35.73 -5.88,35.74</coordinates></LineString>
        </Placemark>
        <Placemark>
          <name>Section 2</name>
          <LineString><coordinates>-5.87,35.75 -5.86,35.76</coordinates></LineString>
        </Placemark>
      </Document>
    </kml>`;

    const result = kmlService.parseKmlToGeoJson(kmlMultiple);
    assert(result.type === 'FeatureCollection', 'Must return FeatureCollection for multi-LineString KML');
    assert(Array.isArray(result.features), 'features must be an array');
    assert(result.features.length === 2, `Must contain 2 features, got ${result.features.length}`);
    assert(result.features[0].properties.name === 'Section 1', 'Section 1 name preserved');
    assert(result.features[1].properties.name === 'Section 2', 'Section 2 name preserved');
    assert(result.features[0].geometry.type === 'LineString', 'Feature 0 is LineString');
    assert(result.features[1].geometry.type === 'LineString', 'Feature 1 is LineString');
  });

  // --- Test 7: Point-only KML rejected ---
  test('Test 7 (L1) — Point-only KML rejected as unsupported', () => {
    const kmlPoint = `<?xml version="1.0" encoding="UTF-8"?>
    <kml xmlns="http://www.opengis.net/kml/2.2">
      <Placemark>
        <name>Chantier Point</name>
        <Point><coordinates>-5.89,35.73,0</coordinates></Point>
      </Placemark>
    </kml>`;

    let threw = false;
    try {
      kmlService.parseKmlToGeoJson(kmlPoint);
    } catch (e) {
      threw = true;
      assert(e.message.includes('Point') || e.message.includes('non supportées'), `Should state Point not supported: ${e.message}`);
    }
    assert(threw, 'Must throw for Point-only KML');
  });

  // --- Test 8: Polygon KML rejected ---
  test('Test 8 (L1) — Polygon KML rejected as unsupported', () => {
    const kmlPolygon = `<?xml version="1.0" encoding="UTF-8"?>
    <kml xmlns="http://www.opengis.net/kml/2.2">
      <Placemark>
        <name>Emprise Polygone</name>
        <Polygon>
          <outerBoundaryIs>
            <LinearRing>
              <coordinates>-5.89,35.73,0 -5.88,35.73,0 -5.88,35.74,0 -5.89,35.74,0 -5.89,35.73,0</coordinates>
            </LinearRing>
          </outerBoundaryIs>
        </Polygon>
      </Placemark>
    </kml>`;

    let threw = false;
    try {
      kmlService.parseKmlToGeoJson(kmlPolygon);
    } catch (e) {
      threw = true;
      assert(e.message.includes('Polygon') || e.message.includes('non supportées'), `Should state Polygon not supported: ${e.message}`);
    }
    assert(threw, 'Must throw for Polygon KML');
  });

  // ==========================================
  // LEVEL 2 TESTS (KML INTELLIGENCE)
  // ==========================================

  // --- Test A: Placemark Name ---
  test('Test A (L2) — Placemark name extraction in metadata', () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
    <kml xmlns="http://www.opengis.net/kml/2.2">
      <Placemark>
        <name>Voie Rapide Tanger-Med</name>
        <LineString><coordinates>-5.89,35.73 -5.88,35.74</coordinates></LineString>
      </Placemark>
    </kml>`;

    const res = kmlService.parseKmlToGeoJson(kml);
    assert(res.metadata, 'Result must contain metadata object');
    assert(res.metadata.name === 'Voie Rapide Tanger-Med', 'metadata.name must match Placemark name');
    assert(res.properties.kml_metadata.name === 'Voie Rapide Tanger-Med', 'kml_metadata in Feature properties');
  });

  // --- Test B: Description ---
  test('Test B (L2) — Description extraction in metadata', () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
    <kml xmlns="http://www.opengis.net/kml/2.2">
      <Placemark>
        <name>Section PK 10+000</name>
        <description>Piste de chantier en 2x2 voies avec terre-plein central.</description>
        <LineString><coordinates>-5.89,35.73 -5.88,35.74</coordinates></LineString>
      </Placemark>
    </kml>`;

    const res = kmlService.parseKmlToGeoJson(kml);
    assert(res.metadata.description === 'Piste de chantier en 2x2 voies avec terre-plein central.', 'metadata.description matches');
  });

  // --- Test C: StyleUrl and Style definition ---
  test('Test C (L2) — StyleUrl and LineStyle definition extraction', () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
    <kml xmlns="http://www.opengis.net/kml/2.2">
      <Document>
        <Style id="route-style">
          <LineStyle>
            <color>ff0000ff</color>
            <width>4</width>
          </LineStyle>
        </Style>
        <Placemark>
          <name>Route Principale</name>
          <styleUrl>#route-style</styleUrl>
          <LineString><coordinates>-5.89,35.73 -5.88,35.74</coordinates></LineString>
        </Placemark>
      </Document>
    </kml>`;

    const res = kmlService.parseKmlToGeoJson(kml);
    assert(res.metadata.styleUrl === '#route-style', 'styleUrl extracted');
    assert(res.metadata.styles.line, 'LineStyle must be resolved');
    assert(res.metadata.styles.line.color === 'ff0000ff', 'LineStyle color matches (raw KML AABBGGRR)');
    assert(res.metadata.styles.line.width === 4, 'LineStyle width matches numeric 4');
  });

  // --- Test D: Folder hierarchy preservation ---
  test('Test D (L2) — Nested Folder hierarchy preservation', () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
    <kml xmlns="http://www.opengis.net/kml/2.2">
      <Document>
        <Folder>
          <name>Réseau Nord</name>
          <Folder>
            <name>Infrastructures Ferroviaires</name>
            <Placemark>
              <name>Liaison Tanger-Kenitra</name>
              <LineString><coordinates>-5.89,35.73 -5.88,35.74</coordinates></LineString>
            </Placemark>
          </Folder>
        </Folder>
      </Document>
    </kml>`;

    const res = kmlService.parseKmlToGeoJson(kml);
    assert(Array.isArray(res.metadata.folders), 'folders must be array');
    assert(res.metadata.folders.length === 2, 'Must have 2 levels of hierarchy');
    assert(res.metadata.folders[0] === 'Réseau Nord', 'Level 1 folder matches');
    assert(res.metadata.folders[1] === 'Infrastructures Ferroviaires', 'Level 2 folder matches');
  });

  // --- Test E: ExtendedData (Data & SchemaData) ---
  test('Test E (L2) — ExtendedData key-value extraction', () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
    <kml xmlns="http://www.opengis.net/kml/2.2">
      <Placemark>
        <name>Tracé Autoroutier</name>
        <ExtendedData>
          <Data name="statut_chantier">
            <value>En Terrassement</value>
          </Data>
          <Data name="largeur_plateforme">
            <value>14.5</value>
          </Data>
          <SchemaData schemaUrl="#RoadSchema">
            <SimpleData name="type_revetement">Enrobé Bitumineux</SimpleData>
          </SchemaData>
        </ExtendedData>
        <LineString><coordinates>-5.89,35.73 -5.88,35.74</coordinates></LineString>
      </Placemark>
    </kml>`;

    const res = kmlService.parseKmlToGeoJson(kml);
    assert(res.metadata.extendedData, 'extendedData must exist');
    assert(res.metadata.extendedData.statut_chantier === 'En Terrassement', 'Data.statut_chantier matches');
    assert(res.metadata.extendedData.largeur_plateforme === '14.5', 'Data.largeur_plateforme matches');
    assert(res.metadata.extendedData.type_revetement === 'Enrobé Bitumineux', 'SimpleData.type_revetement matches');
  });

  // --- Test F: TimeStamp ---
  test('Test F (L2) — TimeStamp extraction', () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
    <kml xmlns="http://www.opengis.net/kml/2.2">
      <Placemark>
        <name>Reconnaissance Drone</name>
        <TimeStamp>
          <when>2026-09-26T14:30:00Z</when>
        </TimeStamp>
        <LineString><coordinates>-5.89,35.73 -5.88,35.74</coordinates></LineString>
      </Placemark>
    </kml>`;

    const res = kmlService.parseKmlToGeoJson(kml);
    assert(res.metadata.time, 'time object must exist');
    assert(res.metadata.time.type === 'timestamp', 'time type is timestamp');
    assert(res.metadata.time.when === '2026-09-26T14:30:00Z', 'when date matches');
  });

  // --- Test G: TimeSpan ---
  test('Test G (L2) — TimeSpan extraction', () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
    <kml xmlns="http://www.opengis.net/kml/2.2">
      <Placemark>
        <name>Phase 1 Travaux</name>
        <TimeSpan>
          <begin>2026-01-01</begin>
          <end>2026-06-30</end>
        </TimeSpan>
        <LineString><coordinates>-5.89,35.73 -5.88,35.74</coordinates></LineString>
      </Placemark>
    </kml>`;

    const res = kmlService.parseKmlToGeoJson(kml);
    assert(res.metadata.time, 'time object must exist');
    assert(res.metadata.time.type === 'timespan', 'time type is timespan');
    assert(res.metadata.time.begin === '2026-01-01', 'begin date matches');
    assert(res.metadata.time.end === '2026-06-30', 'end date matches');
  });

  // --- Test H: Geometry Invariance (Level 1 vs Level 2) ---
  test('Test H (L2) — Geometry invariance strictly preserved', () => {
    const kmlPath = path.join(__dirname, '../../RP4022_Tangier_Test.kml');
    const content = fs.readFileSync(kmlPath, 'utf8');

    const res = kmlService.parseKmlToGeoJson(content);

    // Exact Level 1 coordinates expected
    const expectedCoords = [
      [-5.891811900290772, 35.73431418498011],
      [-5.889824653353914, 35.73423590912699],
      [-5.889760936770346, 35.73593763702176],
      [-5.88790695693689, 35.73739138743712],
      [-5.884922378829673, 35.73722900146829],
    ];

    assert(res.geometry.coordinates.length === expectedCoords.length, 'Coordinates length invariant');
    for (let i = 0; i < expectedCoords.length; i++) {
      assert(Math.abs(res.geometry.coordinates[i][0] - expectedCoords[i][0]) < 1e-12, `Vertex ${i} lon invariant`);
      assert(Math.abs(res.geometry.coordinates[i][1] - expectedCoords[i][1]) < 1e-12, `Vertex ${i} lat invariant`);
    }
  });

  // --- Test I: Real Google Earth KML Level 2 Inspection ---
  test('Test I (L2) — Real Google Earth Pro metadata extraction', () => {
    const kmlPath = path.join(__dirname, '../../RP4022_Tangier_Test.kml');
    const content = fs.readFileSync(kmlPath, 'utf8');

    const res = kmlService.parseKmlToGeoJson(content);
    assert(res.metadata.name === 'RP4022_Tangier_Test', 'Placemark name matches');
    assert(res.metadata.documentName === 'RP4022_Tangier_Test.kml', 'Document name matches');
    assert(res.metadata.styleUrl === '#m_ylw-pushpin', 'StyleUrl matches #m_ylw-pushpin');
    assert(res.metadata.styles.styleMap, 'StyleMap m_ylw-pushpin resolved');
    assert(res.metadata.styles.styleMap.pairs.length === 2, 'StyleMap contains 2 pairs');
    assert(res.metadata.styles.definedStylesCount === 2, '2 Styles defined');
    assert(res.metadata.generator === 'Google Earth Pro 7.3.7.1327', 'Generator matches atom:link title');
  });

  // ==========================================
  // LEVEL 3 TESTS (2D VISUALIZATION & STYLING)
  // ==========================================

  // --- Test J: KML Color Conversion (AABBGGRR -> #RRGGBB + Opacity) ---
  test('Test J (L3) — Valid KML color conversion (AABBGGRR)', () => {
    // Red: Alpha=ff, Blue=00, Green=00, Red=ff
    const red = kmlService.convertKmlColorToLeaflet('ff0000ff');
    assert(red.color === '#ff0000', `Expected red #ff0000, got ${red.color}`);
    assert(red.opacity === 1.0, `Expected opacity 1.0, got ${red.opacity}`);

    // Blue: Alpha=ff, Blue=ff, Green=00, Red=00
    const blue = kmlService.convertKmlColorToLeaflet('ffff0000');
    assert(blue.color === '#0000ff', `Expected blue #0000ff, got ${blue.color}`);
    assert(blue.opacity === 1.0, `Expected opacity 1.0, got ${blue.opacity}`);

    // Green: Alpha=ff, Blue=00, Green=ff, Red=00
    const green = kmlService.convertKmlColorToLeaflet('ff00ff00');
    assert(green.color === '#00ff00', `Expected green #00ff00, got ${green.color}`);
    assert(green.opacity === 1.0, `Expected opacity 1.0, got ${green.opacity}`);

    // Yellow: Alpha=ff, Blue=00, Green=ff, Red=ff
    const yellow = kmlService.convertKmlColorToLeaflet('ff00ffff');
    assert(yellow.color === '#ffff00', `Expected yellow #ffff00, got ${yellow.color}`);
    assert(yellow.opacity === 1.0, `Expected opacity 1.0, got ${yellow.opacity}`);
  });

  // --- Test K: Alpha Opacity Conversion ---
  test('Test K (L3) — Alpha channel extraction to 0.0 - 1.0 opacity', () => {
    // 50% opacity: Alpha=7f (127/255 = ~0.50)
    const semiTransparent = kmlService.convertKmlColorToLeaflet('7f0000ff');
    assert(semiTransparent.color === '#ff0000', 'Color matches red');
    assert(Math.abs(semiTransparent.opacity - 0.5) <= 0.01, `Opacity expected ~0.5, got ${semiTransparent.opacity}`);

    // 0% opacity (fully transparent): Alpha=00
    const transparent = kmlService.convertKmlColorToLeaflet('000000ff');
    assert(transparent.color === '#ff0000', 'Color matches red');
    assert(transparent.opacity === 0, `Opacity expected 0, got ${transparent.opacity}`);
  });

  // --- Test L: Invalid and Missing Color Fallbacks ---
  test('Test L (L3) — Invalid and missing color safe fallback', () => {
    // Missing / null / undefined
    const fromNull = kmlService.convertKmlColorToLeaflet(null);
    assert(fromNull.color === '#F97316', 'Default fallback color #F97316');
    assert(fromNull.opacity === 0.95, 'Default fallback opacity 0.95');

    const fromUndefined = kmlService.convertKmlColorToLeaflet(undefined);
    assert(fromUndefined.color === '#F97316', 'Default fallback color for undefined');

    const fromEmpty = kmlService.convertKmlColorToLeaflet('');
    assert(fromEmpty.color === '#F97316', 'Default fallback color for empty string');

    // Invalid non-hex string
    const fromInvalid = kmlService.convertKmlColorToLeaflet('not-a-color');
    assert(fromInvalid.color === '#F97316', 'Default fallback color for invalid string');

    // Standard 6-char hex web fallback
    const from6Char = kmlService.convertKmlColorToLeaflet('#38bdf8');
    assert(from6Char.color === '#38bdf8', 'Support 6-character hex fallback');
  });

  // --- Test M: Style Fallback Hierarchy ---
  test('Test M (L3) — LineStyle resolution & fallback priority', () => {
    // 1. LineStyle with color and width
    const explicitLine = {
      line: { color: 'ff0000ff', width: 5 },
      styleUrl: '#custom',
    };
    const resolvedExplicit = kmlService.resolveKmlLeafletStyle(explicitLine);
    assert(resolvedExplicit.color === '#ff0000', 'Uses explicit LineStyle color');
    assert(resolvedExplicit.weight === 5, 'Uses explicit LineStyle width');
    assert(resolvedExplicit.opacity === 1.0, 'Uses explicit LineStyle opacity');
    assert(!resolvedExplicit.isDefault, 'isDefault is false');

    // 2. LineStyle with missing color but explicit width
    const widthOnly = {
      line: { color: null, width: 6 },
    };
    const resolvedWidthOnly = kmlService.resolveKmlLeafletStyle(widthOnly);
    assert(resolvedWidthOnly.color === '#F97316', 'Falls back to default color');
    assert(resolvedWidthOnly.weight === 6, 'Preserves explicit width');

    // 3. Null style object (missing styles)
    const nullStyle = kmlService.resolveKmlLeafletStyle(null);
    assert(nullStyle.color === '#F97316', 'Default SiteX visualization color');
    assert(nullStyle.weight === 4.5, 'Default SiteX visualization weight');
    assert(nullStyle.opacity === 0.95, 'Default SiteX visualization opacity');
    assert(nullStyle.isDefault === true, 'isDefault is true');
  });

  // --- Test N: Real Google Earth KML Level 3 Style Fallback ---
  test('Test N (L3) — Real Google Earth KML style resolution without LineStyle', () => {
    const kmlPath = path.join(__dirname, '../../RP4022_Tangier_Test.kml');
    const content = fs.readFileSync(kmlPath, 'utf8');

    const res = kmlService.parseKmlToGeoJson(content);
    // Real KML contains an IconStyle but no LineStyle
    assert(res.metadata.styles.line === null, 'Real KML has no LineStyle definition');

    // When resolved, must safely provide the default visualization style
    const leafletStyle = kmlService.resolveKmlLeafletStyle(res.metadata.styles);
    assert(leafletStyle.color === '#F97316', 'Real KML resolves to safe default color');
    assert(leafletStyle.weight === 4.5, 'Real KML resolves to safe default weight');
    assert(leafletStyle.opacity === 0.95, 'Real KML resolves to safe default opacity');
    assert(leafletStyle.isDefault === true, 'isDefault flag is set');
  });

  // ==========================================
  // LEVEL 4 TESTS (GROUNDOVERLAY & PHOTOOVERLAY)
  // ==========================================

  // --- Test O: GroundOverlay Parsing ---
  test('Test O (L4) — Valid GroundOverlay metadata, LatLonBox, rotation, and opacity', () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
    <kml xmlns="http://www.opengis.net/kml/2.2">
      <Document>
        <name>Projet Tanger Med</name>
        <Placemark>
          <name>Axe Principal</name>
          <LineString><coordinates>-5.89,35.73 -5.88,35.74</coordinates></LineString>
        </Placemark>
        <GroundOverlay id="overlay_plan_01">
          <name>Plan de Masse Terrassement</name>
          <description>Plan topographique géoréférencé</description>
          <color>80ffffff</color>
          <drawOrder>3</drawOrder>
          <Icon>
            <href>images/plan_masse.png</href>
            <refreshMode>onInterval</refreshMode>
            <refreshInterval>120</refreshInterval>
            <viewBoundScale>0.85</viewBoundScale>
          </Icon>
          <LatLonBox>
            <north>35.7450</north>
            <south>35.7310</south>
            <east>-5.8750</east>
            <west>-5.8920</west>
            <rotation>14.5</rotation>
          </LatLonBox>
        </GroundOverlay>
      </Document>
    </kml>`;

    const res = kmlService.parseKmlToGeoJson(kml);
    assert(Array.isArray(res.metadata.groundOverlays), 'groundOverlays is an array');
    assert(res.metadata.groundOverlays.length === 1, 'Extracted exactly 1 GroundOverlay');

    const go = res.metadata.groundOverlays[0];
    assert(go.id === 'overlay_plan_01', 'GroundOverlay ID extracted');
    assert(go.name === 'Plan de Masse Terrassement', 'GroundOverlay name extracted');
    assert(go.description === 'Plan topographique géoréférencé', 'Description extracted');
    assert(go.icon.href === 'images/plan_masse.png', 'Icon href extracted');
    assert(go.icon.refreshMode === 'onInterval', 'RefreshMode extracted');
    assert(go.icon.refreshInterval === 120, 'RefreshInterval extracted');
    assert(go.icon.viewBoundScale === 0.85, 'ViewBoundScale extracted');
    assert(go.drawOrder === 3, 'DrawOrder extracted');
    assert(go.opacity === 0.5, `Opacity computed from 80ffffff color (got ${go.opacity})`);
    assert(go.latLonBox !== null, 'LatLonBox extracted');
    assert(go.latLonBox.north === 35.745, 'North bound matches');
    assert(go.latLonBox.south === 35.731, 'South bound matches');
    assert(go.latLonBox.east === -5.875, 'East bound matches');
    assert(go.latLonBox.west === -5.892, 'West bound matches');
    assert(go.latLonBox.rotation === 14.5, 'Rotation matches');
    assert(go.isRemote === false, 'Local asset is not remote');
    assert(go.isSafe === true, 'Local clean path is safe');
    assert(go.isAvailable === false, 'Local asset without upload package marked unavailable cleanly');
  });

  // --- Test P: GroundOverlay LatLonBox Validation ---
  test('Test P (L4) — LatLonBox bounds validation and edge cases', () => {
    // Valid box
    const validBox = kmlService.parseLatLonBox({
      north: '35.8',
      south: '35.7',
      east: '-5.8',
      west: '-5.9',
      rotation: '12',
    });
    assert(validBox !== null, 'Valid box parses');
    assert(validBox.north === 35.8, 'North valid');
    assert(validBox.rotation === 12, 'Rotation parsed as number');

    // Inverted south >= north
    const invertedBox = kmlService.parseLatLonBox({
      north: '35.7',
      south: '35.8',
      east: '-5.8',
      west: '-5.9',
    });
    assert(invertedBox === null, 'Inverted latitude rejected');

    // Out of WGS84 range
    const outOfBounds = kmlService.parseLatLonBox({
      north: '95',
      south: '35.0',
      east: '-5.8',
      west: '-5.9',
    });
    assert(outOfBounds === null, 'Latitude > 90 rejected');

    // Non-numeric
    const nonNumeric = kmlService.parseLatLonBox({
      north: 'invalid',
      south: '35.0',
      east: '-5.8',
      west: '-5.9',
    });
    assert(nonNumeric === null, 'Non-numeric bounds rejected');
  });

  // --- Test Q: PhotoOverlay Parsing ---
  test('Test Q (L4) — Valid PhotoOverlay with Camera, Point, orientation, and ViewVolume', () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
    <kml xmlns="http://www.opengis.net/kml/2.2">
      <Document>
        <Placemark>
          <LineString><coordinates>-5.89,35.73 -5.88,35.74</coordinates></LineString>
        </Placemark>
        <PhotoOverlay id="photo_entree_01">
          <name>Photo Entrée Nord</name>
          <description>Prise de vue du début de chantier</description>
          <Icon>
            <href>photos/entree_nord.jpg</href>
          </Icon>
          <Camera>
            <longitude>-5.8895</longitude>
            <latitude>35.7345</latitude>
            <altitude>12.5</altitude>
            <heading>45</heading>
            <tilt>60</tilt>
            <roll>5</roll>
          </Camera>
          <ViewVolume>
            <leftFov>-30</leftFov>
            <rightFov>30</rightFov>
            <bottomFov>-20</bottomFov>
            <topFov>20</topFov>
            <near>10</near>
          </ViewVolume>
          <shape>rectangle</shape>
        </PhotoOverlay>
      </Document>
    </kml>`;

    const res = kmlService.parseKmlToGeoJson(kml);
    assert(Array.isArray(res.metadata.photoOverlays), 'photoOverlays is an array');
    assert(res.metadata.photoOverlays.length === 1, 'Extracted 1 PhotoOverlay');

    const po = res.metadata.photoOverlays[0];
    assert(po.id === 'photo_entree_01', 'PhotoOverlay ID');
    assert(po.name === 'Photo Entrée Nord', 'PhotoOverlay name');
    assert(po.position[0] === -5.8895, 'Longitude extracted');
    assert(po.position[1] === 35.7345, 'Latitude extracted');
    assert(po.altitude === 12.5, 'Altitude extracted');
    assert(po.heading === 45, 'Heading extracted');
    assert(po.tilt === 60, 'Tilt extracted');
    assert(po.roll === 5, 'Roll extracted');
    assert(po.shape === 'rectangle', 'Shape extracted');
    assert(po.viewVolume !== null, 'ViewVolume extracted');
    assert(po.viewVolume.near === 10, 'ViewVolume near matches');
  });

  // --- Test R: Multiple Overlays Independence ---
  test('Test R (L4) — Multiple GroundOverlays and PhotoOverlays remain independent with 1 LineString', () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
    <kml xmlns="http://www.opengis.net/kml/2.2">
      <Document>
        <Placemark>
          <name>Axe Référence</name>
          <LineString><coordinates>-5.89,35.73 -5.88,35.74</coordinates></LineString>
        </Placemark>
        <Folder>
          <name>Dossier Cartographique</name>
          <GroundOverlay id="go_1">
            <name>Overlay Orthophoto 1</name>
            <Icon><href>images/ortho1.png</href></Icon>
            <LatLonBox><north>35.74</north><south>35.73</south><east>-5.88</east><west>-5.89</west></LatLonBox>
          </GroundOverlay>
          <GroundOverlay id="go_2">
            <name>Overlay Cadastre 2</name>
            <Icon><href>images/cadastre.png</href></Icon>
            <LatLonBox><north>35.75</north><south>35.74</south><east>-5.87</east><west>-5.88</west></LatLonBox>
          </GroundOverlay>
        </Folder>
        <PhotoOverlay id="po_1">
          <name>Photo Ouvrage PK 0+500</name>
          <Icon><href>photos/ouvrage.jpg</href></Icon>
          <Point><coordinates>-5.885,35.735,0</coordinates></Point>
        </PhotoOverlay>
      </Document>
    </kml>`;

    const res = kmlService.parseKmlToGeoJson(kml);
    assert(res.geometry.type === 'LineString', 'LineString geometry preserved');
    assert(res.metadata.groundOverlays.length === 2, 'Exactly 2 GroundOverlays');
    assert(res.metadata.photoOverlays.length === 1, 'Exactly 1 PhotoOverlay');

    assert(res.metadata.groundOverlays[0].id === 'go_1', 'First overlay has go_1 ID');
    assert(res.metadata.groundOverlays[0].folders.includes('Dossier Cartographique'), 'Folder hierarchy preserved for overlays');
    assert(res.metadata.groundOverlays[1].id === 'go_2', 'Second overlay has go_2 ID');
    assert(res.metadata.photoOverlays[0].id === 'po_1', 'PhotoOverlay has po_1 ID');
  });

  // --- Test S: Security & Path Traversal Rejection ---
  test('Test S (L4) — Directory traversal, root paths, and dangerous schemes strictly rejected', () => {
    // 1. Directory traversal ../
    const trav1 = kmlService.validateAndSanitizeAssetHref('../../etc/passwd');
    assert(trav1.isSafe === false, 'Path with ../ is not safe');
    assert(trav1.isAvailable === false, 'Traversal is not available');
    assert(trav1.warning.includes('traversée de répertoire'), 'Rejection warning indicates traversal');

    // 2. Windows backslash traversal ..\
    const trav2 = kmlService.validateAndSanitizeAssetHref('..\\..\\secret.txt');
    assert(trav2.isSafe === false, 'Backslash traversal is not safe');

    // 3. Absolute root path
    const rootPath = kmlService.validateAndSanitizeAssetHref('/var/log/system.log');
    assert(rootPath.isSafe === false, 'Absolute root path is rejected');

    // 4. Windows drive letter
    const winDrive = kmlService.validateAndSanitizeAssetHref('C:\\Windows\\System32\\calc.exe');
    assert(winDrive.isSafe === false, 'Windows drive letter path is rejected');

    // 5. JavaScript protocol
    const jsUri = kmlService.validateAndSanitizeAssetHref('javascript:alert(document.cookie)');
    assert(jsUri.isSafe === false, 'javascript: scheme is rejected');

    // 6. Data URI protocol
    const dataUri = kmlService.validateAndSanitizeAssetHref('data:text/html,<script>alert(1)</script>');
    assert(dataUri.isSafe === false, 'data: scheme is rejected');

    // 7. File protocol
    const fileUri = kmlService.validateAndSanitizeAssetHref('file:///etc/hosts');
    assert(fileUri.isSafe === false, 'file: scheme is rejected');
  });

  // --- Test T: Remote URL Handling (No SSRF) ---
  test('Test T (L4) — Remote HTTP/HTTPS URLs categorized safely without server fetching', () => {
    const remote = kmlService.validateAndSanitizeAssetHref('https://tiles.example.com/aerial.jpg');
    assert(remote.isRemote === true, 'Flagged as remote URL');
    assert(remote.isSafe === true, 'Safe HTTPS URL');
    assert(remote.isAvailable === true, 'Available for client-side rendering');
    assert(remote.warning === null, 'No warning for valid remote URL');
  });

  // --- Test U: Missing href handling ---
  test('Test U (L4) — Missing or empty href handled gracefully without crash', () => {
    const empty = kmlService.validateAndSanitizeAssetHref('');
    assert(empty.isAvailable === false, 'Empty href is not available');
    assert(empty.isSafe === false, 'Empty href marked not safe');

    const nullHref = kmlService.validateAndSanitizeAssetHref(null);
    assert(nullHref.isAvailable === false, 'Null href is not available');

    // Overlay without Icon/href in KML
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
    <kml xmlns="http://www.opengis.net/kml/2.2">
      <Placemark><LineString><coordinates>-5.89,35.73 -5.88,35.74</coordinates></LineString></Placemark>
      <GroundOverlay>
        <name>Overlay Sans Href</name>
        <LatLonBox><north>35.74</north><south>35.73</south><east>-5.88</east><west>-5.89</west></LatLonBox>
      </GroundOverlay>
    </kml>`;

    const res = kmlService.parseKmlToGeoJson(kml);
    assert(res.metadata.groundOverlays.length === 1, 'Overlay extracted');
    assert(res.metadata.groundOverlays[0].icon.href === '', 'Empty string href fallback');
    assert(res.metadata.groundOverlays[0].isAvailable === false, 'Marked unavailable');
  });

  // --- Test V: Real Google Earth KML Level 4 Regression Check ---
  test('Test V (L4) — Real Google Earth KML (RP4022_Tangier_Test.kml) has empty overlays and intact geometry', () => {
    const kmlPath = path.join(__dirname, '../../RP4022_Tangier_Test.kml');
    const content = fs.readFileSync(kmlPath, 'utf8');

    const res = kmlService.parseKmlToGeoJson(content);
    assert(Array.isArray(res.metadata.groundOverlays), 'groundOverlays is array');
    assert(res.metadata.groundOverlays.length === 0, 'Real test KML contains 0 GroundOverlays');
    assert(Array.isArray(res.metadata.photoOverlays), 'photoOverlays is array');
    assert(res.metadata.photoOverlays.length === 0, 'Real test KML contains 0 PhotoOverlays');
    assert(res.geometry.coordinates.length === 5, 'Geometry strictly intact');
  });

  // --- Test W: Level 5 3D Coordinate Parsing with Altitude ---
  test('Test W (L5) — Coordinate parsing with altitude (lon,lat,alt) preserves 3D coordinates', () => {
    const rawCoords = '-5.8918,35.7343,120.5 -5.8898,35.7342,125.0 -5.8897,35.7359,130.2';
    const parsed = kmlService.parseKmlCoordinatesWithAltitude(rawCoords);

    assert(parsed.coordinates2D.length === 3, '3 2D coordinates parsed');
    assert(parsed.coordinates3D.length === 3, '3 3D coordinates parsed');
    assert(parsed.hasAltitude === true, 'Flagged as having altitude');
    assert(parsed.coordinates3D[0][2] === 120.5, 'Vertex 1 altitude is 120.5m');
    assert(parsed.coordinates3D[1][2] === 125.0, 'Vertex 2 altitude is 125.0m');
    assert(parsed.coordinates3D[2][2] === 130.2, 'Vertex 3 altitude is 130.2m');
    assert(parsed.altitudeRange.min === 120.5, 'Min altitude is 120.5');
    assert(parsed.altitudeRange.max === 130.2, 'Max altitude is 130.2');

    // 2D coordinates remain strictly [lon, lat]
    assert(parsed.coordinates2D[0].length === 2, '2D vertex has length 2');
    assert(parsed.coordinates2D[0][0] === -5.8918 && parsed.coordinates2D[0][1] === 35.7343, '2D coords exact');
  });

  // --- Test X (L5): 2D Geometry Invariant Preservation ---
  test('Test X (L5) — 2D GeoJSON LineString coordinates remain strictly [lon, lat] for PostGIS', () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
    <kml xmlns="http://www.opengis.net/kml/2.2">
      <Placemark>
        <name>Tracé Surélevé 3D</name>
        <LineString>
          <coordinates>
            -5.8918,35.7343,120 -5.8898,35.7342,150
          </coordinates>
        </LineString>
      </Placemark>
    </kml>`;

    const res = kmlService.parseKmlToGeoJson(kml);

    // 2D baseline MUST remain length 2
    assert(res.geometry.type === 'LineString', 'Geometry is LineString');
    assert(res.geometry.coordinates.length === 2, '2 vertices');
    assert(res.geometry.coordinates[0].length === 2, 'Vertex 1 is strictly [lon, lat]');
    assert(res.geometry.coordinates[1].length === 2, 'Vertex 2 is strictly [lon, lat]');

    // 3D metadata preserves the altitude
    assert(res.metadata.hasAltitude === true, 'hasAltitude is true in metadata');
    assert(Array.isArray(res.metadata.altitudeCoordinates), 'altitudeCoordinates present in metadata');
    assert(res.metadata.altitudeCoordinates[0][2] === 120, 'Vertex 1 has Z=120m');
    assert(res.metadata.altitudeCoordinates[1][2] === 150, 'Vertex 2 has Z=150m');
    assert(res.metadata.altitudeRange.min === 120 && res.metadata.altitudeRange.max === 150, 'Altitude range preserved');
  });

  // --- Test Y (L5): 0 Altitude Handling ---
  test('Test Y (L5) — Altitude of 0 is handled cleanly without artificial exaggeration', () => {
    const rawCoords = '-5.8918,35.7343,0 -5.8898,35.7342,0';
    const parsed = kmlService.parseKmlCoordinatesWithAltitude(rawCoords);

    assert(parsed.coordinates3D.length === 2, '2 coordinates');
    assert(parsed.coordinates3D[0][2] === 0, 'Vertex 1 altitude is 0');
    assert(parsed.coordinates3D[1][2] === 0, 'Vertex 2 altitude is 0');
    assert(parsed.altitudeRange.min === 0 && parsed.altitudeRange.max === 0, 'Min and max are 0');
  });

  // --- Test Z (L5): Missing Altitude Fallback ---
  test('Test Z (L5) — KML without altitude coordinates has hasAltitude=false and clean null fallback', () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
    <kml xmlns="http://www.opengis.net/kml/2.2">
      <Placemark>
        <name>Tracé 2D Sans Altitude</name>
        <LineString>
          <coordinates>
            -5.8918,35.7343 -5.8898,35.7342
          </coordinates>
        </LineString>
      </Placemark>
    </kml>`;

    const res = kmlService.parseKmlToGeoJson(kml);
    assert(res.metadata.hasAltitude === false, 'hasAltitude is false when Z absent');
    assert(res.metadata.altitudeCoordinates === null, 'altitudeCoordinates is null when absent');
    assert(res.metadata.altitudeRange === null, 'altitudeRange is null when absent');
  });

  // --- Test AA (L5): Real Google Earth KML Altitude Extraction ---
  test('Test AA (L5) — Real Google Earth KML (RP4022_Tangier_Test.kml) has 0m elevation without error', () => {
    const kmlPath = path.join(__dirname, '../../RP4022_Tangier_Test.kml');
    const content = fs.readFileSync(kmlPath, 'utf8');

    const res = kmlService.parseKmlToGeoJson(content);
    assert(res.geometry.coordinates.length === 5, '5 vertices in 2D geometry');
    assert(res.geometry.coordinates[0].length === 2, '2D vertex is [lon, lat]');
    assert(res.metadata.altitudeCoordinates !== null, 'Coordinates with 0 altitude preserved in 3D metadata');
    assert(res.metadata.altitudeRange.min === 0 && res.metadata.altitudeRange.max === 0, 'Altitude range is 0m');
  });

  // --- Test AB (L2): QGIS-Style KML with Inline Style, SimpleData kml_name & Description ---
  test('Test AB (L2) — QGIS-style KML with description, ExtendedData, Folder and LineString', () => {
    const qgisKml = `<?xml version="1.0" encoding="utf-8" ?>
    <kml xmlns="http://www.opengis.net/kml/2.2">
    <Document id="root_doc">
      <Folder>
        <name>Dossier_QGIS_Test</name>
        <Placemark id="placemark.1">
          <description>Projet: SiteX Tanger Test
Infrastructure: Route
Référence: RP4022
PK début: 0+000
PK fin: 2+500</description>
          <Style><LineStyle><color>ff0000ff</color></LineStyle></Style>
          <ExtendedData>
            <SchemaData schemaUrl="#test_schema">
              <SimpleData name="kml_name">RP4022_Tangier_Metadata</SimpleData>
              <SimpleData name="reference">RP4022</SimpleData>
              <SimpleData name="infrastructure">Route</SimpleData>
            </SchemaData>
          </ExtendedData>
          <LineString>
            <coordinates>
              -5.89181,35.73431 -5.88982,35.73423 -5.88790,35.73739
            </coordinates>
          </LineString>
        </Placemark>
      </Folder>
    </Document>
    </kml>`;

    const res = kmlService.parseKmlToGeoJson(qgisKml);

    // 1. Description parsed correctly
    assert(res.metadata.description !== null, 'Description must be extracted');
    assert(res.metadata.description.includes('Projet: SiteX Tanger Test'), 'Description must contain project line');
    assert(res.metadata.description.includes('PK début: 0+000'), 'Description must contain PK debut');

    // 2. Fallback name from SimpleData kml_name
    assert(res.properties.name === 'RP4022_Tangier_Metadata', 'Fallback kml_name used when direct name absent');
    assert(res.metadata.name === 'RP4022_Tangier_Metadata', 'Metadata name matches fallback kml_name');

    // 3. Inline Style without id recognized
    assert(res.metadata.styles.line !== null, 'Inline line style must be parsed');
    assert(res.metadata.styles.line.color === 'ff0000ff', 'Line color must be ff0000ff (red in KML)');

    // 4. ExtendedData parsed correctly
    assert(res.metadata.extendedData.reference === 'RP4022', 'ExtendedData reference extracted');
    assert(res.metadata.extendedData.infrastructure === 'Route', 'ExtendedData infrastructure extracted');

    // 5. Folder preserved
    assert(res.metadata.folders.includes('Dossier_QGIS_Test'), 'Folder hierarchy preserved');

    // 6. Geometry valid
    assert(res.geometry.type === 'LineString', 'Geometry is LineString');
    assert(res.geometry.coordinates.length === 3, 'Contains 3 vertices');
  });

  // --- Test AC (L2): Inline Style Leaflet Color Resolution ---
  test('Test AC (L2) — Inline Style resolution converts KML hex to Leaflet color properly', () => {
    const qgisKml = `<?xml version="1.0" encoding="utf-8" ?>
    <kml xmlns="http://www.opengis.net/kml/2.2">
      <Placemark>
        <name>Ligne Verte</name>
        <Style><LineStyle><color>ff00ff00</color><width>5</width></LineStyle></Style>
        <LineString>
          <coordinates>-5.8918,35.7343 -5.8898,35.7342</coordinates>
        </LineString>
      </Placemark>
    </kml>`;

    const res = kmlService.parseKmlToGeoJson(qgisKml);
    assert(res.metadata.styles.line.color === 'ff00ff00', 'Inline color extracted');
    assert(res.metadata.styles.line.width === 5, 'Inline width extracted');

    const leafletStyle = kmlService.resolveKmlLeafletStyle(res.metadata.styles);
    assert(leafletStyle.color === '#00ff00', 'Leaflet color is green #00ff00');
    assert(leafletStyle.opacity === 1.0, 'Leaflet opacity is 1.0');
    assert(leafletStyle.weight === 5, 'Leaflet weight is 5');
  });

  // --- Test AD (L2): Standard name takes precedence over SimpleData kml_name ---
  test('Test AD (L2) — Direct Placemark name takes precedence over SimpleData kml_name', () => {
    const kml = `<?xml version="1.0" encoding="utf-8" ?>
    <kml xmlns="http://www.opengis.net/kml/2.2">
      <Placemark>
        <name>Nom Direct Placemark</name>
        <ExtendedData>
          <SchemaData schemaUrl="#s">
            <SimpleData name="kml_name">Nom Fallback Ignore</SimpleData>
          </SchemaData>
        </ExtendedData>
        <LineString>
          <coordinates>-5.8918,35.7343 -5.8898,35.7342</coordinates>
        </LineString>
      </Placemark>
    </kml>`;

    const res = kmlService.parseKmlToGeoJson(kml);
    assert(res.properties.name === 'Nom Direct Placemark', 'Direct name preserved');
    assert(res.metadata.name === 'Nom Direct Placemark', 'Metadata name matches direct name');
  });

  // --- Test AE: Real Tangier railway Multi-LineString KML loads without rejection ---
  test('Test AE — Real Tangier railway Multi-LineString KML (RailWayTangier_Second.kml)', () => {
    const kmlPath = path.join(__dirname, '../../RailWayTangier_Second.kml');
    if (!fs.existsSync(kmlPath)) {
      console.log('   ⚠️ Skipping Test AE: RailWayTangier_Second.kml not found');
      return;
    }
    const content = fs.readFileSync(kmlPath, 'utf8');
    const res = kmlService.parseKmlToGeoJson(content);
    assert(res.type === 'FeatureCollection', 'Must return FeatureCollection');
    assert(Array.isArray(res.features), 'features must be array');
    assert(res.features.length >= 100, `Must detect >= 100 LineStrings, got ${res.features.length}`);
    assert(res.properties.feature_count === res.features.length, 'feature_count matches');
    assert(res.features[0].geometry.type === 'LineString', 'Feature geometry is LineString');
    assert(res.features[0].properties.name, 'Feature 0 has name');
  });

  // --- Test AF: 2-4 LineStrings KML preserves individual features and metadata ---
  test('Test AF — 3 LineStrings KML preserves individual identities without merge', () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
    <kml xmlns="http://www.opengis.net/kml/2.2">
      <Document>
        <name>Tracé 3 sections</name>
        <Placemark><name>Voie A</name><LineString><coordinates>-5.89,35.73 -5.88,35.74</coordinates></LineString></Placemark>
        <Placemark><name>Voie B</name><LineString><coordinates>-5.88,35.74 -5.87,35.75</coordinates></LineString></Placemark>
        <Placemark><name>Voie C</name><LineString><coordinates>-5.87,35.75 -5.86,35.76</coordinates></LineString></Placemark>
      </Document>
    </kml>`;
    const res = kmlService.parseKmlToGeoJson(kml);
    assert(res.type === 'FeatureCollection', 'Type must be FeatureCollection');
    assert(res.features.length === 3, 'Must contain 3 features');
    assert(res.features[0].properties.name === 'Voie A', 'Voie A name preserved');
    assert(res.features[1].properties.name === 'Voie B', 'Voie B name preserved');
    assert(res.features[2].properties.name === 'Voie C', 'Voie C name preserved');
    assert(res.features[0].id === 1, 'Feature 0 id is 1');
    assert(res.features[1].id === 2, 'Feature 1 id is 2');
    assert(res.features[2].id === 3, 'Feature 2 id is 3');
  });

  // --- Test AG: GroundOverlay with local companion image resolved via assetMap ---
  test('Test AG (L5) — GroundOverlay with local companion image resolved via assetMap', () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
    <kml xmlns="http://www.opengis.net/kml/2.2">
      <Document>
        <Placemark>
          <name>Axe Test</name>
          <LineString><coordinates>-5.89,35.73 -5.88,35.74</coordinates></LineString>
        </Placemark>
        <Folder>
          <name>Overlays</name>
          <GroundOverlay>
            <name>Plan Emprise Tanger</name>
            <Icon>
              <href>Test5_GroundOverlay.png</href>
            </Icon>
            <LatLonBox>
              <north>35.7500</north>
              <south>35.7300</south>
              <east>-5.8700</east>
              <west>-5.9000</west>
            </LatLonBox>
          </GroundOverlay>
        </Folder>
      </Document>
    </kml>`;

    const assetMap = {
      'Test5_GroundOverlay.png': '/uploads/geojson/test5_tangier_overlay.png'
    };

    const res = kmlService.parseKmlToGeoJson(kml, { assetMap });
    assert(res.metadata.groundOverlays, 'groundOverlays array exists');
    assert(res.metadata.groundOverlays.length === 1, 'Exactly 1 GroundOverlay parsed');
    const go = res.metadata.groundOverlays[0];
    assert(go.name === 'Plan Emprise Tanger', 'Name matches');
    assert(go.isAvailable === true, 'isAvailable must be true when companion image is in assetMap');
    assert(go.isSafe === true, 'isSafe must be true for sanitized path');
    assert(go.icon.href === '/uploads/geojson/test5_tangier_overlay.png', 'icon.href resolved to assetMap URL');
    assert(go.icon.originalHref === 'Test5_GroundOverlay.png', 'originalHref preserved');
    assert(go.latLonBox.north === 35.75, 'North bound correct');
    assert(go.latLonBox.south === 35.73, 'South bound correct');
  });

  // --- Test AH: GroundOverlay with remote HTTP/HTTPS image ---
  test('Test AH (L5) — GroundOverlay with remote HTTP/HTTPS image', () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
    <kml xmlns="http://www.opengis.net/kml/2.2">
      <Document>
        <Placemark>
          <name>Axe Test</name>
          <LineString><coordinates>-5.89,35.73 -5.88,35.74</coordinates></LineString>
        </Placemark>
        <GroundOverlay>
          <name>Remote Drone Map</name>
          <Icon>
            <href>https://server.domain.com/imagery/tangier_ortho.jpg</href>
          </Icon>
          <LatLonBox>
            <north>35.76</north>
            <south>35.74</south>
            <east>-5.85</east>
            <west>-5.88</west>
          </LatLonBox>
        </GroundOverlay>
      </Document>
    </kml>`;

    const res = kmlService.parseKmlToGeoJson(kml);
    assert(res.metadata.groundOverlays.length === 1, '1 GroundOverlay parsed');
    const go = res.metadata.groundOverlays[0];
    assert(go.isRemote === true, 'isRemote must be true');
    assert(go.isAvailable === true, 'isAvailable must be true for valid remote URL');
    assert(go.isSafe === true, 'isSafe must be true for HTTPS URL');
    assert(go.icon.href === 'https://server.domain.com/imagery/tangier_ortho.jpg', 'href preserved');
  });

  // --- Test AI: GroundOverlay with LatLonBox bounds, rotation and altitude ---
  test('Test AI (L5) — GroundOverlay with LatLonBox bounds, rotation and altitude', () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
    <kml xmlns="http://www.opengis.net/kml/2.2">
      <Document>
        <Placemark>
          <name>Axe Test</name>
          <LineString><coordinates>-5.89,35.73 -5.88,35.74</coordinates></LineString>
        </Placemark>
        <GroundOverlay>
          <name>Rotated Track Section</name>
          <altitude>25.5</altitude>
          <altitudeMode>relativeToGround</altitudeMode>
          <Icon>
            <href>ortho_track.png</href>
          </Icon>
          <LatLonBox>
            <north>35.7800</north>
            <south>35.7600</south>
            <east>-5.8200</east>
            <west>-5.8500</west>
            <rotation>-15.5</rotation>
          </LatLonBox>
        </GroundOverlay>
      </Document>
    </kml>`;

    const assetMap = { 'ortho_track.png': '/uploads/geojson/ortho_track.png' };
    const res = kmlService.parseKmlToGeoJson(kml, { assetMap });
    const go = res.metadata.groundOverlays[0];
    assert(go.altitude === 25.5, 'Altitude parsed');
    assert(go.altitudeMode === 'relativeToGround', 'altitudeMode parsed');
    assert(go.latLonBox.rotation === -15.5, 'Rotation parsed as float');
    assert(go.latLonBox.north === 35.78, 'North bound parsed');
    assert(go.latLonBox.south === 35.76, 'South bound parsed');
    assert(go.latLonBox.east === -5.82, 'East bound parsed');
    assert(go.latLonBox.west === -5.85, 'West bound parsed');
  });

  // --- Test AJ: GroundOverlay without image / empty href (graceful fallback) ---
  test('Test AJ (L5) — GroundOverlay without image or unavailable local href', () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
    <kml xmlns="http://www.opengis.net/kml/2.2">
      <Document>
        <Placemark>
          <name>Axe Test</name>
          <LineString><coordinates>-5.89,35.73 -5.88,35.74</coordinates></LineString>
        </Placemark>
        <GroundOverlay>
          <name>Overlay Without Asset</name>
          <Icon>
            <href>missing_image.png</href>
          </Icon>
          <LatLonBox>
            <north>35.74</north>
            <south>35.72</south>
            <east>-5.86</east>
            <west>-5.89</west>
          </LatLonBox>
        </GroundOverlay>
      </Document>
    </kml>`;

    // No assetMap provided
    const res = kmlService.parseKmlToGeoJson(kml);
    assert(res.metadata.groundOverlays.length === 1, 'GroundOverlay parsed');
    const go = res.metadata.groundOverlays[0];
    assert(go.isAvailable === false, 'isAvailable is false when no companion asset provided');
    assert(go.latLonBox !== null, 'LatLonBox bounds still available for footprint fallback');
    assert(res.metadata.warnings.some(w => w.includes('non disponible localement')), 'Warning logged for missing companion asset');
  });

  // --- Test AK: Path traversal strictly rejected even with assetMap ---
  test('Test AK (L5) — Path traversal <href>../../etc/passwd</href> is strictly rejected', () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
    <kml xmlns="http://www.opengis.net/kml/2.2">
      <Document>
        <Placemark>
          <name>Axe Test</name>
          <LineString><coordinates>-5.89,35.73 -5.88,35.74</coordinates></LineString>
        </Placemark>
        <GroundOverlay>
          <name>Malicious Overlay</name>
          <Icon>
            <href>../../../../etc/passwd</href>
          </Icon>
          <LatLonBox>
            <north>35.74</north>
            <south>35.72</south>
            <east>-5.86</east>
            <west>-5.89</west>
          </LatLonBox>
        </GroundOverlay>
      </Document>
    </kml>`;

    const assetMap = { '../../../../etc/passwd': '/evil' };
    const res = kmlService.parseKmlToGeoJson(kml, { assetMap });
    const go = res.metadata.groundOverlays[0];
    assert(go.isSafe === false, 'isSafe must be false for path traversal');
    assert(go.isAvailable === false, 'isAvailable must be false for unsafe asset');
    assert(go.icon.href === null, 'href must be set to null when rejected');
  });

  // --- Test AL: Multiple GroundOverlays independently resolved ---
  test('Test AL (L5) — Multiple GroundOverlays independently resolved', () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
    <kml xmlns="http://www.opengis.net/kml/2.2">
      <Document>
        <Placemark>
          <name>Axe Test</name>
          <LineString><coordinates>-5.89,35.73 -5.88,35.74</coordinates></LineString>
        </Placemark>
        <Folder>
          <GroundOverlay>
            <name>Sector 1</name>
            <Icon><href>sector1.png</href></Icon>
            <LatLonBox><north>35.75</north><south>35.74</south><east>-5.88</east><west>-5.89</west></LatLonBox>
          </GroundOverlay>
          <GroundOverlay>
            <name>Sector 2</name>
            <Icon><href>sector2.jpg</href></Icon>
            <LatLonBox><north>35.74</north><south>35.73</south><east>-5.88</east><west>-5.89</west></LatLonBox>
          </GroundOverlay>
          <GroundOverlay>
            <name>Sector 3 (Missing)</name>
            <Icon><href>sector3.png</href></Icon>
            <LatLonBox><north>35.73</north><south>35.72</south><east>-5.88</east><west>-5.89</west></LatLonBox>
          </GroundOverlay>
        </Folder>
      </Document>
    </kml>`;

    const assetMap = {
      'sector1.png': '/uploads/geojson/sector1.png',
      'sector2.jpg': '/uploads/geojson/sector2.jpg'
    };

    const res = kmlService.parseKmlToGeoJson(kml, { assetMap });
    assert(res.metadata.groundOverlays.length === 3, 'All 3 GroundOverlays parsed');
    assert(res.metadata.groundOverlays[0].isAvailable === true, 'Sector 1 resolved');
    assert(res.metadata.groundOverlays[1].isAvailable === true, 'Sector 2 resolved');
    assert(res.metadata.groundOverlays[2].isAvailable === false, 'Sector 3 marked unavailable');
  });

  // --- Test AM: 3D coordinates and bounding box dimensions calculation for Three.js plane ---
  test('Test AM (L5) — 3D coordinates and bounding box dimensions calculation for Three.js plane', () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
    <kml xmlns="http://www.opengis.net/kml/2.2">
      <Document>
        <Placemark>
          <name>Axe Test</name>
          <LineString><coordinates>-5.89,35.73 -5.88,35.74</coordinates></LineString>
        </Placemark>
        <GroundOverlay>
          <name>Plane Sizing Test</name>
          <Icon><href>plane_test.png</href></Icon>
          <LatLonBox>
            <north>35.7500</north>
            <south>35.7400</south>
            <east>-5.8800</east>
            <west>-5.8950</west>
          </LatLonBox>
        </GroundOverlay>
      </Document>
    </kml>`;

    const res = kmlService.parseKmlToGeoJson(kml);
    const go = res.metadata.groundOverlays[0];
    const b = go.latLonBox;

    // Simulation of toEnu conversion at lat0=35.745, lon0=-5.8875
    const R = 6378137.0;
    const rad = Math.PI / 180.0;
    const lat0Rad = 35.745 * rad;

    const toEnuSim = (lon, lat) => ({
      x: R * (lon - (-5.8875)) * rad * Math.cos(lat0Rad),
      z: -R * (lat - 35.745) * rad
    });

    const sw = toEnuSim(b.west, b.south);
    const ne = toEnuSim(b.east, b.north);
    const width = Math.abs(ne.x - sw.x);
    const depth = Math.abs(ne.z - sw.z);

    assert(width > 1000 && width < 2000, `Width in meters should be ~1350m, got ${width.toFixed(1)}m`);
    assert(depth > 1000 && depth < 1200, `Depth in meters should be ~1110m, got ${depth.toFixed(1)}m`);
    assert(sw.z > ne.z, 'South has positive Z in ENU, North has negative Z');
  });

  console.log(`\nResults: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

runTests();
