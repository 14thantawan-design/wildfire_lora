import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

test('node registration uses the ten row buttons, not a duplicate number form', async () => {
  const globals = ['window', 'navigator'].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)])
  let server
  try {
    Object.defineProperty(globalThis, 'window', { value: { isSecureContext: true }, configurable: true })
    Object.defineProperty(globalThis, 'navigator', { value: { serial: {} }, configurable: true })
    server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' })
    const { AdminNodesPage } = await server.ssrLoadModule('/src/admin/AdminNodesPage.tsx')
    const markup = renderToStaticMarkup(createElement(AdminNodesPage))
    assert.doesNotMatch(markup, /type="number"|id="node-slot"|เพิ่มโหนดและตั้งค่าผ่าน USB/)
    assert.equal((markup.match(/<strong>NODE(?:0[1-9]|10)<\/strong>/g) || []).length, 10)
    assert.equal((markup.match(/<\/svg>เพิ่ม \/ คืนโหนด<\/button>/g) || []).length, 10)
    assert.match(markup, /aria-label="โหลดรายการโหนดใหม่"/)
    assert.match(markup, /type="checkbox"/)
    assert.match(markup, /เพิ่มโหนดและติดตั้งโปรแกรมในปุ่มเดียว/)
    assert.doesNotMatch(markup, /href="\/firmware\/index.html"|และติดตั้งเฟิร์มแวร์ FG1 แล้ว/)
  } finally {
    await server?.close()
    for (const [name, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
    }
  }
})
