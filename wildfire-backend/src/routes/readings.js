// Public Reading API: ค่าล่าสุดและประวัติสำหรับ Dashboard
const express = require('express');
const Reading = require('../models/Reading');
const adminReadingsRouter = require('./readings/adminReadings');
const {
  buildReadingUpdate,
  normalizeNodeId,
  normalizeReadingIds,
  parseBucketMs,
  parseDate,
  parseLimit,
  serializeReading
} = require('./readings/readingTools');

const router = express.Router();

// แยก Admin API ไว้ใต้ /api/readings/admin และตรวจสิทธิ์ใน router ของตัวเอง
router.use('/admin', adminReadingsRouter);

// คืน Reading ล่าสุดของทุกโหนดอย่างละหนึ่งรายการ
router.get('/latest', async (req, res, next) => {
  try {
    const latest = await Reading.aggregate([
      { $sort: { timestamp: -1 } },
      { $group: { _id: '$node_id', reading: { $first: '$$ROOT' } } },
      { $replaceRoot: { newRoot: '$reading' } },
      { $sort: { node_id: 1 } }
    ]);
    return res.json(latest.map(serializeReading));
  } catch (error) {
    return next(error);
  }
});

// คืนประวัติหนึ่งโหนด หรือเฉลี่ยเป็นช่วงเวลาเมื่อ Dashboard ส่ง bucket_ms
router.get('/:node_id', async (req, res, next) => {
  try {
    const limit = parseLimit(req.query.limit, 100);
    const from = parseDate(req.query.from);
    const bucketMs = parseBucketMs(req.query.bucket_ms);
    const query = { node_id: req.params.node_id };
    if (from) query.timestamp = { $gte: from };

    if (bucketMs) {
      const readings = await Reading.aggregate([
        { $match: query },
        { $sort: { timestamp: 1 } },
        {
          $group: {
            _id: {
              $subtract: [
                { $toLong: '$timestamp' },
                { $mod: [{ $toLong: '$timestamp' }, bucketMs] }
              ]
            },
            node_id: { $last: '$node_id' },
            seq: { $last: '$seq' },
            timestamp: { $last: '$timestamp' },
            state: { $last: '$state' },
            air_temp: { $avg: '$air_temp' },
            humidity: { $avg: '$humidity' },
            particle_adc: { $avg: '$particle_adc' },
            sensor_health: { $last: '$sensor_health' },
            rssi: { $last: '$rssi' },
            snr: { $last: '$snr' }
          }
        },
        { $sort: { timestamp: -1 } },
        { $limit: limit }
      ]);
      return res.json(readings.map(serializeReading));
    }

    const readings = await Reading.find(query).sort({ timestamp: -1 }).limit(limit);
    return res.json(readings.map(serializeReading));
  } catch (error) {
    return next(error);
  }
});

module.exports = router;

// คง export เหล่านี้ไว้ให้ชุดทดสอบและโค้ดเดิมเรียกใช้ได้
module.exports.buildReadingUpdate = buildReadingUpdate;
module.exports.normalizeNodeId = normalizeNodeId;
module.exports.normalizeReadingIds = normalizeReadingIds;
module.exports.serializeReading = serializeReading;
