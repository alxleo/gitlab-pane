export function isText(value: unknown): value is string {
  return typeof value === 'string'
}
export const isWord = function (value: unknown): value is string {
  return typeof value === 'string'
}
export function isLong(value: unknown): boolean {
  return typeof value === 'string' && value.length > 9
}
function isHidden(value: unknown): value is string {
  return typeof value === 'string'
}
export { isHidden }
export default function isDefault(value: unknown): value is string {
  return typeof value === 'string'
}
