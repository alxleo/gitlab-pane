import { expect, test } from 'vitest'

import { pictureUri, sizedAvatar } from '../../hooks/picture.ts'

test('avatars are asked for small and kept only when they are pictures', () => {
  expect(sizedAvatar('https://gitlab.com/uploads/-/system/user/avatar/9/avatar.png?v=17', 24)).toBe('https://gitlab.com/uploads/-/system/user/avatar/9/avatar.png?width=24')
  expect(sizedAvatar('https://secure.gravatar.com/avatar/abc?s=80&d=identicon', 24)).toBe('https://secure.gravatar.com/avatar/abc?s=24&d=identicon')
  expect(pictureUri('/9j/4AAQ\n', 100)).toBe('data:image/jpeg;base64,/9j/4AAQ')
  expect(pictureUri('<!DOCTYPE html>', 100)).toBeNull()
  expect(pictureUri(`iVBOR${'A'.repeat(100)}`, 100)).toBeNull()
})
