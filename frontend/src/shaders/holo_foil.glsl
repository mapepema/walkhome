// Injected before #include <opaque_fragment>: adds the foil to the outgoing light.
{
  vec3 holoV = holoSafeNormalize(vViewPosition, vec3(0.0, 0.0, 1.0));
  vec3 holoN = normalize(normal);
  vec3 holoR = reflect(-holoV, holoN);
  mat3 holoTbn = holoBuildTbn(-vViewPosition, holoN, vMapUv);

  // Perceived tilt drives the hue (never a timer).
  vec2 tilt = vec2(dot(holoR, holoTbn[0]), dot(holoR, holoTbn[1]));

  vec2 hm = texture2D(uHoloMask, vMapUv).rg;
  float artE = hm.r * uHoloAmount;
  float frameE = hm.g * uBorderAmount;

  vec2 dir = vec2(cos(uLineAngle), sin(uLineAngle));
  float along = dot(vMapUv - 0.5, dir);
  float warp = holoNoise(vMapUv * 3.0 + tilt * uWarp);

  // --- Artwork foil ---------------------------------------------------------
  float hue = along * uHue + dot(tilt, dir) * uTshift + (warp - 0.5) * 1.2;
  vec3 sheen = texture2D(uPattern, vec2(fract(hue), 0.5)).rgb;
  sheen = mix(vec3(dot(sheen, vec3(0.3333))), sheen, uSat);
  sheen = mix(sheen, vec3(1.0), uMilk);

  float lines = 0.5 + 0.5 * sin(HOLO_PI2 * (along * uLineFreq + dot(tilt, dir) * 2.0));
  lines = pow(lines, 3.0);

  // Two glitter layers at different depths: the parallax
  // gives the impression of a thick foil, not a flat tint.
  vec2 pUv1 = vMapUv + tilt * uParallax * 0.030;
  vec2 pUv2 = vMapUv - tilt * uParallax * 0.055 + 0.37;
  float spark = holoFlakes(pUv1, uSparkDensity, uSparkSize, tilt, 0.0)
              + 0.7 * holoFlakes(pUv2, uSparkDensity * 0.62, uSparkSize * 1.25, tilt * -1.0, 5.0);

  vec3 foil = sheen * (0.35 + 0.65 * lines) * uGlint;
  foil += spark * uSpark * (0.7 + uMotion * 0.9);

  // Sweeping glint: a diagonal band that follows the tilt.
  float gpos = dot(tilt, vec2(0.75, 0.75)) * 1.7;
  float gd = (dot(vMapUv - 0.5, vec2(0.7071, 0.7071)) - gpos) / 0.16;
  float glare = exp(-gd * gd);
  foil += glare * mix(vec3(1.0), sheen, 0.55) * uGlare * (0.6 + uMotion * 0.6);

  foil *= uBright * (0.85 + uMotion * 0.55);
  float grainTex = texture2D(uGrain, vMapUv * uGrainRepeat).r;
  foil *= mix(1.0, grainTex * 2.0, uGrainAmount * 1.5);

  // --- Iridescent border (high rarities) -------------------------------------
  float bHue = along * uBorderHue + dot(tilt, dir) * uTshift * 1.6 + holoNoise(vMapUv * 9.0) * 0.25;
  vec3 bSheen = texture2D(uPattern, vec2(fract(bHue), 0.5)).rgb;
  float bLines = 0.8 + 0.2 * sin(HOLO_PI2 * (along * 18.0 + dot(tilt, dir) * 3.0));
  vec3 border = bSheen * (0.5 + 0.8 * bLines) * uBorderGlint;
  border += glare * 0.5 * uBorderGlint;

  outgoingLight += foil * artE + border * frameE;
}
