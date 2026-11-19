/**
 * Checks run before a launch, shown in the launch bar: settings known to
 * exhaust memory on the reference machine (64 GB Apple Silicon), so the user
 * learns it before a long wait ends in "MPS backend out of memory".
 * Advisory only: the launch stays possible.
 */

import type { FieldValues } from './types';

export interface PreflightWarning {
  /** i18n key. */
  message: string;
}

export function memoryWarnings(
  manifestId: string,
  values: FieldValues,
): PreflightWarning[] {
  const warnings: PreflightWarning[] = [];
  if (manifestId === 'krea2-edit') {
    // refs option 1 = two reference images (scene + person): two 1 MP
    // references saturate memory with the default attention backend.
    if (values.refs === 1) warnings.push({ message: 'preflight.twoRefs' });
    // ref_boost ≠ 1 routes attention through a full matrix: several GB more.
    const boost = Number(values.refBoost);
    if (Number.isFinite(boost) && boost !== 1) {
      warnings.push({ message: 'preflight.refBoost' });
    }
  }
  return warnings;
}
