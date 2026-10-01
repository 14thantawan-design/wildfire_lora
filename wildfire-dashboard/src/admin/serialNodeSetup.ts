// USB provisioning for FG1 firmware. Credentials never go to storage or logs.
import { adminJson } from './adminReadings'

type SerialPort = {
  readable: ReadableStream<Uint8Array> | null
  writable: WritableStream<Uint8Array> | null
  open(options: { baudRate: number }): Promise<void>
  close(): Promise<void>
  setSignals(signals: { dataTerminalReady?: boolean; requestToSend?: boolean }): Promise<void>
}
type SerialNavigator = Navigator & { serial?: { requestPort(): Promise<SerialPort> } }
type Registration = { node_id: string; generation: string; challenge: string; key: string; protocol: string }

export function supportsNodeUsb() {
  return window.isSecureContext && Boolean((navigator as SerialNavigator).serial)
}

export async function registerNodeThroughUsb(slot: number, replace: boolean, onProgress: (message: string) => void) {
  const serial = (navigator as SerialNavigator).serial
  if (!serial || !window.isSecureContext) throw new Error('ใช้เบราว์เซอร์ที่รองรับ Web Serial บน HTTPS หรือ localhost')
  // User gesture: request the local USB port BEFORE awaiting any API.
  const port = await serial.requestPort()
  await port.open({ baudRate: 115200 })
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let writer: WritableStreamDefaultWriter<Uint8Array> | undefined
  let setupReady = false
  let configurationSent = false
  try {
    if (!port.readable || !port.writable) throw new Error('เปิดพอร์ต USB ไม่สำเร็จ')
    reader = port.readable.getReader()
    writer = port.writable.getWriter()
    const decoder = new TextDecoder()
    const encoder = new TextEncoder()
    let buffer = ''
    const send = (message: string) => writer!.write(encoder.encode(`${message}\n`))
    const readLine = async (match: (line: string) => boolean, timeoutMs: number) => {
      let timedOut = false
      const timer = window.setTimeout(() => { timedOut = true; void reader?.cancel() }, timeoutMs)
      try {
        for (;;) {
          const newline = buffer.indexOf('\n')
          if (newline >= 0) {
            const line = buffer.slice(0, newline).trim()
            buffer = buffer.slice(newline + 1)
            if (line === 'FG1_STORAGE_ERROR') throw new Error('บอร์ดบันทึกการตั้งค่าไม่สำเร็จ')
            if (line === 'FG1_INVALID_CONFIG') throw new Error('บอร์ดไม่ยอมรับการตั้งค่า')
            if (match(line)) return line
            continue
          }
          const result = await reader!.read()
          if (result.done) throw new Error(timedOut ? 'หมดเวลารอจากบอร์ด ตรวจเฟิร์มแวร์และสาย USB' : 'การเชื่อมต่อ USB ถูกปิด')
          buffer += decoder.decode(result.value, { stream: true })
          if (buffer.length > 4096) throw new Error('ข้อมูลจากบอร์ดยาวผิดปกติ')
        }
      } finally { window.clearTimeout(timer) }
    }
    onProgress('เชื่อมต่อ USB และตรวจเฟิร์มแวร์…')
    // Normal application reset: GPIO0 (DTR) released, EN (RTS) briefly asserted.
    await port.setSignals({ dataTerminalReady: false, requestToSend: true })
    await new Promise((resolve) => window.setTimeout(resolve, 150))
    await port.setSignals({ requestToSend: false })
    await new Promise((resolve) => window.setTimeout(resolve, 1800))
    await send('FG_SETUP')
    await readLine((line) => line === 'FG1_READY', 12000)
    setupReady = true
    onProgress('ลงทะเบียนเลขโหนดและสร้างกุญแจเฉพาะเครื่อง…')
    const registration = await adminJson<Registration>('/devices', {
      method: 'POST', body: JSON.stringify({ slot, replace }),
    })
    try {
      onProgress('เขียนการตั้งค่าลงบอร์ดผ่าน USB…')
      configurationSent = true
      await send(JSON.stringify({ op: 'fg_provision', ...registration }))
      const line = await readLine((value) => {
        try { return JSON.parse(value)?.op === 'fg_provisioned' } catch { return false }
      }, 12000)
      const proof = JSON.parse(line) as { node_id?: string; generation?: string; proof?: string }
      if (proof.node_id !== registration.node_id || proof.generation !== registration.generation) {
        throw new Error('บอร์ดตอบกลับไม่ตรงกับการลงทะเบียนนี้')
      }
      onProgress('ตรวจหลักฐานจากบอร์ดและเปิดใช้งาน…')
      await adminJson(`/devices/${registration.node_id}/activate`, {
        method: 'POST', body: JSON.stringify({ generation: proof.generation, proof: proof.proof }),
      })
      try { await send(JSON.stringify({ op: 'fg_start' })) }
      catch { throw new Error('ลงทะเบียนสำเร็จแล้ว แต่สั่งเริ่มผ่าน USB ไม่สำเร็จ ให้กด RESET บนโหนด') }
      return registration.node_id
    } finally { registration.key = ''; buffer = '' }
  } finally {
    // A duplicate-slot/API failure before writing configuration must not leave
    // the existing board permanently paused in USB setup mode.
    if (setupReady && !configurationSent && writer) {
      await writer.write(new TextEncoder().encode('{"op":"fg_start"}\n')).catch(() => undefined)
    }
    if (reader) { await reader.cancel().catch(() => undefined); reader.releaseLock() }
    if (writer) writer.releaseLock()
    await port.close().catch(() => undefined)
  }
}
