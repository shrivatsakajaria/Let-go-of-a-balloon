/**
 * The renderer every 3D page uses: sharpness capped at DPR_CAP (spec 12), neutral tone mapping
 * (keeps the Contour hues), PCF shadows that are only redrawn on request
 * (`renderer.shadowMap.needsUpdate = true` when tiles or the sun change), no post-processing.
 */
import * as THREE from 'three';
import { DPR_CAP } from '../config';

export function createRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(DPR_CAP, window.devicePixelRatio || 1));
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  return renderer;
}
