import type { ReactNode } from "react"
import { Environment, Lightformer } from "@react-three/drei"

/**
 * 100% local "packshot" lighting (no network HDRI): emissive softboxes
 * rendered into the environment. Foil needs small, CONTRASTED highlights:
 * a highlight that sweeps across the card as it turns, not a haze covering it.
 */
export function Stage({ children, intensity = 1 }: { children: ReactNode; intensity?: number }) {
  return (
    <>
      <Environment resolution={256} frames={1} environmentIntensity={0.55 * intensity}>
        <color attach="background" args={["#0a0b10"]} />
        {/* warm key, top right */}
        <Lightformer form="rect" intensity={5} color="#fff0d8" position={[3.2, 3, 3]} scale={[2.2, 3.6, 1]} target={[0, 0, 0]} />
        {/* cool counter-key, bottom left */}
        <Lightformer form="rect" intensity={3.4} color="#cfe3ff" position={[-3.6, -1, 2.4]} scale={[1.4, 3.2, 1]} target={[0, 0, 0]} />
        {/* thin strip: gives the varnish its bright streak */}
        <Lightformer form="rect" intensity={7} color="#ffffff" position={[0.5, 4.2, 1.5]} scale={[5, 0.25, 1]} target={[0, 0, 0]} />
        {/* back rim */}
        <Lightformer form="ring" intensity={4} color="#b8c9ff" position={[-3, 2, -3]} scale={2} target={[0, 0, 0]} />
        <Lightformer form="circle" intensity={3} color="#ffc9a0" position={[3, -2, -3]} scale={1.6} target={[0, 0, 0]} />
      </Environment>
      <ambientLight intensity={0.5} />
      <directionalLight position={[1.5, 3, 4]} intensity={0.5} color="#fff3e0" />
      {children}
    </>
  )
}
