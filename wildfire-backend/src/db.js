const mongoose = require('mongoose');

async function connectDB() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/wildfire_lora';

  mongoose.set('strictQuery', true);

  await mongoose.connect(uri);
  console.log(`connected MongoDB: ${mongoose.connection.name}`);
}

module.exports = connectDB;
