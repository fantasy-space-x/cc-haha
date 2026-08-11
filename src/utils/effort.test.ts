import { afterEach, expect, test } from 'bun:test'
import { modelSupportsMaxEffort } from './effort.js'

const originalAlwaysEnableEffort = process.env.CLAUDE_CODE_ALWAYS_ENABLE_EFFORT

afterEach(() => {
  if (originalAlwaysEnableEffort === undefined) {
    delete process.env.CLAUDE_CODE_ALWAYS_ENABLE_EFFORT
  } else {
    process.env.CLAUDE_CODE_ALWAYS_ENABLE_EFFORT = originalAlwaysEnableEffort
  }
})

test('forced runtime effort permits max for an unknown provider model', () => {
  delete process.env.CLAUDE_CODE_ALWAYS_ENABLE_EFFORT
  expect(modelSupportsMaxEffort('deepseek-v4-pro')).toBe(false)

  process.env.CLAUDE_CODE_ALWAYS_ENABLE_EFFORT = '1'
  expect(modelSupportsMaxEffort('deepseek-v4-pro')).toBe(true)
})
