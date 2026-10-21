import React, { useMemo } from 'react';
import { Platform, StyleSheet, TouchableOpacity, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { Text } from '@/components/ui/text';
import { getMediaUrl, KmlPhotoOverlay } from '@/services/api';
import { isKmlPanoramaEligible } from '@/lib/kmlPanorama';

export function createKmlPanoramaHtml(url: string): string {
  const safeUrl = JSON.stringify(url).replace(/</g, '\\u003c');
  return `<!DOCTYPE html><html lang="fr"><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#070D1E;color:white;font:14px sans-serif}canvas{display:block;touch-action:none}#status{position:absolute;top:15px;left:15px;pointer-events:none}button{position:absolute;bottom:18px;right:18px;background:#334155;color:white;border:0;padding:12px;border-radius:8px}</style></head><body><div id="status">Chargement du panorama…</div><button id="fullscreen">Plein écran</button><script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script><script>
(function(){
var status=document.getElementById('status');
try {
if(typeof THREE==='undefined') throw new Error('Moteur 360° indisponible');
var scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(75,innerWidth/innerHeight,0.1,1100);
var renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));renderer.setSize(innerWidth,innerHeight);document.body.appendChild(renderer.domElement);
var geometry=new THREE.SphereGeometry(500,64,40);geometry.scale(-1,1,1);
var material=new THREE.MeshBasicMaterial();scene.add(new THREE.Mesh(geometry,material));
var disposed=false,texture=null,frame=0;
new THREE.TextureLoader().setCrossOrigin('anonymous').load(${safeUrl},function(value){if(disposed){value.dispose();return;}texture=value;texture.minFilter=THREE.LinearFilter;texture.generateMipmaps=false;material.map=texture;material.needsUpdate=true;status.textContent='Glissez pour explorer • pincez pour zoomer';},undefined,function(){status.textContent='Panorama indisponible. Revenez à la fiche pour voir la photo.';});
var yaw=0,pitch=0,pointers=new Map(),pinch=0;
function zoom(value){camera.fov=Math.max(35,Math.min(100,value));camera.updateProjectionMatrix();}
function gap(){var a=Array.from(pointers.values());return a.length===2?Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y):0;}
var canvas=renderer.domElement;
canvas.addEventListener('pointerdown',function(e){pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});canvas.setPointerCapture(e.pointerId);pinch=gap();});
canvas.addEventListener('pointermove',function(e){var previous=pointers.get(e.pointerId);if(!previous)return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(pointers.size===2){var next=gap();if(pinch>0&&next>0)zoom(camera.fov*pinch/next);pinch=next;}else if(pointers.size===1){yaw-=(e.clientX-previous.x)*0.15;pitch=Math.max(-85,Math.min(85,pitch+(e.clientY-previous.y)*0.15));}});
function release(e){pointers.delete(e.pointerId);pinch=gap();}
canvas.addEventListener('pointerup',release);canvas.addEventListener('pointercancel',release);
canvas.addEventListener('wheel',function(e){e.preventDefault();zoom(camera.fov+e.deltaY*0.04);},{passive:false});
document.getElementById('fullscreen').onclick=function(){var action=document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen&&document.documentElement.requestFullscreen();if(action&&action.catch)action.catch(function(){});};
addEventListener('resize',function(){camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
function animate(){if(disposed)return;frame=requestAnimationFrame(animate);var phi=(90-pitch)*Math.PI/180,theta=yaw*Math.PI/180;camera.lookAt(Math.sin(phi)*Math.cos(theta),Math.cos(phi),Math.sin(phi)*Math.sin(theta));renderer.render(scene,camera);}animate();
addEventListener('beforeunload',function(){disposed=true;cancelAnimationFrame(frame);if(texture)texture.dispose();geometry.dispose();material.dispose();renderer.dispose();});
}catch(error){status.textContent='Visionneuse 360° indisponible. Revenez à la fiche.';}
})();</script></body></html>`;
}

export function KmlPanoramaViewer({ sourceFormat, overlay, width, height, onClose }: {
  sourceFormat?: string; overlay: KmlPhotoOverlay; width: number; height: number; onClose: () => void;
}) {
  const eligible = isKmlPanoramaEligible(sourceFormat, overlay, width, height);
  const url = eligible ? getMediaUrl(overlay.icon.href) : '';
  const html = useMemo(() => url ? createKmlPanoramaHtml(url) : '', [url]);
  if (!eligible) return null;
  return <View style={styles.viewer}>
    <View style={styles.toolbar}>
      <Text style={styles.title} numberOfLines={1}>{overlay.name || 'Photo KML'} · 360°</Text>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Fermer la vue 360°" onPress={onClose} style={styles.close}><Text style={styles.title}>Fermer</Text></TouchableOpacity>
    </View>
    {Platform.OS === 'web'
      ? <iframe title="Panorama KML 360°" srcDoc={html} allowFullScreen style={{ flex: 1, width: '100%', height: '100%', border: 0 }} />
      : <WebView source={{ html }} originWhitelist={['*']} javaScriptEnabled mixedContentMode="always" style={styles.canvas} />}
  </View>;
}
const styles = StyleSheet.create({ viewer: { flex: 1, backgroundColor: '#070D1E', width: '100%' }, toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingTop: 28 }, title: { color: '#FFFFFF', flexShrink: 1 }, close: { padding: 12 }, canvas: { flex: 1, backgroundColor: '#070D1E' } });
