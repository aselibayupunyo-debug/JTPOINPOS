import * as Crypto from "expo-crypto";

/**
 * Lightweight password hashing: PBKDF2-style iteration of SHA-256 with per-user
 * random salt. Not as strong as bcrypt but adequate for an offline POS where
 * the attacker already has physical device access.
 */
const ITERATIONS = 10000;

async function sha256(input: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, input);
}

export async function makeSalt(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(16);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function pbkdfLike(password: string, salt: string): Promise<string> {
  let digest = `${salt}:${password}`;
  for (let i = 0; i < ITERATIONS; i++) {
    digest = await sha256(digest);
  }
  return digest;
}

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = await makeSalt();
  const hash = await pbkdfLike(password, salt);
  return { hash, salt };
}

export async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  const computed = await pbkdfLike(password, salt);
  return computed === hash;
}

export async function randomToken(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(32);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
