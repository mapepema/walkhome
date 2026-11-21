import * as THREE from "three"
import holoPars from "@/shaders/holo_pars.glsl"
import holoFoil from "@/shaders/holo_foil.glsl"
import { grainTexture, spectrumTexture } from "./spectra"
import { BASE_FOIL, BASE_SUBSTRATE, type FoilParams, type SubstrateParams, type Treatment } from "./treatments"

const constant = (v: number) => {
  const t = new THREE.DataTexture(new Uint8Array([v, v, v, 255]), 1, 1)
  t.needsUpdate = true
  return t
}
const NO_MASK = constant(0)
const DEFAULT_MAP = (() => {
  const t = constant(255)
  t.colorSpace = THREE.SRGBColorSpace
  return t
})()

/**
 * Augmented MeshPhysicalMaterial: all of Three.js PBR + foil injected into the chunks.
 * The holo mask is not a colour: it allows the surface to behave like foil.
 */
export class HoloCardMaterial extends THREE.MeshPhysicalMaterial {
  readonly uniforms: Record<string, THREE.IUniform>

  constructor() {
    super({ map: DEFAULT_MAP, roughness: 0.62, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.25 })
    this.uniforms = {
      uHoloMask: { value: NO_MASK },
      uPattern: { value: spectrumTexture("pastel") },
      uGrain: { value: grainTexture() },
      uHoloAmount: { value: BASE_SUBSTRATE.holoAmount },
      uBorderAmount: { value: 0 },
      uHue: { value: BASE_FOIL.hue },
      uTshift: { value: BASE_FOIL.tiltShift },
      uMilk: { value: BASE_FOIL.milkiness },
      uSat: { value: BASE_FOIL.saturation },
      uWarp: { value: BASE_FOIL.warp },
      uLineFreq: { value: BASE_FOIL.lineFrequency },
      uLineAngle: { value: BASE_FOIL.lineAngle },
      uGlint: { value: BASE_FOIL.glint },
      uSpark: { value: BASE_FOIL.sparkle },
      uSparkDensity: { value: BASE_FOIL.sparkleDensity },
      uSparkSize: { value: BASE_FOIL.sparkleSize },
      uBright: { value: BASE_FOIL.brightness },
      uFoilMetalness: { value: BASE_SUBSTRATE.metalness },
      uFoilRoughness: { value: BASE_SUBSTRATE.roughness },
      uMotion: { value: 0 },
      uGrainRepeat: { value: new THREE.Vector2(9, 12.6) },
      uGrainAmount: { value: BASE_SUBSTRATE.grain },
      uEtch: { value: BASE_SUBSTRATE.foilEtch },
      uGlare: { value: 0 },
      uParallax: { value: 1 },
      uBorderGlint: { value: 0 },
      uBorderHue: { value: 1.2 },
      uTime: { value: 0 },
    }
  }

  setFoil(p: FoilParams) {
    const u = this.uniforms
    u.uHue.value = p.hue
    u.uTshift.value = p.tiltShift
    u.uMilk.value = p.milkiness
    u.uSat.value = p.saturation
    u.uWarp.value = p.warp
    u.uLineFreq.value = p.lineFrequency
    u.uLineAngle.value = p.lineAngle
    u.uGlint.value = p.glint
    u.uSpark.value = p.sparkle
    u.uSparkDensity.value = p.sparkleDensity
    u.uSparkSize.value = p.sparkleSize
    u.uBright.value = p.brightness
    u.uGlare.value = p.glare
    u.uParallax.value = p.parallax
    u.uBorderGlint.value = p.borderGlint
    u.uBorderHue.value = p.borderHue
  }

  setSubstrate(p: SubstrateParams) {
    const had = this.iridescence > 0
    this.iridescence = p.iridescence
    this.iridescenceIOR = p.iridescenceIOR
    this.iridescenceThicknessRange = [p.thicknessMin, p.thicknessMax]
    this.normalScale.set(p.normalStrength, p.normalStrength)
    this.clearcoat = p.clearcoat
    this.clearcoatRoughness = p.clearcoatRoughness
    this.uniforms.uFoilMetalness.value = p.metalness
    this.uniforms.uFoilRoughness.value = p.roughness
    this.uniforms.uHoloAmount.value = p.holoAmount
    this.uniforms.uBorderAmount.value = p.borderAmount
    this.uniforms.uGrainAmount.value = p.grain
    this.uniforms.uEtch.value = p.foilEtch
    if (had !== p.iridescence > 0) this.needsUpdate = true
  }

  setTreatment(t: Treatment) {
    this.setFoil(t.foil)
    this.setSubstrate(t.substrate)
    this.uniforms.uPattern.value = spectrumTexture(t.spectrum)
  }

  setTextures(albedo: THREE.Texture, mask: THREE.Texture, normal: THREE.Texture | null) {
    this.map = albedo
    this.normalMap = normal
    this.uniforms.uHoloMask.value = mask
    this.needsUpdate = true
  }

  override onBeforeCompile(shader: THREE.WebGLProgramParametersWithUniforms) {
    Object.assign(shader.uniforms, this.uniforms)
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${holoPars}`)
      .replace(
        "#include <roughnessmap_fragment>",
        `float holoExposedFoil = holoExposure(vMapUv);
         float holoGrain = texture2D( uGrain, vMapUv * uGrainRepeat ).r;
         #include <roughnessmap_fragment>
         roughnessFactor = mix(roughnessFactor, uFoilRoughness, holoExposedFoil);
         roughnessFactor = clamp( roughnessFactor + ( holoGrain - 0.5 ) * uGrainAmount, 0.02, 1.0 );`,
      )
      .replace(
        "#include <metalnessmap_fragment>",
        `#include <metalnessmap_fragment>
         metalnessFactor = mix(metalnessFactor, uFoilMetalness, holoExposedFoil);`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
         {
           vec2 etchDir = vec2( cos( uLineAngle ), sin( uLineAngle ) );
           float etchDrift = holoNoise( vMapUv * vec2( 5.0, 7.0 ) ) - 0.5;
           float etchWave = sin( HOLO_PI2 * ( dot( vMapUv - 0.5, etchDir ) * uLineFreq + etchDrift * 0.9 ) );
           mat3 etchTbn = holoBuildTbn( -vViewPosition, normal, vMapUv );
           normal = normalize( normal + etchTbn[ 0 ] * etchWave * uEtch * holoExposedFoil );
         }`,
      )
      .replace("#include <opaque_fragment>", `${holoFoil}\n#include <opaque_fragment>`)
  }

  override customProgramCacheKey() {
    return "wh-holo-card-v1"
  }
}
