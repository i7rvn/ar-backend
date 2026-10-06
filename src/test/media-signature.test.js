const test = require('node:test')
const assert = require('node:assert/strict')
const { detectAllowedFileMime, verifyRealFileType } = require('../modules/media/media.service')

test('allowed media signatures are detected without a general binary parser', () => {
  assert.equal(detectAllowedFileMime(Buffer.from([0xff,0xd8,0xff,0x00])), 'image/jpeg')
  assert.equal(detectAllowedFileMime(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])), 'image/png')
  assert.equal(detectAllowedFileMime(Buffer.from('GIF89a')), 'image/gif')
  const webp = Buffer.alloc(12); webp.write('RIFF', 0); webp.write('WEBP', 8); assert.equal(detectAllowedFileMime(webp), 'image/webp')
  const mp4 = Buffer.alloc(12); mp4.write('ftyp', 4); assert.equal(detectAllowedFileMime(mp4), 'video/mp4')
})

test('unknown or mismatched upload signatures are rejected', () => {
  assert.equal(detectAllowedFileMime(Buffer.from('not-a-media-file')), null)
  assert.throws(() => verifyRealFileType(Buffer.from([0xff,0xd8,0xff]), 'image/png'), (err) => err.code === 'FILE_TYPE_MISMATCH')
})