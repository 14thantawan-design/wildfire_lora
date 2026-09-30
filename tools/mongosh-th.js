// โหลดเป็น .mongoshrc.js ใน Mongo container เพื่อดู Date เป็นเวลาไทยโดยไม่แก้ข้อมูลจริง
function thaiDates(value) {
  if (value instanceof Date) {
    return `${value.toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok', hour12: false })} +07:00`
  }
  if (Array.isArray(value)) return value.map(thaiDates)
  if (value && typeof value === 'object' && value.constructor?.name === 'Object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, thaiDates(item)]))
  }
  return value
}

function showThai(collectionName, filter = {}, limit = 20) {
  db.getCollection(collectionName).find(filter).limit(limit).forEach((doc) => printjson(thaiDates(doc)))
}
