import type { Transport } from 'esptool-js'

export type NodeSerialPort = ConstructorParameters<typeof Transport>[0]
type FirmwarePart = { path: string; offset: number; size: number; sha256: string; md5: string }
type NodeManifest = { name: string; protocol: string; builds: { chipFamily: string; parts: FirmwarePart[] }[] }

// Write separate images, not merged padding over NVS / the durable FG1 counter.
const PARTS = [
  { path: 'node-bootloader.bin', offset: 0x1000, min: 4096, max: 0x7000 },
  { path: 'node-partitions.bin', offset: 0x8000, min: 3072, max: 0x1000 },
  { path: 'node-boot-app.bin', offset: 0xe000, min: 8192, max: 8192 },
  { path: 'node-app.bin', offset: 0x10000, min: 65536, max: 0x140000 },
]

export async function installNodeFirmware(port: NodeSerialPort, onProgress: (message: string) => void) {
  onProgress('ตรวจไฟล์โปรแกรม FG1 ก่อนติดตั้ง…')
  const response = await fetch('/firmware/manifest.json', { cache: 'no-store' })
  if (!response.ok) throw new Error('โหลดไฟล์ติดตั้ง FG1 ไม่สำเร็จ ยังไม่ได้เขียนโปรแกรมลงบอร์ด')
  const manifest = await response.json() as NodeManifest
  const parts = manifest.builds?.[0]?.parts
  if (manifest.name !== 'ForestGuard FG1 LILYGO LoRa32 433' || manifest.protocol !== 'FG1' ||
      manifest.builds?.length !== 1 || manifest.builds[0].chipFamily !== 'ESP32' ||
      !Array.isArray(parts) || parts.length !== PARTS.length) {
    throw new Error('ไฟล์ติดตั้ง FG1 ยังไม่พร้อม ยังไม่ได้เขียนโปรแกรมลงบอร์ด')
  }
  const files = await Promise.all(PARTS.map(async (expected, index) => {
    const part = parts[index]
    if (part.path !== expected.path || part.offset !== expected.offset ||
        !Number.isInteger(part.size) || part.size < expected.min || part.size > expected.max || part.size % 4 ||
        !/^[a-f0-9]{64}$/.test(part.sha256) || !/^[a-f0-9]{32}$/.test(part.md5)) {
      throw new Error('รายละเอียดไฟล์ FG1 ไม่ถูกต้อง ยังไม่ได้เขียนโปรแกรมลงบอร์ด')
    }
    const binaryResponse = await fetch(`/firmware/${expected.path}`, { cache: 'no-store' })
    if (!binaryResponse.ok) throw new Error(`โหลด ${expected.path} ไม่สำเร็จ ยังไม่ได้เขียนโปรแกรมลงบอร์ด`)
    const binary = await binaryResponse.arrayBuffer()
    if (binary.byteLength !== part.size) throw new Error('ขนาดไฟล์ FG1 ไม่ตรงกับ manifest')
    const digest = await crypto.subtle.digest('SHA-256', binary)
    const hash = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
    if (hash !== part.sha256) throw new Error('ไฟล์ FG1 ไม่ตรงกับ checksum ยังไม่ได้เขียนโปรแกรมลงบอร์ด')
    const data = new Uint8Array(binary)
    if ((index === 0 || index === 3) && data[0] !== 0xe9) throw new Error('ไฟล์โปรแกรมไม่ใช่ ESP32')
    return { data, address: part.offset, md5: part.md5 }
  }))

  const { ESPLoader, Transport } = await import('esptool-js')
  const transport = new Transport(port, false)
  // Never log serial bytes: provisioning keys use this same port afterwards.
  const loader = new ESPLoader({ transport, baudrate: 115200, debugLogging: false,
    terminal: { clean() {}, write() {}, writeLine() {} } })
  try {
    onProgress('เชื่อมต่อบอร์ดเพื่อติดตั้ง FG1… ถ้าเชื่อมต่อไม่ได้ให้กดปุ่ม BOOT ค้างชั่วครู่')
    await loader.main()
    if (loader.chip.CHIP_NAME !== 'ESP32' || await loader.detectFlashSize() !== '4MB') {
      throw new Error('รองรับเฉพาะบอร์ดโหนด ESP32 แฟลช 4 MB ตามโครงงาน ยังไม่ได้เขียนโปรแกรม')
    }
    await loader.writeFlash({ fileArray: files, flashMode: 'keep', flashFreq: 'keep', flashSize: 'keep',
      eraseAll: false, compress: true,
      reportProgress: (index, written, total) => {
        onProgress(`ติดตั้ง FG1 ไฟล์ ${index + 1}/${files.length}: ${Math.floor(written / total * 100)}% · อย่าถอดสาย USB`)
      },
    })
    onProgress('ตรวจโปรแกรมที่เขียนลงบอร์ด…')
    for (const file of files) {
      if (await loader.flashMd5sum(file.address, file.data.length) !== file.md5) {
        throw new Error('ตรวจโปรแกรมบนบอร์ดไม่ผ่าน ให้กดเพิ่มโหนดเพื่อติดตั้งใหม่')
      }
    }
  } finally {
    // Reset and release the flasher reader before provisioning on the same port.
    if (port.readable) {
      try { await loader.after('hard_reset') }
      finally { await transport.disconnect() }
    }
  }
  onProgress('ติดตั้ง FG1 แล้ว กำลังตั้งรหัสและกุญแจโหนดต่อให้อัตโนมัติ…')
}
