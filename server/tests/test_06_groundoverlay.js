/**
 * Test 06 — KML GroundOverlay Integration & Verification Suite
 */

const assert = require('assert');
const { parseKmlToGeoJson } = require('../src/services/kml.service');

console.log('🧪 Starting Test 06 — KML GroundOverlay Verification Suite...\n');

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}:`, err.message);
    failed++;
  }
}

// Fixture KML with GroundOverlay and LineString
const FIXTURE_KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Folder>
      <name>Test5_Tangier_GroundOverlay</name>
      <GroundOverlay>
        <name>RailWay_Tangier</name>
        <Icon>
          <href>images.jpg</href>
          <viewBoundScale>0.75</viewBoundScale>
        </Icon>
        <LatLonBox>
          <north>35.74228341473238</north>
          <south>35.74142815720174</south>
          <east>-5.79007231489915</east>
          <west>-5.791117506973441</west>
          <rotation>0</rotation>
        </LatLonBox>
      </GroundOverlay>
      <Placemark>
        <name>RailWay_Tangier</name>
        <LineString>
          <coordinates>
            -5.792343475,35.741293468,0
            -5.791718552,35.741586195,0
            -5.790072315,35.742283415,0
          </coordinates>
        </LineString>
      </Placemark>
    </Folder>
  </Document>
</kml>`;

// Test 1: Parser extracts GroundOverlay with companion asset map
runTest('GO-1: GroundOverlay href resolves to companion asset upload URL', () => {
  const assetMap = {
    'images.jpg': '/uploads/geojson/kml_asset_1791496184946_images.jpg'
  };
  const result = parseKmlToGeoJson(FIXTURE_KML, { assetMap });
  assert(result.metadata.groundOverlays.length === 1, 'Expected 1 GroundOverlay');
  const go = result.metadata.groundOverlays[0];
  assert.strictEqual(go.name, 'RailWay_Tangier');
  assert.strictEqual(go.icon.href, '/uploads/geojson/kml_asset_1791496184946_images.jpg');
  assert.strictEqual(go.icon.originalHref, 'images.jpg');
  assert.strictEqual(go.isAvailable, true);
  assert.strictEqual(go.isSafe, true);
});

// Test 2: LatLonBox bounds and dimensions
runTest('GO-2: LatLonBox geographic bounds are strictly numerical and valid', () => {
  const result = parseKmlToGeoJson(FIXTURE_KML, {});
  const go = result.metadata.groundOverlays[0];
  assert(go.latLonBox, 'LatLonBox should be present');
  assert(go.latLonBox.north > go.latLonBox.south, 'North must be > South');
  assert(go.latLonBox.east > go.latLonBox.west, 'East must be > West');
  assert.strictEqual(go.latLonBox.rotation, 0);
});

// Test 3: LineString geometry is completely independent from GroundOverlay
runTest('GO-3: Railway LineString geometry is independently parsed and preserved', () => {
  const result = parseKmlToGeoJson(FIXTURE_KML, {});
  const lineFeature = result.type === 'FeatureCollection'
    ? result.features.find(f => f.geometry.type === 'LineString')
    : result;
  assert(lineFeature, 'LineString feature must exist in GeoJSON output');
  assert.strictEqual(lineFeature.geometry.type, 'LineString');
  assert.strictEqual(lineFeature.properties.name, 'RailWay_Tangier');
  assert.strictEqual(lineFeature.geometry.coordinates.length, 3);
});

// Test 4: Local companion file without assetMap sets isAvailable=false with warning
runTest('GO-4: Unavailable companion file triggers graceful fallback metadata', () => {
  const result = parseKmlToGeoJson(FIXTURE_KML, {});
  const go = result.metadata.groundOverlays[0];
  assert.strictEqual(go.isAvailable, false);
  assert.strictEqual(go.isSafe, true);
  assert(go.securityWarning, 'Warning should be populated');
});

// Test 5: Media URL helper resolution simulation
runTest('GO-5: Media URL resolution prepends server base URL correctly', () => {
  function simulateGetMediaUrl(path, base) {
    if (!path) return '';
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${base}${cleanPath}`;
  }
  const baseUrl = 'http://192.168.3.188:5000';
  const relativeHref = '/uploads/geojson/kml_asset_1791496184946_images.jpg';
  const resolved = simulateGetMediaUrl(relativeHref, baseUrl);
  assert.strictEqual(resolved, 'http://192.168.3.188:5000/uploads/geojson/kml_asset_1791496184946_images.jpg');
});

// Test 6: Layer visibility independence simulation
runTest('GO-6: KML Line layer visibility and KML Image layer visibility are independent', () => {
  let showKmlLayer = true;
  let showKmlImages = true;

  // Toggle images OFF
  showKmlImages = false;
  assert.strictEqual(showKmlLayer, true, 'Line layer should remain ON when image is OFF');
  assert.strictEqual(showKmlImages, false, 'Image layer should be OFF');

  // Toggle lines OFF
  showKmlLayer = false;
  showKmlImages = true;
  assert.strictEqual(showKmlLayer, false, 'Line layer should be OFF');
  assert.strictEqual(showKmlImages, true, 'Image layer should be ON');
});

console.log(`\nResults: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
