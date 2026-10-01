#pragma once
#include <Arduino.h>
#include <mbedtls/gcm.h>
#include <mbedtls/md.h>

// FG1 wire layout: direction[4], slot[1], generation[8], sequence BE[8], ciphertext, tag[16].
// Nonce = direction[4] + sequence[8]. Uplink counter never repeats for a key.
// Exactly ONE downlink reply per uplink: different nonce domain FGD1, same sequence.
// ponytail: one trusted gateway only; multiple gateways require separate downlink key/nonce domains.
constexpr size_t FG_HEADER = 21;
constexpr size_t FG_TAG = 16;
constexpr size_t FG_MAX_FRAME = 255;
constexpr uint64_t FG_MAX_SEQUENCE = 9007199254740991ULL;

struct FgFrameInfo {
  uint8_t slot;
  uint8_t generation[8];
  uint64_t sequence;
};

bool fgParseHex(const String &text, uint8_t *output, size_t bytes) {
  if (text.length() != bytes * 2) return false;
  for (size_t i = 0; i < bytes; i++) {
    unsigned value = 0;
    for (size_t j = 0; j < 2; j++) {
      char c = text[i * 2 + j];
      if (c >= '0' && c <= '9') value = value * 16 + c - '0';
      else if (c >= 'a' && c <= 'f') value = value * 16 + c - 'a' + 10;
      else return false;
    }
    output[i] = value;
  }
  return true;
}

String fgHex(const uint8_t *bytes, size_t length) {
  static const char alphabet[] = "0123456789abcdef";
  String result;
  result.reserve(length * 2);
  for (size_t i = 0; i < length; i++) {
    result += alphabet[bytes[i] >> 4];
    result += alphabet[bytes[i] & 15];
  }
  return result;
}

String fgNodeId(uint8_t slot) {
  return String("NODE") + (slot < 10 ? "0" : "") + slot;
}

bool fgInspect(const uint8_t *frame, size_t length, const char *direction, FgFrameInfo &info) {
  if (length <= FG_HEADER + FG_TAG || length > FG_MAX_FRAME || memcmp(frame, direction, 4)) return false;
  info.slot = frame[4];
  if (info.slot < 1 || info.slot > 10) return false;
  memcpy(info.generation, frame + 5, 8);
  info.sequence = 0;
  for (size_t i = 13; i < FG_HEADER; i++) info.sequence = (info.sequence << 8) | frame[i];
  return info.sequence > 0 && info.sequence <= FG_MAX_SEQUENCE;
}

size_t fgEncrypt(const String &payload, const uint8_t *key, const FgFrameInfo &info,
                 const char *direction, uint8_t *frame) {
  if (payload.length() == 0 || payload.length() > FG_MAX_FRAME - FG_HEADER - FG_TAG ||
      info.slot < 1 || info.slot > 10 || info.sequence == 0 || info.sequence > FG_MAX_SEQUENCE) return 0;
  memcpy(frame, direction, 4);
  frame[4] = info.slot;
  memcpy(frame + 5, info.generation, 8);
  for (size_t i = 0; i < 8; i++) frame[13 + i] = (info.sequence >> ((7 - i) * 8)) & 255;
  uint8_t nonce[12];
  memcpy(nonce, frame, 4);
  memcpy(nonce + 4, frame + 13, 8);
  mbedtls_gcm_context ctx;
  mbedtls_gcm_init(&ctx);
  int result = mbedtls_gcm_setkey(&ctx, MBEDTLS_CIPHER_ID_AES, key, 256);
  if (!result) result = mbedtls_gcm_crypt_and_tag(&ctx, MBEDTLS_GCM_ENCRYPT, payload.length(),
    nonce, sizeof(nonce), frame, FG_HEADER, (const uint8_t *)payload.c_str(), frame + FG_HEADER,
    FG_TAG, frame + FG_HEADER + payload.length());
  mbedtls_gcm_free(&ctx);
  return result == 0 ? FG_HEADER + payload.length() + FG_TAG : 0;
}

bool fgDecrypt(const uint8_t *frame, size_t length, const uint8_t *key,
               const char *direction, FgFrameInfo &info, String &payload) {
  if (!fgInspect(frame, length, direction, info)) return false;
  const size_t plaintextLength = length - FG_HEADER - FG_TAG;
  uint8_t nonce[12];
  memcpy(nonce, frame, 4);
  memcpy(nonce + 4, frame + 13, 8);
  uint8_t plaintext[FG_MAX_FRAME] = {};
  mbedtls_gcm_context ctx;
  mbedtls_gcm_init(&ctx);
  int result = mbedtls_gcm_setkey(&ctx, MBEDTLS_CIPHER_ID_AES, key, 256);
  if (!result) result = mbedtls_gcm_auth_decrypt(&ctx, plaintextLength, nonce, sizeof(nonce),
    frame, FG_HEADER, frame + length - FG_TAG, FG_TAG, frame + FG_HEADER, plaintext);
  mbedtls_gcm_free(&ctx);
  if (result) return false;
  // JSON may not contain embedded NUL bytes.
  if (memchr(plaintext, 0, plaintextLength)) return false;
  plaintext[plaintextLength] = 0;
  payload = String((char *)plaintext);
  return true;
}

String fgProvisionProof(const uint8_t *key, const String &nodeId,
                        const String &generation, const String &challenge) {
  String message = String("FG1P|") + nodeId + "|" + generation + "|" + challenge;
  uint8_t digest[32];
  const mbedtls_md_info_t *md = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  if (!md || mbedtls_md_hmac(md, key, 32, (const uint8_t *)message.c_str(), message.length(), digest)) return "";
  return fgHex(digest, sizeof(digest));
}
