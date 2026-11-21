import * as THREE from 'three'

/** Standard playing card ratio: 63 x 88 mm. */
export const CARD_W = 2.1
export const CARD_H = (CARD_W * 88) / 63
export const CARD_D = 0.012
export const CARD_R = 0.11
/**
 * Thickness of the two paper layers around the black core.
 * A playing card is a laminate: two paper layers glued on either side
 * of an opaque core. That dark line is what the eye recognises on
 * the edge — without it, the card reads like a plastic plate.
 */
export const CARD_PAPER = 0.0035

/** Depth of the printed faces, just above the laminate. */
export const CARD_FACE_Z = CARD_D / 2 + 0.0006

export function roundedRectShape(w = CARD_W, h = CARD_H, r = CARD_R) {
  const x = -w / 2
  const y = -h / 2
  const s = new THREE.Shape()
  s.moveTo(x + r, y)
  s.lineTo(x + w - r, y)
  s.quadraticCurveTo(x + w, y, x + w, y + r)
  s.lineTo(x + w, y + h - r)
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  s.lineTo(x + r, y + h)
  s.quadraticCurveTo(x, y + h, x, y + h - r)
  s.lineTo(x, y + r)
  s.quadraticCurveTo(x, y, x + r, y)
  return s
}

function band(depth: number, z: number) {
  const geo = new THREE.ExtrudeGeometry(roundedRectShape(), {
    depth,
    bevelEnabled: false,
    curveSegments: 16,
  })
  geo.translate(0, 0, z)
  return geo
}

/**
 * The laminate: paper / black core / paper.
 * The three layers share the same outline; only their material differs.
 */
export function createCardBands() {
  const core = CARD_D - CARD_PAPER * 2
  return {
    front: band(CARD_PAPER, CARD_D / 2 - CARD_PAPER),
    core: band(core, -core / 2),
    back: band(CARD_PAPER, -CARD_D / 2),
  }
}

/**
 * Printed face: same silhouette as the body, but UVs remapped to 0..1
 * so the textures stay plain rectangles.
 */
export function createCardFace() {
  const geo = new THREE.ShapeGeometry(roundedRectShape(), 16)
  const pos = geo.attributes.position
  const uv = new Float32Array(pos.count * 2)
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) / CARD_W + 0.5
    uv[i * 2 + 1] = pos.getY(i) / CARD_H + 0.5
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  geo.computeVertexNormals()
  return geo
}
