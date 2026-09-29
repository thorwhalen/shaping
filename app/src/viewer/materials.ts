/**
 * Material presets: what the "Material" dial means. Raw dials (roughness, metalness, opacity)
 * override a preset when set. Opacity is the cheap see-through view; transmission is glass; never
 * both at once.
 */
import type { Style } from 'shaping';

export interface MaterialSpec {
  roughness: number;
  metalness: number;
  clearcoat: number;
  transmission: number;
  thickness: number;
  ior: number;
}

export const PRESETS: Record<Style['material'], MaterialSpec> = {
  matte: { roughness: 0.85, metalness: 0, clearcoat: 0, transmission: 0, thickness: 0, ior: 1.5 },
  glossy: { roughness: 0.28, metalness: 0, clearcoat: 0.6, transmission: 0, thickness: 0, ior: 1.5 },
  'brushed-metal': { roughness: 0.45, metalness: 1, clearcoat: 0, transmission: 0, thickness: 0, ior: 1.5 },
  'polished-metal': { roughness: 0.12, metalness: 1, clearcoat: 0.3, transmission: 0, thickness: 0, ior: 1.5 },
  glass: { roughness: 0.05, metalness: 0, clearcoat: 1, transmission: 1, thickness: 8, ior: 1.5 },
  resin: { roughness: 0.2, metalness: 0, clearcoat: 0.8, transmission: 0.55, thickness: 12, ior: 1.54 },
};

export function materialFor(style: Style): MaterialSpec & { opacity: number; transparent: boolean } {
  const p = PRESETS[style.material];
  const transmission = style.opacity < 1 ? 0 : p.transmission;
  return {
    ...p,
    roughness: style.roughness ?? p.roughness,
    metalness: style.metalness ?? p.metalness,
    transmission,
    opacity: style.opacity,
    transparent: style.opacity < 1,
  };
}
