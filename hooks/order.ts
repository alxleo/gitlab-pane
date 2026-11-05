/** The first of these comparisons that tells two things apart, for a sort by one thing and then another; 0 when none does. */
export const firstDifference = (...differences: readonly number[]): number => differences.find(difference => difference !== 0) ?? 0
