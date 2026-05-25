import { describe, it, expect } from 'vitest'
import { serializeDrill } from '../serialization'

describe('serialization - actors', () => {
  it('allows serializing a drill with zero actors', () => {
    const data = {
      version: "2.0.0",
      metadata: { id: 'x', name: 'empty' },
      actors: [],
      paths: [],
      annotations: [],
      derivedEvents: [],
    }

    const result = serializeDrill(data)
    expect(result).toBeTruthy()
    expect(Array.isArray(result.actors)).toBe(true)
    expect(result.actors.length).toBe(0)
  })
})
