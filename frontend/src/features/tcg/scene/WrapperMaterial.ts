import * as THREE from 'three'
import { TEAR_BAND } from './packCompositor'

/** Overlap between the two pieces, so the torn edge has some material to bite into. */
export const TEAR_OVERLAP = 0.02

/**
 * Pack wrapper material, with its tear.
 *
 * Two pieces share the same image and the same jagged tear line,
 * each discarding its own side: the cut is therefore exactly complementary,
 * with no visible gap or overlap.
 *
 * The top strip curls column by column as the finger moves.
 * That is what makes it feel like tearing rather than triggering an
 * animation: the progress IS the gesture.
 */
/**
 * `body`: stays in place, cut below the tear line.
 * `strip`: curls and is cut above the line.
 * `core`: the edge of the strip. It curls too, but has no
 *        tear line to respect: its geometry already stops at the right
 *        place, and applying the cut to it would punch a crooked hole.
 */
export type WrapperPiece = 'body' | 'strip' | 'core'

/**
 * Default map: guarantees that `USE_MAP`, and therefore the `vMapUv` varying, exist
 * from the first compilation; the real texture is only set afterwards.
 */
const DEFAULT_MAP = (() => {
  const data = new Uint8Array([255, 255, 255, 255])
  const tex = new THREE.DataTexture(data, 1, 1)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.needsUpdate = true
  return tex
})()

export class WrapperMaterial extends THREE.MeshPhysicalMaterial {
  readonly uniforms: Record<string, THREE.IUniform>
  private readonly piece: WrapperPiece

  constructor(piece: WrapperPiece, params?: THREE.MeshPhysicalMaterialParameters) {
    super({ map: DEFAULT_MAP, roughness: 0.34, metalness: 0.45, side: THREE.DoubleSide, ...params })
    this.piece = piece
    this.uniforms = {
      uTear: { value: 0 },
      uSeam: { value: 1 - TEAR_BAND },
      uPeel: { value: piece === 'body' ? 0 : 1 },
      uSeamCut: { value: piece === 'core' ? 0 : 1 },
      uStrip: { value: piece === 'strip' ? 1 : 0 },
    }
  }

  override onBeforeCompile(shader: THREE.WebGLProgramParametersWithUniforms) {
    Object.assign(shader.uniforms, this.uniforms)

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uTear;
         uniform float uPeel;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         if ( uPeel > 0.5 ) {
           // A column is released once the finger has passed it, and curls
           // all the more the longer it has been released.
           float released = clamp( ( uTear - uv.x ) / 0.22, 0.0, 1.0 );
           transformed.z += released * released * 0.55;
           transformed.y += released * 0.22;
           transformed.x += released * 0.06;
         }`,
      )

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uTear;
         uniform float uSeam;
         uniform float uStrip;
         uniform float uPeel;
         uniform float uSeamCut;

         float wrapHash( float x ) {
           return fract( sin( x * 127.1 ) * 43758.5453123 );
         }

         // Tear line: low-frequency noise plus fine teeth.
         // A straight cut reads like a mask, not like torn paper.
         float wrapSeam( float x ) {
           float coarse = mix( wrapHash( floor( x * 14.0 ) ), wrapHash( floor( x * 14.0 ) + 1.0 ), fract( x * 14.0 ) );
           float fine = wrapHash( floor( x * 60.0 ) );
           return uSeam + ( coarse - 0.5 ) * 0.016 + ( fine - 0.5 ) * 0.006;
         }`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
         {
           float seam = wrapSeam( vMapUv.x );
           if ( uPeel > 0.5 ) {
             if ( vMapUv.y < seam ) discard;
             // The fully torn column disappears with the rest of the top.
             if ( uTear - vMapUv.x > 0.26 ) discard;
           } else if ( vMapUv.y > seam ) {
             discard;
           }
         }`,
      )
  }

  override customProgramCacheKey() {
    return `wrapper-material-${this.piece}`
  }
}
