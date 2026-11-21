import { useRef, useState } from "react"
import { useFrame } from "@react-three/fiber"
import { Sparkles } from "@react-three/drei"
import * as THREE from "three"
import { CARD_H, CARD_W } from "./cardGeometry"

/** Additive halo behind the card (a single quad, radial shader). */
export function Halo({ color, strength = 1, pulse = true }: { color: string; strength?: number; pulse?: boolean }) {
  const mat = useRef<THREE.ShaderMaterial>(null)
  const [uniforms] = useState(() => ({ uColor: { value: new THREE.Color(color) }, uStrength: { value: 0 }, uTime: { value: 0 } }))
  useFrame((s) => {
    if (!mat.current) return
    mat.current.uniforms.uColor.value.set(color)
    const k = pulse ? 0.85 + 0.15 * Math.sin(s.clock.elapsedTime * 1.6) : 1
    mat.current.uniforms.uStrength.value += (strength * k - mat.current.uniforms.uStrength.value) * 0.1
    mat.current.uniforms.uTime.value = s.clock.elapsedTime
  })
  return (
    <mesh position={[0, 0, -0.35]} scale={[CARD_W * 2.1, CARD_H * 1.55, 1]} renderOrder={-1}>
      <planeGeometry args={[1, 1]} />
      <shaderMaterial
        ref={mat}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        uniforms={uniforms}
        vertexShader={`varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`}
        fragmentShader={`
          varying vec2 vUv; uniform vec3 uColor; uniform float uStrength; uniform float uTime;
          void main(){
            vec2 p = (vUv-0.5)*vec2(1.0,1.05);
            float d = length(p*vec2(1.25,0.95));
            float core = smoothstep(0.62,0.0,d);
            float ang = atan(p.y,p.x);
            float rays = 0.5+0.5*sin(ang*9.0 + uTime*0.35);
            float ray2 = 0.5+0.5*sin(ang*5.0 - uTime*0.22);
            float halo = core*core*0.85 + core*(0.18+0.22*rays*ray2)*smoothstep(0.0,0.5,d);
            gl_FragColor = vec4(uColor*halo*uStrength, halo*uStrength);
          }`}
      />
    </mesh>
  )
}

/** Floating particles (ultra/secret) — a single draw call. */
export function FloatingSparks({ color, count }: { color: string; count: number }) {
  if (count <= 0) return null
  return (
    <Sparkles
      count={count}
      scale={[CARD_W * 1.6, CARD_H * 1.25, 0.9]}
      size={5}
      speed={0.35}
      opacity={0.9}
      color={color}
      position={[0, 0, 0.15]}
      noise={1.2}
    />
  )
}
