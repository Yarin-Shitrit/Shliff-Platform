import { metres } from '@/lib/site/geometry';

/**
 * A size with its height, the way the inspectors state a kind's default:
 * `3 × 3 × 2 מ׳` — width, depth, height, in metres (ruling P15: written once,
 * here, for both inspectors). Pure and free of `three`, like every panel file.
 */
export function size3(size: { widthCm: number; depthCm: number; heightCm: number }): string {
  return `${metres(size.widthCm)} × ${metres(size.depthCm)} × ${metres(size.heightCm)} מ׳`;
}
