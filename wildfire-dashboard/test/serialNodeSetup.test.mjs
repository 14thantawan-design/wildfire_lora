import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'vite'

// Dummy binary bytes and dummy credentials: no physical ports or live API calls.
const images = [
  ['node-bootloader.bin', 0x1000, 4096], ['node-partitions.bin', 0x8000, 3072],
  ['node-boot-app.bin', 0xe000, 8192], ['node-app.bin', 0x10000, 65536],
].map(([path, offset, size]) => {
  const data = new Uint8Array(size).fill(0x20)
  data[0] = 0xe9
  return { path, offset, size, data,
    sha256: createHash('sha256').update(data).digest('hex'),
    md5: createHash('md5').update(data).digest('hex') }
})
const manifest = { name: 'ForestGuard FG1 LILYGO LoRa32 433', protocol: 'FG1',
  builds: [{ chipFamily: 'ESP32', parts: images.map(({ data: _data, ...part }) => part) }] }

async function scenario(t, options = {}) {
  // Bundle the browser library for SSR too; its extensionless imports are not Node-native.
  const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom',
    ssr: { noExternal: ['esptool-js'] } })
  const { ESPLoader, Transport } = await server.ssrLoadModule('/node_modules/esptool-js/lib/index.js')
  const events = []
  const globals = ['window', 'navigator', 'fetch'].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)])
  let controller
  const port = { readable: null, writable: null, getInfo: () => ({}),
    async open() {
      events.push('open')
      this.readable = new ReadableStream({ start(value) { controller = value } })
      this.writable = new WritableStream({ write(bytes) {
        const line = new TextDecoder().decode(bytes).trim()
        if (line === 'FG_SETUP') {
          events.push('setup')
          controller.enqueue(new TextEncoder().encode('FG1_READY\n'))
        } else {
          const message = JSON.parse(line)
          events.push(message.op)
          if (message.op === 'fg_provision') {
            controller.enqueue(new TextEncoder().encode(JSON.stringify({ op: 'fg_provisioned',
              node_id: message.node_id, generation: message.generation, proof: 'dummy-proof' }) + '\n'))
          }
        }
      } })
    },
    async close() { events.push('close'); this.readable = null; this.writable = null },
    async setSignals() {},
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { isSecureContext: true,
    setTimeout(callback, milliseconds) { return setTimeout(callback, milliseconds < 2000 ? 0 : milliseconds) },
    clearTimeout,
  } })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serial: {
    async requestPort() {
      events.push('choose-port')
      if (options.cancel) throw new Error('test: port selection canceled')
      return port
    },
  } } })
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async (path) => {
    events.push(path)
    if (path === '/firmware/manifest.json') return Response.json(options.missing ? { builds: [] } : manifest)
    const image = images.find((part) => path === `/firmware/${part.path}`)
    if (image) {
      const data = image.data.slice()
      if (options.corrupt) data[4] ^= 1
      return new Response(data)
    }
    if (path === '/api/devices') return Response.json({ node_id: 'NODE02', generation: '0102030405060708',
      key: 'test-only-key', challenge: 'test-only-challenge', protocol: 'FG1' })
    if (path === '/api/devices/NODE02/activate') return Response.json({ ok: true })
    throw new Error(`Unexpected mock URL: ${path}`)
  } })
  t.mock.method(ESPLoader.prototype, 'main', async function () {
    events.push('loader'); await port.open(); this.chip = { CHIP_NAME: options.wrongChip ? 'ESP32-S3' : 'ESP32' }
  })
  t.mock.method(ESPLoader.prototype, 'detectFlashSize', async () => options.smallFlash ? '2MB' : '4MB')
  t.mock.method(ESPLoader.prototype, 'writeFlash', async (settings) => {
    events.push('flash')
    assert.equal(settings.eraseAll, false)
    assert.equal(settings.flashMode, 'keep')
    assert.deepEqual(settings.fileArray.map((file) => file.address), [0x1000, 0x8000, 0xe000, 0x10000])
    assert.ok(!settings.fileArray.some((file) => file.address < 0xe000 && file.address + file.data.length > 0x9000))
    if (options.unplug) throw new Error('test: USB unplugged')
    settings.reportProgress(3, 100, 100)
  })
  t.mock.method(ESPLoader.prototype, 'flashMd5sum', async (address) => {
    events.push('verify')
    return options.badFlash ? '0'.repeat(32) : images.find((image) => image.offset === address).md5
  })
  t.mock.method(ESPLoader.prototype, 'after', async () => { events.push('reset') })
  t.mock.method(Transport.prototype, 'disconnect', async () => { await port.close() })
  t.after(async () => {
    await server.close()
    t.mock.restoreAll()
    for (const [name, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else Reflect.deleteProperty(globalThis, name)
    }
  })
  const { registerNodeThroughUsb } = await server.ssrLoadModule('/src/admin/serialNodeSetup.ts')
  return { events, port, run: () => registerNodeThroughUsb(2, false, () => {}) }
}

test('one port selection installs once, verifies, then provisions and activates automatically', async (t) => {
  const { events, port, run } = await scenario(t)
  assert.equal(await run(), 'NODE02')
  assert.equal(events.filter((value) => value === 'choose-port').length, 1)
  assert.equal(events.filter((value) => value === 'flash').length, 1)
  assert.ok(events.indexOf('flash') < events.indexOf('setup'))
  assert.ok(events.lastIndexOf('verify') < events.indexOf('/api/devices'))
  assert.ok(events.indexOf('fg_provision') < events.indexOf('/api/devices/NODE02/activate'))
  assert.ok(events.indexOf('/api/devices/NODE02/activate') < events.indexOf('fg_start'))
  assert.equal(port.readable, null)
})

for (const [name, options, error] of [
  ['port selection canceled', { cancel: true }, /selection canceled/],
  ['missing firmware', { missing: true }, /ยังไม่พร้อม/],
  ['corrupt firmware', { corrupt: true }, /checksum/],
  ['wrong chip', { wrongChip: true }, /รองรับเฉพาะ/],
  ['small flash', { smallFlash: true }, /รองรับเฉพาะ/],
  ['unplug during installation', { unplug: true }, /USB unplugged/],
  ['flash verification failure', { badFlash: true }, /ตรวจโปรแกรมบนบอร์ดไม่ผ่าน/],
]) {
  test(`${name} never creates/revokes credentials`, async (t) => {
    const { events, port, run } = await scenario(t, options)
    await assert.rejects(run(), error)
    assert.equal(events.includes('/api/devices'), false)
    if (options.cancel || options.missing || options.corrupt || options.wrongChip || options.smallFlash) assert.equal(events.includes('flash'), false)
    assert.equal(port.readable, null)
  })
}
