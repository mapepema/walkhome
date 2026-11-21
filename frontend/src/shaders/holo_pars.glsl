// Declarations + helpers injected after #include <common> (fragment).
// uHoloMask: R = artwork area (main foil), G = frame band (iridescent border).
uniform sampler2D uHoloMask;
uniform sampler2D uPattern;
uniform sampler2D uGrain;
uniform float uHoloAmount;
uniform float uBorderAmount;
uniform float uHue;
uniform float uTshift;
uniform float uMilk;
uniform float uSat;
uniform float uWarp;
uniform float uLineFreq;
uniform float uLineAngle;
uniform float uGlint;
uniform float uSpark;
uniform float uSparkDensity;
uniform float uSparkSize;
uniform float uBright;
uniform float uFoilMetalness;
uniform float uFoilRoughness;
uniform float uMotion;
uniform float uGrainAmount;
uniform float uEtch;
uniform float uGlare;
uniform float uParallax;
uniform float uBorderGlint;
uniform float uBorderHue;
uniform float uTime;
uniform vec2 uGrainRepeat;

#define HOLO_PI2 6.28318530718

float holoHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float holoNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = holoHash(i);
  float b = holoHash(i + vec2(1.0, 0.0));
  float c = holoHash(i + vec2(0.0, 1.0));
  float d = holoHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

vec3 holoSafeNormalize(vec3 v, vec3 fallback) {
  float l = length(v);
  return l > 1e-5 ? v / l : fallback;
}

// Tangent frame rebuilt from screen-space derivatives: the foil follows the actual surface.
mat3 holoBuildTbn(vec3 pos, vec3 n, vec2 uv) {
  vec3 dp1 = dFdx(pos);
  vec3 dp2 = dFdy(pos);
  vec2 duv1 = dFdx(uv);
  vec2 duv2 = dFdy(uv);
  float det = duv1.x * duv2.y - duv2.x * duv1.y;
  float inv = abs(det) < 1e-8 ? 0.0 : 1.0 / det;
  vec3 t = (duv2.y * dp1 - duv1.y * dp2) * inv;
  t = holoSafeNormalize(t - n * dot(n, t), vec3(1.0, 0.0, 0.0));
  return mat3(t, cross(n, t), n);
}

// Local foil exposure (artwork + frame band), for metalness/roughness.
float holoExposure(vec2 uv) {
  vec2 m = texture2D(uHoloMask, uv).rg;
  return clamp(m.r * uHoloAmount + m.g * uBorderAmount * 0.6, 0.0, 1.0);
}

// Glitter: one layer of cells, one glint per cell depending on the view angle.
float holoFlakes(vec2 uv, float density, float size, vec2 tilt, float seed) {
  vec2 cell = floor(uv * density);
  vec2 jitter = vec2(holoHash(cell + 7.1 + seed), holoHash(cell + 3.3 + seed)) - 0.5;
  float dist = length(fract(uv * density) - 0.5 - jitter * 0.6);
  float flake = smoothstep(size, 0.0, dist);
  float phase = fract(holoHash(cell + seed) * 13.37 + dot(tilt, vec2(1.7, 2.3)));
  return flake * smoothstep(0.82, 1.0, 1.0 - abs(phase * 2.0 - 1.0));
}
