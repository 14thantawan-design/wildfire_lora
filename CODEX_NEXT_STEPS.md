# Codex / Next Developer Notes

The current source uses the research-aligned, threshold-based state model. The old score, baseline, delta/rate, calibration, `CRITICAL`, and `SURVEILLANCE` model has been removed.

## Authoritative state rules

- `SENSOR_FAULT` when a required sensor is invalid.
- `WARNING` when `T > 45`, `P > 150`, or `T >= 30 && RH <= 30`.
- `WATCH` (only when not `WARNING`) when `T > 35`, `P > 50`, or `RH < 50`.
- `NORMAL` otherwise.

The Sensor Node is the only component that calculates the state. The Gateway, backend, database/API, Telegram notifications, and dashboard carry and display the node's state and reason bits; they must not calculate a separate risk score.

## Timing and state transitions

- `NORMAL`: measure/send every 300 seconds.
- `WATCH`: measure/send every 120 seconds.
- `WARNING`: send immediately, then measure/send every 20 seconds without deep sleep.
- Escalation is immediate.
- Recovery requires 3 consecutive lower-risk cycles. `WARNING` recovers through `WATCH` before `NORMAL`.

## Protocol constraints

- Packet version is `v=7`.
- Keep `node_id`, `seq`, `st`, `rb`, `rv`, `at`, `h`, `pm`, `sh`, and `ri`.
- Keep Gateway multi-node support and the compact payload below `MAX_SAFE_PAYLOAD_BYTES`.
- Do not reintroduce score/baseline fields as authoritative risk data.
- See `docs/node-risk-v2.md` for thresholds, boundary cases, reason-bit definitions, limitations, and verification.

## Deployment note

The tracked source files are authoritative. Rebuild firmware before flashing; previously tracked `build/` artifacts may contain an older model and must not be used as current firmware.

Suggested next improvements:

1. Calibrate Sharp GP2Y1014AU0F against a reference instrument before claiming quantitative accuracy.
2. Add an ACK/retry design for `WARNING` packets and validate SF12 airtime/collisions with both nodes.
3. Add end-to-end Gateway-to-backend upload if direct automatic ingestion is required.
4. Validate the outdoor enclosure and radiation shield in field conditions.
