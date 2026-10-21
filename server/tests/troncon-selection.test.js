'use strict';
/* global __dirname */
// Run: node server/tests/troncon-selection.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const source3 = fs.readFileSync(path.join(root, 'components/gis/InteractiveGis3DMap.tsx'), 'utf8');
const source2 = fs.readFileSync(path.join(root, 'components/gis/InteractiveGisMap.tsx'), 'utf8');
// Non-origin coordinates expose scaling about the scene origin.
const troncons = [
  {id:1,geometry:{type:'LineString',coordinates:[[101,201],[111,211]]}},
  {id:2,geometry:{type:'LineString',coordinates:[[111,211],[121,221]]}},
  {id:3,geometry:{type:'LineString',coordinates:[[121,221],[131,231]]}},
];
const snapshot = JSON.stringify(troncons);
const immutableTransform = () => { throw new Error('Selection must not transform geometry'); };
class Vector { constructor(x,y,z){Object.assign(this,{x,y,z});} }
class Mesh {
  constructor(geometry,material){
    Object.assign(this,{geometry,material});
    this.scale={x:1,y:1,z:1,set:immutableTransform};
    this.position={x:0,y:0,z:0,set:immutableTransform};
    this.rotation={x:0,y:0,z:0,set:immutableTransform};
  }
}
const creationStart = source3.indexOf('      // 8. Tronçons Découpés');
const creationEnd = source3.indexOf('            // Boundary separators', creationStart);
const creation = source3.slice(creationStart,creationEnd) + '\n          }\n        }\n      }';
const selection = source3.slice(source3.indexOf('      function setTronconSelected(id, notify)'),source3.indexOf('      // 13. Raycasting'));
for (const selectedId of [2,3]) {
  const meshes=[];
  let selected,cleared=false;
  const context={
    CONFIG:{troncons,palette:['#123456'],kmlGeometry:{coordinates:[[101,201],[111,211],[121,221],[131,231]]},kmlMetadata:{hasAltitude:true,altitudeCoordinates:[[101,201,0],[111,211,0],[121,221,0],[131,231,0]]}},hasTroncons:true,currentSelectedTronconId:String(selectedId),
    extractCoords:g=>g?.coordinates,toEnu:(x,z,y)=>new Vector(x,y,z),
    THREE:{CurvePath:class{constructor(){this.points=[];}add(line){if(!this.points.length)this.points.push(line.points[0]);this.points.push(line.points[1]);}},Color:class{},LineCurve3:class{constructor(a,b){this.points=[a,b];}},
      TubeGeometry:class{constructor(curve){this.points=curve.points;}},MeshStandardMaterial:class{constructor(options){Object.assign(this,options);}},Mesh},
    groupTroncons:{add:mesh=>meshes.push(mesh)},interactiveTroncons:[],
    dispatchSelection:data=>selected=data,dispatchClearSelection:()=>cleared=true,
  };
  vm.createContext(context);
  const helpers=source3.slice(source3.indexOf('      function gisLineCurve(points)'),source3.indexOf('      // 2. Setup Three.js'));
  vm.runInContext(helpers,context);
  vm.runInContext(creation,context);vm.runInContext(selection,context);
  const positions=JSON.stringify(meshes.map(m=>m.geometry.points));
  function verify() {
    assert.equal(JSON.stringify(meshes.map(m=>m.geometry.points)),positions);
    for(const mesh of meshes){assert.equal(mesh.scale.x,1);assert.equal(mesh.position.x,0);}
    for(let i=1;i<meshes.length;i++)assert.deepEqual(meshes[i-1].geometry.points[1],meshes[i].geometry.points[0]);
  }
  verify();assert.equal(meshes[selectedId-1].material.emissiveIntensity,0.85);
  assert(meshes.every(mesh=>mesh.geometry.points.every(point=>point.y===0)),'tronçons follow source altitude, without artificial lift');
  const bent=[new Vector(10,0,10),new Vector(20,0,30),new Vector(40,0,20)];
  assert.deepEqual(context.gisLineCurve(bent).points,bent,'authoritative vertices remain piecewise linear');
  context.CONFIG.kmlMetadata.altitudeCoordinates=[[101,201,0],[111,211,10],[121,221,20],[131,231,30]];
  assert.equal(context.tronconLineAltitude(116,216),15,'source altitude interpolates at clipped endpoints');
  context.CONFIG.kmlMetadata.hasAltitude=false;assert.equal(context.tronconLineAltitude(116,216),1.4);
  context.CONFIG.kmlGeometry=null;assert.equal(context.tronconLineAltitude(116,216),0.8);
  const incoming=source3.slice(source3.indexOf('      function handleIncomingLayerMessage(event)'),source3.indexOf("      window.addEventListener('message', handleIncomingLayerMessage)"));
  vm.runInContext(incoming,context);
  context.handleIncomingLayerMessage({data:{type:'SET_TRONCON_SELECTION',id:null}});verify();
  assert(meshes.every(mesh=>mesh.material.emissiveIntensity===0.35));
  context.handleIncomingLayerMessage({data:JSON.stringify({type:'SET_TRONCON_SELECTION',id:selectedId})});verify();
  assert.equal(meshes[selectedId-1].material.emissiveIntensity,0.85);
  context.setTronconSelected(selectedId,true);verify();assert.equal(selected.id,selectedId);
  context.setTronconSelected(null,true);verify();assert(cleared);
  assert(meshes.every(mesh=>mesh.material.emissiveIntensity===0.35));
  context.setTronconSelected(selectedId,true);verify();
  console.log('3D: initial selection, select/deselect/reselect preserve connected endpoints for tronçon '+selectedId);
}

// Execute the actual 2D halo/casing/main-line creation, stopping before progress/PK labels.
const start2=source2.indexOf('      // Render Tronçons (Linear Referencing)');
const end2=source2.indexOf('          // 4. Subtle inner progress line',start2);
const render2=source2.slice(start2,end2)+'\n        });\n      }';
for(const selectedId of [2,3,null]) {
  const layers=[];
  const context={rawTroncons:troncons,selectedId,colors:['#123456'],featureGroup:{},sendToParent(){},
    L:{geoJSON:(feature,options)=>{
      const layer={feature,options,addTo(){layers.push(this);return this;},on(){return this;},setLatLngs:immutableTransform};return layer;
    }},
  };
  vm.runInNewContext(render2,context);
  const main=layers.filter(layer=>layer.feature.properties);
  assert.equal(main.length,3);
  for(let i=0;i<3;i++)assert.equal(main[i].feature.geometry,troncons[i].geometry);
  if(selectedId) {
    const halo=layers.find(layer=>layer.options.style.weight===15);
    assert.equal(halo.feature.geometry,troncons[selectedId-1].geometry);
    assert.equal(main[selectedId-1].options.style.weight,7);
  } else assert(!layers.some(layer=>layer.options.style.weight===15));
  for(let i=1;i<main.length;i++)assert.deepEqual(main[i-1].feature.geometry.coordinates[1],main[i].feature.geometry.coordinates[0]);
  console.log('2D: exact input geometry and coincident halo preserved; selection='+selectedId);
}
assert.equal(JSON.stringify(troncons),snapshot,'input geometry/data remains unchanged');
console.log('All tronçon selection continuity checks passed.');
