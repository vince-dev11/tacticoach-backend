// Uploads must never be stored inside the repository.
//
// They are coaches' data — board videos, thumbnails, drill-sheet images, club
// logos — and the working tree is the one place that guarantees losing them: a
// clean checkout, a fresh deploy or an over-eager `git clean` takes the lot,
// and in between they clutter `git status` waiting to be committed by accident.

import { describe, it, expect, vi } from 'vitest'
import path from 'node:path'

// tests/setup.ts replaces this module with a mock for route tests; here we want
// the real thing, because the resolved path is exactly what is under test.
const realS3 = await vi.importActual<typeof import('../src/config/s3.js')>('../src/config/s3.js')

const PROJECT_ROOT = process.cwd()

describe('upload storage location', () => {
  it('resolves to an absolute path', () => {
    expect(path.isAbsolute(realS3.LOCAL_DIR)).toBe(true)
  })

  it('is not inside the project directory', () => {
    const inside =
      realS3.LOCAL_DIR === PROJECT_ROOT || realS3.LOCAL_DIR.startsWith(PROJECT_ROOT + path.sep)
    expect(inside, `uploads would be stored in the repo at ${realS3.LOCAL_DIR}`).toBe(false)
  })

  it('is not the legacy ./uploads directory', () => {
    expect(realS3.LOCAL_DIR).not.toBe(path.join(PROJECT_ROOT, 'uploads'))
  })

  it('reports S3 as the backend when it is configured', () => {
    // The test env sets AWS_* (see vitest.config.ts), so no directory is
    // created and no local-disk warning is produced.
    const s = realS3.describeStorage()
    expect(s.backend).toBe('s3')
    expect(s.warning).toBeUndefined()
  })
})
