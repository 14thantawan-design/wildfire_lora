# Codex / Next Developer Notes

This robust no-DS18B20 build fixes the major delta-only issue and adds several safety mechanisms:

- Baseline warm-up instead of using the first sample as normal baseline
- Boot abnormal guard so smoke/heat at startup is not learned as baseline
- Previous delta normalized to rate per minute
- Baseline delta for sustained abnormal values
- Absolute thresholds as fallback
- Critical debounce: CRITICAL requires consecutive confirmation cycles
- CRITICAL requires smoke evidence by default (`REQUIRE_SMOKE_FOR_CRITICAL 1`)
- Sharp health checks for 0/4095/stuck readings
- Slow baseline adaptation in WATCH only when there is no smoke evidence
- Gateway parses and prints `sr`, `ar`, `hr`, `g`, and `bc`

Important constraints:

- Keep `node_id` and `seq`.
- Keep Gateway multi-node support.
- Keep compact LoRa payload below `MAX_SAFE_PAYLOAD_BYTES`.
- Do not make CRITICAL depend on one sensor only.
- Do not let baseline update during smoke-related WATCH/WARNING/CRITICAL.

Suggested next improvements:

1. Add ACK for CRITICAL packets from Gateway to Node.
2. Save baseline to NVS/Preferences after calibration.
3. Add a manual recalibration command or button.
4. Add battery voltage calibration.
5. Add web/API upload from Gateway.
6. Add outdoor enclosure/radiation shield validation.
