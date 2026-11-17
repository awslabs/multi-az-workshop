import { RegionInfo } from 'aws-cdk-lib/region-info';

/**
 * Name rules shared across the families (review 10b F14): one region pattern, and one way to turn a
 * lowercase name into the PascalCase key used in output and parameter names.
 */

/** An AWS region name: us-east-1, us-gov-west-1, cn-north-1, eusc-de-east-1. */
export const REGION_NAME = /^[a-z]{2,4}(-[a-z]+)+-\d+$/;

/**
 * Why `region` can't be deployed to, or undefined when it is a region aws-cdk-lib knows. The shape
 * alone let a typo (`us-esat-2`) through to a deploy that failed with a credentials-looking error
 * (review 10c A9). A region launched after this aws-cdk-lib isn't listed: upgrading it adds it.
 */
export function unknownRegion(region: string): string | undefined {
  const known = RegionInfo.regions.map((r) => r.name);
  if (known.includes(region)) return undefined;
  const near = known
    .map((k) => [k, editDistance(region, k)] as const)
    .filter(([, d]) => d <= 2)
    .sort((a, b) => a[1] - b[1])[0];
  return `'${region}' is not an AWS region${near ? ` (did you mean ${near[0]}?)` : ''}. A region newer than this aws-cdk-lib ` +
    'is added by upgrading it (npx projen upgrade, only when the user agrees: CI opens a weekly upgrade MR/PR too).';
}

/** Edits between two names, a swap of neighbours counting as one (us-esat-2 is one from us-east-2). */
function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/**
 * `locust` → `Locust`. The name must be lowercase letters and digits, starting with a letter, and at
 * most `maxLength` characters; `what` names it in the error (e.g. "Edge route name").
 */
export function pascalKey(name: string, what: string, example: string, maxLength?: number): string {
  const ok = /^[a-z][a-z0-9]*$/.test(name) && (maxLength === undefined || name.length <= maxLength);
  if (!ok) {
    throw new Error(`${what} '${name}' must be lowercase letters and digits, starting with a letter` +
      `${maxLength === undefined ? '' : `, at most ${maxLength} characters`} (e.g. ${example}).`);
  }
  return name[0].toUpperCase() + name.slice(1);
}
