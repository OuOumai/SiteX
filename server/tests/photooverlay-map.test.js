'use strict';
/* global __dirname */
// Run: node server/tests/photooverlay-map.test.js
// Uses actual controller and TSX components; database/native surfaces are isolated doubles.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const { parseKmlToGeoJson } = require('../src/services/kml.service');
const kml = `<kml><Document><Placemark><LineString><coordinates>-5.791,35.741,0 -5.790,35.742,0</coordinates></LineString></Placemark><PhotoOverlay><name>RailWay_Tangier_Photo</name><Icon><href>images.jpg</href></Icon><Camera><longitude>-5.7905</longitude><latitude>35.7415</latitude><altitude>15</altitude><heading>30</heading><tilt>10</tilt><roll>5</roll></Camera></PhotoOverlay><GroundOverlay><Icon><href>images.jpg</href></Icon><LatLonBox><north>35.742</north><south>35.741</south><east>-5.790</east><west>-5.791</west></LatLonBox></GroundOverlay></Document></kml>`;
const parsed = parseKmlToGeoJson(kml, { assetMap: { 'images.jpg': '/uploads/geojson/images.jpg' } });
const photo = parsed.metadata.photoOverlays[0];
assert.equal(photo.name, 'RailWay_Tangier_Photo');
assert.deepEqual(photo.position, [-5.7905, 35.7415]);
assert.deepEqual([photo.altitude, photo.heading, photo.tilt, photo.roll], [15,30,10,5]);
assert.equal(photo.icon.href, '/uploads/geojson/images.jpg');
console.log('A: actual parser retains photo coordinates, orientation and companion href');

function compile(file, mocks, typescript = false) {
  const filename = path.join(root, file);
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = mod.require.bind(mod);
  mod.require = (id) => Object.hasOwn(mocks, id) ? mocks[id] : original(id);
  let source = fs.readFileSync(filename, 'utf8');
  if (typescript) source = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS, jsx:ts.JsxEmit.React, esModuleInterop:true}}).outputText;
  mod._compile(source, filename);
  return mod.exports;
}
async function main() {
  let saved;
  const controller = compile('server/src/controllers/chantier.controller.js', {
    '../db': { query: async (sql, args) => {
      if (sql.includes('SELECT id, nom')) return {rows:[{id:1,nom:'Test'}]};
      if (sql.includes('WITH raw_input')) return {rows:[{geom_type:'ST_LineString',length_meters:100,geometry:parsed.geometry,original_geometry:parsed.geometry}]};
      if (sql.includes('INSERT INTO public.reference_alignment')) {
        assert(sql.includes('kml_metadata'));
        saved = {id:1,chantier_id:1,source:args[2],original_filename:args[3],geometry:JSON.parse(args[4]),kml_metadata:JSON.parse(args[8])};
        return {rows:[JSON.parse(JSON.stringify(saved))]};
      }
      assert(sql.includes('kml_metadata') && sql.includes('FROM public.reference_alignment'));
      return {rows:[JSON.parse(JSON.stringify(saved))]};
    }}
  });
  const response=()=>({code:200,status(n){this.code=n;return this;},json(data){this.data=data;return this;}});
  let res=response();
  await controller.uploadReferenceAlignment({params:{chantierId:1},body:{source:'KML',geometry:parsed.geometry,source_srid:4326,source_crs_name:'WGS 84',kml_metadata:parsed.metadata}},res);
  assert.equal(res.code,201, JSON.stringify(res.data));
  assert.deepEqual(saved.kml_metadata, parsed.metadata);
  res=response(); await controller.getReferenceAlignment({params:{chantierId:1}},res);
  const reloaded=res.data.reference_alignment;
  assert.deepEqual(reloaded.kml_metadata.photoOverlays,[photo]);
  assert.deepEqual(reloaded.kml_metadata.groundOverlays,parsed.metadata.groundOverlays);
  console.log('B/C/G: actual save/reload controllers preserve complete metadata across a serialized database boundary (mock DB)');

  let states=[], cursor=0;
  const React={createElement:(type,props,...children)=>({type,props:{...props,children}}),Fragment:'Fragment',
    useState(initial){const i=cursor++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return [states[i],v=>states[i]=typeof v==='function'?v(states[i]):v];},
    useMemo:f=>f(),useCallback:f=>f,useRef:v=>({current:v}),useEffect:()=>{},useImperativeHandle:()=>{}};
  const native={StyleSheet:{create:x=>x},Platform:{OS:'web'},useWindowDimensions:()=>({width:1200,height:800})};
  for(const n of ['View','Modal','Image','ScrollView','TouchableOpacity','ActivityIndicator','TouchableWithoutFeedback']) native[n]=n;
  const api={getMediaUrl:s=>s?.startsWith('http')?s:'http://localhost:5000'+s,API_URL:'http://localhost:5000'};
  const kmlHelpers=compile('lib/kmlPanorama.ts',{},true);
  const common={'@/lib/kmlPanorama':kmlHelpers,'react':React,'react-native':native,'@/services/api':api,'@/constants/theme':{Palette:{}},'@/components/ui/text':{Text:'Text'},'@/components/ui/button':{Button:'Button'},'@expo/vector-icons':{Ionicons:'Ionicons'},'react-native-webview':{WebView:'WebView'},'@/lib/temporal':{isKmlElementVisible:()=>true},'./leafletAssets':{LEAFLET_CSS:'',LEAFLET_JS:''}};
  const two=compile('components/gis/InteractiveGisMap.tsx',common,true);
  const three=compile('components/gis/InteractiveGis3DMap.tsx',{...common,'./InteractiveGisMap':two},true);
  const panorama=compile('components/gis/KmlPanoramaViewer.tsx',common,true);
  const modal=compile('components/gis/KmlImageModal.tsx',{...common,'./KmlPanoramaViewer':panorama},true);
  const mocks={...common,'@/components/gis/InteractiveGisMap':two,'@/components/gis/InteractiveGis3DMap':three,'@/components/gis/KmlImageModal':modal,'react-native-safe-area-context':{SafeAreaView:'SafeAreaView'},'expo-router':{useLocalSearchParams:()=>({}),useRouter:()=>({})},'@/hooks/useAuth':{useAuth:()=>({user:{role_id:2},token:'test'})}};
  for(const [file,name] of [['map/MapDesktopPanel','MapDesktopPanel'],['map/MapMonitoringSheet','MapMonitoringSheet'],['map/StationDetailModal','StationDetailModal'],['map/ProjectMapSearch','ProjectMapSearch'],['navigation/SiteXHeader','SiteXHeader']])mocks['@/components/'+file]={[name]:name};
  const screen=compile('app/(tabs)/map.tsx',mocks,true).default;
  function find(tree,predicate){if(!tree||typeof tree!=='object')return null;if(predicate(tree))return tree;for(const child of [tree.props?.children, tree.props?.rightContent].flat(Infinity)){const found=find(child,predicate);if(found)return found;}return null;}
  const render=()=>{cursor=0;return screen();};
  render();
  states[0]={projects:[{id:1}],chantiers:[{id:1,projet_id:1}]}; states[2]=1;states[3]=1;states[5]=reloaded;states[8]=false;
  assert.equal(states[17],false,'Images KML defaults OFF');
  for(const mode of ['2d','3d']) {
    states[17]=false;
    states[15]=mode;
    let tree=render();
    const map=find(tree,n=>n.type===(mode==='2d'?two.InteractiveGisMap:three.InteractiveGis3DMap));
    assert(map,mode+' normal map mounted');
    assert.equal(map.props.showKmlImages,false,mode+' starts OFF');
    assert.equal(map.props.showKmlImagesControl,false,'one common control replaces internal control');
    const control=find(tree,n=>n.props?.accessibilityLabel==='KML');
    const header=find(tree,n=>n.type==='SiteXHeader');
    assert.equal(find(header.props.rightContent,n=>n.props?.accessibilityLabel==='KML'),control,'KML belongs to the mode-selector header');
    assert.equal(find(tree,n=>n.props?.accessibilityLabel==='Images KML'),null,'no floating KML control');
    assert.equal(control.props.accessibilityState.checked,false);
    control.props.onPress();
    const enabled=find(render(),n=>n.type===(mode==='2d'?two.InteractiveGisMap:three.InteractiveGis3DMap));
    assert.equal(enabled.props.showKmlImages,true,mode+' common control enables layer');
    find(render(),n=>n.props?.accessibilityLabel==='KML').props.onPress();
    assert.equal(find(render(),n=>n.type===enabled.type).props.showKmlImages,false,mode+' common control hides layer');
    assert.deepEqual(map.props.kmlPhotoOverlays,[photo]);
    assert.deepEqual(map.props.kmlGroundOverlays,parsed.metadata.groundOverlays);
    map.props.onSelectKmlImage(photo);
    tree=render();const viewer=find(tree,n=>n.type===modal.KmlImageModal);
    assert.equal(viewer.props.visible,true);assert.equal(viewer.props.selectedKmlImage,photo);
    cursor=0;const content=modal.KmlImageModal(viewer.props);
    const image=find(content,n=>n.type==='Image');assert.equal(image.props.source.uri,'http://localhost:5000/uploads/geojson/images.jpg');
    viewer.props.onClose();assert.equal(states[16],null);
    console.log(mode+': normal MapScreen passes reloaded images and selection opens the shared existing viewer');
  }
  // Project-wide view retains metadata even with no selected chantier.
  states[3]=null;states[5]=null;states[6]=[{id:1,source:'KML',geometry:parsed.geometry,kml_metadata:reloaded.kml_metadata}];
  const projectMap=find(render(),n=>n.type===three.InteractiveGis3DMap);
  assert.deepEqual(projectMap.props.kmlPhotoOverlays,[photo]);
  states[6]=[];assert.deepEqual(find(render(),n=>n.type===three.InteractiveGis3DMap).props.kmlPhotoOverlays,[]);
  console.log('Project-wide and empty-project image scope verified');

  // Source isolation takes precedence even over KML-looking properties/filenames.
  states[3]=1;states[5]={...reloaded,source:'GeoJSON',original_filename:'injected.kml'};
  for(const mode of ['2d','3d']) {
    states[15]=mode;
    const geoTree=render();
    const geoMap=find(geoTree,n=>n.type===(mode==='2d'?two.InteractiveGisMap:three.InteractiveGis3DMap));
    assert.deepEqual(geoMap.props.kmlPhotoOverlays,[]);
    assert.deepEqual(geoMap.props.kmlGroundOverlays,[]);
    assert.equal(find(geoTree,n=>n.props?.accessibilityLabel==='KML'),null,'GeoJSON has no KML button');
  }
  const savedStates=states;
  for(const [Component,key] of [[two.InteractiveGisMap,'rawKmlPhotoOverlays'],[three.InteractiveGis3DMap,'kmlPhotoOverlays']]) {
    states=[];cursor=0;
    const isolated=Component({kmlSourceFormat:'GeoJSON',kmlMetadata:parsed.metadata,kmlPhotoOverlays:[photo],kmlGroundOverlays:parsed.metadata.groundOverlays});
    const iframe=find(isolated,n=>n.type==='iframe');
    assert(iframe.props.srcDoc.includes('"'+key+'":[]'),'renderer rejects KML-like overlays from GeoJSON');
  }
  states=savedStates;
  const spherical=parseKmlToGeoJson(kml.replace('<PhotoOverlay>','<PhotoOverlay><shape>sphere</shape>'),{assetMap:{'images.jpg':'/uploads/geojson/images.jpg'}}).metadata.photoOverlays[0];
  res=response();
  await controller.uploadReferenceAlignment({params:{chantierId:1},body:{source:'KML',original_filename:'panorama.kml',geometry:parsed.geometry,source_srid:4326,source_crs_name:'WGS 84',kml_metadata:{...parsed.metadata,photoOverlays:[spherical]}}},res);
  assert.equal(res.code,201);
  res=response();await controller.getReferenceAlignment({params:{chantierId:1}},res);
  assert.equal(res.data.reference_alignment.source,'KML');
  const persistedSphere=res.data.reference_alignment.kml_metadata.photoOverlays[0];
  assert(kmlHelpers.isKmlPanoramaEligible('KML',persistedSphere,4096,2048));
  assert(!kmlHelpers.isKmlPanoramaEligible('GeoJSON',persistedSphere,4096,2048));
  assert(!kmlHelpers.isKmlPanoramaEligible('KML',photo,4096,2048),'ordinary 2:1 crop is not sufficient');
  assert(!kmlHelpers.isKmlPanoramaEligible('KML',persistedSphere,4000,1500),'wide but not equirectangular');
  const mapState=states;
  states=[];
  const ficheProps={sourceFormat:'KML',selectedKmlImage:persistedSphere,visible:true,isKmlImagesVisible:true,onClose(){},onToggleImages(){}};
  const fiche=()=>{cursor=0;return modal.KmlImageModal(ficheProps);};
  let ficheTree=fiche();assert.equal(find(ficheTree,n=>n.props?.title==='Ouvrir en 360°'),null);
  find(ficheTree,n=>n.type==='Image').props.onLoad({nativeEvent:{source:{width:4096,height:2048}}});
  ficheTree=fiche();find(ficheTree,n=>n.props?.title==='Ouvrir en 360°').props.onPress();
  const immersive=find(fiche(),n=>n.type===panorama.KmlPanoramaViewer);assert(immersive);
  assert.equal(immersive.props.overlay,persistedSphere);
  const panoTree=panorama.KmlPanoramaViewer(immersive.props);
  assert(find(panoTree,n=>n.type==='iframe').props.srcDoc.includes('SphereGeometry'));
  find(panoTree,n=>n.props?.accessibilityLabel==='Fermer la vue 360°').props.onPress();
  assert(find(fiche(),n=>n.type==='Image'),'close returns to original fiche');
  assert.equal(modal.KmlImageModal({...ficheProps,sourceFormat:'GeoJSON'}),null);
  assert.equal(panorama.KmlPanoramaViewer({...immersive.props,sourceFormat:'GeoJSON'}),null);
  const html=panorama.createKmlPanoramaHtml('https://example.com/photo.jpg?x=</script>');
  assert(!html.includes('x=</script>'),'URL cannot break the script');
  const viewerScript=html.match(/<script>([\s\S]*?)<\/script>/)[1];
  new vm.Script(viewerScript);
  // Exercise the actual isolated viewer script, including sphere projection and gestures.
  const handlers={},panoButtons={status:{textContent:''},fullscreen:{}},textures=[];
  const panoCanvas={addEventListener:(name,fn)=>handlers[name]=fn,setPointerCapture(){}};
  let viewerCamera,viewerGeometry,viewerMaterial,disposed=false;
  class Camera {constructor(fov){this.fov=fov;viewerCamera=this;}updateProjectionMatrix(){}lookAt(){}}
  const viewerThree={Scene:class{add(){}},PerspectiveCamera:Camera,
    WebGLRenderer:class{constructor(){this.domElement=panoCanvas;}setPixelRatio(){}setSize(){}render(){}dispose(){disposed=true;}},
    SphereGeometry:class{constructor(){viewerGeometry=this;}scale(...v){this.mirror=v;}dispose(){}},
    MeshBasicMaterial:class{constructor(){viewerMaterial=this;}dispose(){}},Mesh:class{},
    TextureLoader:class{setCrossOrigin(){return this;}load(url,success){textures.push(url);success({dispose(){}});}},LinearFilter:1};
  const viewerEvents={};
  vm.runInNewContext(viewerScript,{THREE:viewerThree,document:{getElementById:id=>panoButtons[id],body:{appendChild(){}},documentElement:{}},innerWidth:800,innerHeight:600,devicePixelRatio:1,requestAnimationFrame:()=>1,cancelAnimationFrame(){},addEventListener:(name,fn)=>viewerEvents[name]=fn});
  assert.deepEqual(Array.from(viewerGeometry.mirror),[-1,1,1]);assert(viewerMaterial.map);
  assert.equal(textures.length,1,'uses one existing referenced image');
  handlers.wheel({preventDefault(){},deltaY:-100});assert(viewerCamera.fov<75);
  handlers.pointerdown({pointerId:1,clientX:0,clientY:0});handlers.pointerdown({pointerId:2,clientX:100,clientY:0});
  const previousFov=viewerCamera.fov;handlers.pointermove({pointerId:2,clientX:200,clientY:0});assert(viewerCamera.fov<previousFov);
  viewerEvents.beforeunload();assert(disposed,'viewer cleans up on close');
  states=mapState;
  console.log('KML-only panorama eligibility, persisted metadata, GeoJSON isolation and close-to-fiche verified');

  // Execute the existing renderer blocks, rather than duplicate their marker logic.
  let selected, marker;
  const mapSource=fs.readFileSync(path.join(root,'components/gis/InteractiveGisMap.tsx'),'utf8');
  const block2=mapSource.slice(mapSource.indexOf('          // B. PhotoOverlays'),mapSource.indexOf('          // Floating KML Images'));
  vm.runInNewContext(block2,{rawKmlPhotoOverlays:[photo],kmlImageLayerGroup:{},escapeHtml:s=>s,sendToParent:msg=>selected=msg,L:{divIcon:x=>x,marker:(position,options)=>{marker={position,options,addTo(){return this;},bindTooltip(){},on(event,fn){this.click=fn;}};return marker;},DomEvent:{stopPropagation(){}}}});
  assert.deepEqual(Array.from(marker.position),[35.7415,-5.7905]);marker.click({});assert.equal(selected.overlay,photo);
  const map3Source=fs.readFileSync(path.join(root,'components/gis/InteractiveGis3DMap.tsx'),'utf8');
  const block3=map3Source.slice(map3Source.indexOf('      // 11. KML 3D PhotoOverlays'),map3Source.indexOf('      // 12. KML 3D GroundOverlays'));
  class Object3D{constructor(){this.children=[];this.position={copy:p=>this.pos=p,set(){}};this.rotation={};}add(x){this.children.push(x);}}
  const group=new Object3D(),interactive=[];
  class Sprite extends Object3D {
    constructor(material){super();this.material=material;this.scale={set:(...v)=>{this.markerScale=v;this.scale.x=v[0];this.scale.y=v[1];}};this.center={set:(...v)=>this.anchor=v};}
  }
  Sprite.prototype.getWorldPosition=function(){return {project:()=>({x:0,y:0,z:0})};};
  const drawing={beginPath(){},arc(){},fill(){},stroke(){},fillRect(){}};
  const canvas={getContext:()=>drawing};
  const cleanup=[];
  // Deliberately omit all mesh/plane/cone constructors: old viewing geometry must not be created.
  const spriteThree={Sprite,CanvasTexture:class{dispose(){}},SpriteMaterial:class{constructor(options){Object.assign(this,options);}dispose(){}}};
  vm.runInNewContext(block3,{CONFIG:{kmlPhotoOverlays:[photo]},THREE:spriteThree,document:{createElement:tag=>{assert.equal(tag,'canvas');return canvas;}},window:{addEventListener:(name,callback)=>cleanup.push(callback)},toEnu:(lon,lat,alt)=>({lon,lat,alt}),rad:Math.PI/180,groupKmlImages:group,interactiveKml:interactive});
  assert(group.children[0] instanceof Sprite,'PhotoOverlay is only a camera billboard');
  assert.deepEqual(group.children[0].markerScale,[0.035,0.035,1]);
  assert.equal(group.children[0].material.sizeAttenuation,false,'marker stays small on screen');
  assert.equal(group.children[0].children.length,0,'no frustum or camera meshes');
  assert(!/TextureLoader|PlaneGeometry|ConeGeometry|BoxGeometry|wireframe/.test(block3),'no photograph surface or viewing geometry');
  cleanup.forEach(callback=>callback());
  assert.equal(group.children.length,1);assert.equal(interactive.length,1);assert.equal(interactive[0].userData.overlay,photo);assert.deepEqual(group.children[0].pos,{lon:-5.7905,lat:35.7415,alt:15});
  // Execute actual scene picking: a visible photo wins over overlapping railway,
  // while OFF cannot pick a hidden image.
  const pickBlock=map3Source.slice(map3Source.indexOf('      function onPointerClick(e)'),map3Source.indexOf("      renderer.domElement.addEventListener('click', onPointerClick)"));
  let picked;
  const pickContext={renderer:{domElement:{getBoundingClientRect:()=>({left:0,top:0,width:100,height:100})}},mouse:{},camera:{fov:45},THREE:{Vector3:Object3D},groupKmlImages:{visible:true},groupKml:{visible:true},groupTroncons:{visible:true},groupObs:{visible:false},groupRef:{visible:false},interactiveKml:interactive,interactiveTroncons:[{userData:{id:42}}],interactiveObs:[],interactiveRef:[],raycaster:{setFromCamera(){},intersectObjects:objects=>objects.length?[{object:objects[0]}]:[]},dispatchSelection:data=>picked=data,setTronconSelected:id=>picked=id};
  vm.createContext(pickContext);vm.runInContext(pickBlock,pickContext);
  pickContext.onPointerClick({clientX:50,clientY:50});assert.equal(picked.overlay,photo);
  pickContext.groupKmlImages.visible=false;pickContext.onPointerClick({clientX:50,clientY:50});assert.equal(picked,42);
  // A tap on the visible icon must work even when the graphics raycast misses.
  pickContext.raycaster.intersectObjects=()=>[];
  pickContext.groupKmlImages.visible=true;
  picked=null;pickContext.onPointerClick({clientX:50,clientY:48});assert.equal(picked.overlay,photo);
  pickContext.groupKmlImages.visible=false;
  picked=null;pickContext.onPointerClick({clientX:50,clientY:48});assert.equal(picked,null);

  // Execute the real zoom and fit button handlers with vector arithmetic.
  class Vector {
    constructor(x=0,y=0,z=0){Object.assign(this,{x,y,z});}
    clone(){return new Vector(this.x,this.y,this.z);}
    sub(v){this.x-=v.x;this.y-=v.y;this.z-=v.z;return this;}
    length(){return Math.hypot(this.x,this.y,this.z);}
    copy(v){return this.set(v.x,v.y,v.z);}
    add(v){this.x+=v.x;this.y+=v.y;this.z+=v.z;return this;}
    multiplyScalar(k){this.x*=k;this.y*=k;this.z*=k;return this;}
    set(x,y,z){Object.assign(this,{x,y,z});return this;}
  }
  const buttons={};
  const navContext={camera:{position:new Vector(0,0,100)},controls:{target:new Vector(),minDistance:5,maxDistance:45000,update(){}},document:{getElementById:id=>buttons[id]||(buttons[id]={})},sceneCenter:new Vector(10,0,20),initDistance:100};
  const navigation=map3Source.slice(map3Source.indexOf('      // Navigation buttons reuse'),map3Source.indexOf("      document.getElementById('btn-center').onclick"));
  vm.runInNewContext(navigation,navContext);
  buttons['btn-zoom-in'].onclick();assert.equal(navContext.camera.position.z,80);
  buttons['btn-zoom-out'].onclick();assert.equal(navContext.camera.position.z,100);
  buttons['btn-fit-bounds'].onclick();assert.deepEqual(navContext.camera.position,new Vector(80,65,90));
  assert.deepEqual(navContext.controls.target,navContext.sceneCenter);
  for(const id of ['btn-zoom-in','btn-zoom-out','btn-fit-bounds'])assert(map3Source.includes('id="'+id+'"'));
  console.log('3D navigation and screen-space photo selection verified');
  // Existing visibility bridges retain created markers while hiding the layer.
  const visibilityBlock=map3Source.slice(map3Source.indexOf('      function handleIncomingLayerMessage(event)'),map3Source.indexOf("      window.addEventListener('message', handleIncomingLayerMessage)"));
  const visibilityContext={groupKmlImages:group};vm.createContext(visibilityContext);vm.runInContext(visibilityBlock,visibilityContext);
  for(const visible of [false,true,false]) {visibilityContext.handleIncomingLayerMessage({data:{type:'SET_LAYER_VISIBILITY',layer:'kmlImages',visible}});assert.equal(group.visible,visible);assert.equal(group.children.length,1);}
  const init2=mapSource.slice(mapSource.indexOf('      var rawKmlGroundOverlays ='),mapSource.indexOf('      L.control.layers('));
  for(const visible of [false,true,false]) {
    const mapLayers=new Set();
    const layer={addTo:map=>map.addLayer(layer)};
    const ctx={config:{rawKmlPhotoOverlays:[photo],showKmlImages:visible,showKmlImagesControl:false},L:{layerGroup:()=>layer},overlayLayers:{},map:{addLayer:x=>mapLayers.add(x)}};
    vm.runInNewContext(init2,ctx);
    assert.equal(mapLayers.has(layer),visible,'actual 2D initialization honors common visibility');
    assert.equal(ctx.rawKmlPhotoOverlays.length,1,'OFF retains photo metadata');
  }
  console.log('Common OFF/ON/OFF control, hidden-image picking and retained 3D objects verified');
  console.log('D/E: actual Leaflet and Three.js PhotoOverlay blocks create selectable geographic markers');
  // Selection-only React updates must preserve the already-built scene source.
  const originalHooks={...React},hookValues=[],pendingEffects=[],messages=[];
  let hookIndex=0;
  const hooksSame=(a,b)=>a&&b&&a.length===b.length&&a.every((value,i)=>Object.is(value,b[i]));
  React.useRef=initial=>{const i=hookIndex++;if(!hookValues[i])hookValues[i]={current:initial};return hookValues[i];};
  React.useState=initial=>{const i=hookIndex++;if(!(i in hookValues))hookValues[i]=typeof initial==='function'?initial():initial;return [hookValues[i],value=>hookValues[i]=value];};
  const storeMemo=(factory,deps)=>{const i=hookIndex++;if(!hookValues[i]||!hooksSame(hookValues[i].deps,deps))hookValues[i]={deps,value:factory()};return hookValues[i].value;};
  React.useMemo=storeMemo;
  React.useCallback=(fn,deps)=>storeMemo(()=>fn,deps);
  React.useEffect=(effect,deps)=>{const i=hookIndex++;if(!hooksSame(hookValues[i],deps)){hookValues[i]=deps;pendingEffects.push(effect);}};
  const stableProps={troncons:[{id:2,geometry:parsed.geometry},{id:3,geometry:parsed.geometry}],customMarkers:[]};
  function renderSelection(id){hookIndex=0;return three.InteractiveGis3DMap({...stableProps,selectedTronconId:id});}
  const initialFrame=find(renderSelection(2),n=>n.type==='iframe');
  initialFrame.props.ref.current={contentWindow:{postMessage:msg=>messages.push(msg)}};
  for(const id of [3,null,2]) {
    const frame=find(renderSelection(id),n=>n.type==='iframe');
    assert.equal(frame.props.srcDoc,initialFrame.props.srcDoc,'select/deselect must not reconstruct scene HTML');
    frame.props.onLoad();assert.equal(messages.at(-1).id,id,'load synchronizes latest selection without rebuilding');
  }
  // The same HTML and source object stay stable on native WebView updates too.
  native.Platform.OS='android';
  const firstNative=find(renderSelection(2),n=>n.type==='WebView');
  const nextNative=find(renderSelection(3),n=>n.type==='WebView');
  assert.equal(nextNative.props.source,firstNative.props.source);
  native.Platform.OS='web';
  for(const effect of pendingEffects)if(effect.toString().includes('SET_TRONCON_SELECTION'))effect();
  assert(messages.some(msg=>msg.type==='SET_TRONCON_SELECTION'&&msg.id===null));
  Object.assign(React,originalHooks);
  console.log('Selection-only web/native updates preserve scene HTML/source and synchronize material selection');
  console.log('All PhotoOverlay lifecycle checks passed. No production database records written.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
