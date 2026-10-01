// Read-only release check: compiled images, hashes and the one-button Dashboard.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, lstatSync } from 'node:fs'
import { resolve, join } from 'node:path'

const root = resolve(process.argv[2] || 'wildfire-dashboard/dist')
const manifestFile = join(root, 'firmware/manifest.json')
assert.ok(lstatSync(manifestFile).size < 16384)
const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
assert.equal(manifest.name, 'ForestGuard FG1 LILYGO LoRa32 433')
assert.equal(manifest.protocol, 'FG1')
assert.equal(manifest.board_fqbn, 'esp32:esp32:ttgo-lora32:FlashFreq=40')
assert.equal(manifest.builds.length, 1)
assert.equal(manifest.builds[0].chipFamily, 'ESP32')
const expected = [
  ['node-bootloader.bin', 0x1000, 0x7000], ['node-partitions.bin', 0x8000, 4096],
  ['node-boot-app.bin', 0xe000, 8192], ['node-app.bin', 0x10000, 0x140000],
]
assert.equal(manifest.builds[0].parts.length, expected.length)
for (const [index, [name, offset, maximum]] of expected.entries()) {
  const part = manifest.builds[0].parts[index]
  assert.equal(part.path, name)
  assert.equal(part.offset, offset)
  const file = join(root, 'firmware', name)
  const info = lstatSync(file)
  assert.ok(info.isFile() && !info.isSymbolicLink() && info.nlink === 1 && info.size <= maximum)
  assert.equal(info.size, part.size)
  const bytes = readFileSync(file)
  for (const algorithm of ['sha256', 'md5']) assert.equal(createHash(algorithm).update(bytes).digest('hex'), part[algorithm])
  if (index === 0 || index === 3) assert.equal(bytes[0], 0xe9)
  if (index === 3) for (const marker of ['FG1_READY', 'fg_provision', 'fg_provisioned']) assert.ok(bytes.includes(marker))
}
const html = readFileSync(join(root, 'index.html'), 'utf8')
const asset = html.match(/src="(\/assets\/[A-Za-z0-9._-]+\.js)"/)[1]
const bundle = readFileSync(join(root, asset.slice(1)), 'utf8')
assert.ok(bundle.includes('เพิ่มโหนดและติดตั้งโปรแกรมในปุ่มเดียว'))
assert.ok(!bundle.includes('และติดตั้งเฟิร์มแวร์ FG1 แล้ว'))
assert.ok(!bundle.includes('เปิดหน้าติดตั้งเฟิร์มแวร์ผ่าน USB'))
console.log('Verified compiled FG1 images, all checksums, USB markers and one-button Dashboard.')
