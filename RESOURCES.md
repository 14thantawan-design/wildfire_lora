# Wildfire LoRa API Resources

## Knowledge

- [Backend Architecture & Guide](file:///c:/wildfire_lora/wildfire-backend/README.md)
  Overview of backend requirements, environment variables, API endpoints, Telegram bot setup, and manual testing.
- [Code Structure Documentation](file:///c:/wildfire_lora/docs/code-structure.md)
  System-wide architecture map connecting Gateway HTTP, Express server, models, services, and dashboard.
- [Database Schema Documentation](file:///c:/wildfire_lora/docs/database-schema.md)
  Detailed schema definitions and indexes for `nodes`, `readings`, `alerts`, and `commands`.
- [Firmware Risk Rules](file:///c:/wildfire_lora/docs/node-risk-rules.md)
  Documentation on why the API trusts the firmware's edge calculation (`st`) without recalculating formulas.
- [Express.js Documentation](https://expressjs.com)
  Reference for Express routing, middleware chaining, and error handling.
- [MongoDB Aggregation Guide](https://www.mongodb.com/docs/manual/aggregation/)
  Reference for `$group`, `$sort`, and time-bucketing formulas used in the readings API.

## Wisdom (Communities)

- [ESP32 & LoRa Community](https://esp32.com/)
  Hardware-to-gateway patterns, deep-sleep timing, and packet serialization.
- [Node.js / Express Community](https://github.com/expressjs/express)
  Production REST API patterns, security middleware, and idempotency.
