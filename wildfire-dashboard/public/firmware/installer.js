const status = document.querySelector('#status');
const confirmation = document.querySelector('#confirm');
const installer = document.querySelector('#installer');
try {
  const response = await fetch('manifest.json', { cache: 'no-store' });
  if (!response.ok) throw new Error('ไม่มี manifest ของเฟิร์มแวร์');
  const manifest = await response.json();
  if (manifest.name !== 'ForestGuard FG1 LILYGO LoRa32 433' || manifest.builds?.length !== 1 ||
      manifest.builds[0].chipFamily !== 'ESP32' || manifest.builds[0].parts?.length !== 1 ||
      manifest.builds[0].parts[0].path !== 'node-merged.bin' || manifest.builds[0].parts[0].offset !== 0) {
    throw new Error('ยังไม่มีเฟิร์มแวร์ที่ผ่านการคอมไพล์และตรวจรุ่นบอร์ด ต้องเตรียมไฟล์ติดตั้งก่อนใช้งาน');
  }
  const firmware = await fetch('node-merged.bin', { cache: 'no-store' });
  if (!firmware.ok) throw new Error('ไม่พบไฟล์เฟิร์มแวร์');
  const binary = await firmware.arrayBuffer();
  if (binary.byteLength < 65536 || binary.byteLength > 4194304 || new Uint8Array(binary)[4096] !== 0xe9) {
    throw new Error('ไฟล์ติดตั้งไม่ใช่ merged binary ของ ESP32 ที่รองรับ');
  }
  const digest = await crypto.subtle.digest('SHA-256', binary);
  const hash = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
  if (hash !== manifest.sha256) throw new Error('ไฟล์เฟิร์มแวร์ไม่ตรงกับ checksum ใน manifest');
  // Self-host the pinned release bundle. No third-party script on the admin origin.
  await import('./vendor/install-button.js');
  confirmation.disabled = false;
  confirmation.addEventListener('change', () => { installer.hidden = !confirmation.checked; });
  status.textContent = 'ไฟล์ติดตั้งพร้อม ตรวจรุ่นบอร์ดก่อนกดติดตั้ง';
} catch (error) {
  status.textContent = error instanceof Error ? error.message : 'โหลดเครื่องมือติดตั้งไม่สำเร็จ';
}
