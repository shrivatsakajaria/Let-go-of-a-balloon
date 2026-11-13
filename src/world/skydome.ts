/**
 * The sky dome: the haze colour by view direction (haze.ts), so the sky meets the hazed land with no
 * seam. Already display colour, so it is not tone-mapped. Keep it centred on the camera and inside
 * the far plane (`follow`).
 */
import * as THREE from 'three';
import { HAZE_GLSL, type HazeUniforms } from './haze';

export class SkyDome {
  readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;

  constructor(haze: HazeUniforms, radius = 20000) {
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        toneMapped: false,
        uniforms: haze,
        vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `${HAZE_GLSL}
      varying vec3 vP;
      void main(){ gl_FragColor = vec4(hazeCol(normalize(vP)), 1.0); }`,
      }),
    );
    this.mesh.scale.setScalar(radius);
    this.mesh.renderOrder = -1;
    this.mesh.frustumCulled = false;
  }

  /** Centre on the camera; radius just inside its far plane. */
  follow(camera: THREE.PerspectiveCamera): void {
    this.mesh.position.copy(camera.position);
    this.mesh.scale.setScalar(camera.far * 0.9);
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
