// เปิดการเชื่อมต่อ Mongoose ไปยังฐานข้อมูลที่ MONGODB_URI กำหนด
const mongoose = require('mongoose');

// สำรอง readings ก่อนถอดดัชนี seq/session เก่าเพียงครั้งเดียว
async function allowRepeatedReadings(db) {
  if (!await db.listCollections({ name: 'readings' }).hasNext()) return;
  const readings = db.collection('readings');
  const indexes = await readings.listIndexes().toArray();
  const oldIndexes = indexes.filter(({ key }) => {
    const keys = Object.keys(key);
    return (keys.length === 1 && key.seq === 1) ||
      (keys.length === 2 && key.node_id === 1 && key.seq === -1) ||
      (keys.length === 3 && key.node_id === 1 && key.session_id === 1 && key.seq === 1);
  });
  if (oldIndexes.length === 0) return;

  const backupName = 'readings_backup_before_simple_packets';
  if (await db.listCollections({ name: backupName }).hasNext()) {
    throw new Error(`${backupName} already exists; check it before changing indexes`);
  }
  const before = await readings.countDocuments();
  await readings.aggregate([{ $match: {} }, { $out: backupName }]).toArray();
  const after = await readings.countDocuments();
  const copied = await db.collection(backupName).countDocuments();
  if (before !== after || before !== copied) {
    throw new Error('readings changed during backup; old index was not removed');
  }
  for (const index of oldIndexes) await readings.dropIndex(index.name);
  console.log(`readings backed up to ${backupName}; removed ${oldIndexes.length} old indexes`);
}

// เชื่อม MongoDB หนึ่งครั้งตอน Backend เริ่มทำงาน
async function connectDB() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/wildfire_lora';

  mongoose.set('strictQuery', true);

  await mongoose.connect(uri);
  try {
    await allowRepeatedReadings(mongoose.connection.db);
  } catch (error) {
    await mongoose.disconnect();
    throw error;
  }
  console.log(`connected MongoDB: ${mongoose.connection.name}`);
}

module.exports = connectDB;
module.exports.allowRepeatedReadings = allowRepeatedReadings;
