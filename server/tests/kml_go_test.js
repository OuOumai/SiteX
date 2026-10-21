const { parseKmlToGeoJson } = require('../src/services/kml.service.js');
const kml = `<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Folder><name>T</name><GroundOverlay><name>RailWay_Tangier</name><Icon><href>images.jpg</href></Icon><LatLonBox><north>35.74228</north><south>35.74142</south><east>-5.79007</east><west>-5.79111</west></LatLonBox></GroundOverlay></Folder></Document></kml>`;
const r = parseKmlToGeoJson(kml, {});
const go = r.metadata.groundOverlays[0];
console.log(JSON.stringify({name:go.name,href:go.icon.href,origHref:go.icon.originalHref,isAvailable:go.isAvailable,isSafe:go.isSafe,isRemote:go.isRemote,warning:go.securityWarning,latLonBox:go.latLonBox,time:go.time},null,2));
