/**
 * server/test_geoapify.js
 *
 * Verifies Geoapify Address Autocomplete API response.
 */
'use strict';

require('dotenv').config();

const API_KEY = process.env.EXPO_PUBLIC_GEOAPIFY_API_KEY;

async function testGeoapify() {
  console.log('🧪 Testing Geoapify Address Autocomplete API...');
  console.log('  Key present:', Boolean(API_KEY));

  if (!API_KEY) {
    console.error('❌ API key EXPO_PUBLIC_GEOAPIFY_API_KEY is missing!');
    process.exit(1);
  }

  const query = 'Avenue Mohammed';
  const url = `https://api.geoapify.com/v1/geocode/autocomplete?text=${encodeURIComponent(query)}&lang=fr&limit=5&apiKey=${API_KEY}`;

  try {
    const res = await fetch(url);
    console.log('  ✓ HTTP Status:', res.status);
    const data = await res.json();

    if (res.status === 200 && data.features && data.features.length > 0) {
      console.log(`🎉 GEOAPIFY SUCCESS! Found ${data.features.length} address suggestions:`);
      data.features.forEach((f, i) => {
        const p = f.properties;
        console.log(`   [${i + 1}] ${p.formatted}`);
        console.log(`       City: ${p.city || p.town || 'N/A'}, Postcode: ${p.postcode || 'N/A'}, Lat: ${p.lat}, Lon: ${p.lon}`);
      });
    } else {
      console.error('❌ Failed or zero results returned:', data);
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ Error during fetch:', err);
    process.exit(1);
  }
}

testGeoapify();
