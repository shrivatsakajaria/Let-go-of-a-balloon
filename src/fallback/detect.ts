/**
 * Can this browser draw the 3D world? three.js needs WebGL 2. The test context is given back at once,
 * so it does not count against the browser's limit on live contexts.
 */
export function canUseWebGL(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}
