// แปลง Mongoose document เป็น object เพื่อส่งออก API
function normalizeNodeRisk(record) {
  return record.toObject ? record.toObject() : { ...record };
}

module.exports = {
  normalizeNodeRisk
};
