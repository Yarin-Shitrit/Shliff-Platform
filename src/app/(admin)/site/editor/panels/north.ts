/** The eight compass words, clockwise from north. */
const COMPASS = ['צפון', 'צפון־מזרח', 'מזרח', 'דרום־מזרח', 'דרום', 'דרום־מערב', 'מערב', 'צפון־מערב'] as const;

/**
 * Which way the map's "up" faces (`north_deg`, spec §5 and §11), in words a
 * lead can check against the sun: 0 is north up; 90 means up is east.
 */
export function northText(northDeg: number): string {
  if (northDeg === 0) return 'הצפון למעלה במפה';
  const word = COMPASS[Math.round(northDeg / 45) % 8];
  return `למעלה במפה פונה ל${word} (${northDeg}°)`;
}
