# Codex / Next Developer Notes

This SHT31 + Sharp build fixes the major delta-only issue and adds several safety mechanisms:

- Baseline warm-up instead of using the first sample as normal baseline
- Boot abnormal guard so smoke/heat at startup is not learned as baseline
- Previous delta normalized to rate per minute
- Baseline delta for sustained abnormal values
- Absolute thresholds as fallback
- Critical debounce: CRITICAL requires consecutive confirmation cycles
- Risk model v2 uses heat 40 / humidity 40 / smoke 20; CRITICAL does not require smoke
- Sharp health checks for 0/4095/stuck readings
- Slow baseline adaptation in WATCH only when there is no smoke evidence
- Gateway parses and prints `sr`, `ar`, `hr`, `g`, and `bc`

Important constraints:

- Node firmware is the only risk calculator. Backend/API/Telegram use its state and score.
- See docs/node-risk-v2.md for current thresholds, compatibility, and verification.
- Keep `node_id` and `seq`.
- Keep Gateway multi-node support.
- Keep compact LoRa payload below `MAX_SAFE_PAYLOAD_BYTES`.
- Do not make CRITICAL depend on one sensor only.
- Do not let baseline update during smoke-related WATCH/WARNING/CRITICAL.

Suggested next improvements:

1. Add ACK for CRITICAL packets from Gateway to Node.
2. Save baseline to NVS/Preferences after calibration.
3. Add a manual recalibration command or button.
4. Add web/API upload from Gateway.
5. Add outdoor enclosure/radiation shield validation.
