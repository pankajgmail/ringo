import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { DecryptCommand, GenerateDataKeyCommand, KMSClient } from "@aws-sdk/client-kms";
import { env } from "../env.ts";

// Envelope encryption: a fresh AES-256-GCM data key per value, wrapped by KMS.
// Layout: [2-byte wrapped-key length][wrapped key][12-byte IV][16-byte tag][ciphertext].
// In development without KMS the data key is "wrapped" by DEV_ENCRYPTION_KEY instead.

const kms = env.KMS_KEY_ID ? new KMSClient({}) : null;
const devKey = env.DEV_ENCRYPTION_KEY ? Buffer.from(env.DEV_ENCRYPTION_KEY, "base64") : null;

const aad = (context: Record<string, string>) => Buffer.from(JSON.stringify(Object.entries(context).sort()));

function gcm(key: Buffer, plain: Buffer, context: Record<string, string>) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(aad(context));
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]);
}
function ungcm(key: Buffer, blob: Buffer, context: Record<string, string>) {
  const d = createDecipheriv("aes-256-gcm", key, blob.subarray(0, 12));
  d.setAAD(aad(context));
  d.setAuthTag(blob.subarray(12, 28));
  return Buffer.concat([d.update(blob.subarray(28)), d.final()]);
}

async function newDataKey(context: Record<string, string>): Promise<{ plain: Buffer; wrapped: Buffer }> {
  if (kms) {
    const r = await kms.send(new GenerateDataKeyCommand({ KeyId: env.KMS_KEY_ID, KeySpec: "AES_256", EncryptionContext: context }));
    return { plain: Buffer.from(r.Plaintext!), wrapped: Buffer.from(r.CiphertextBlob!) };
  }
  const plain = randomBytes(32);
  return { plain, wrapped: gcm(devKey!, plain, context) };
}

async function unwrapKey(wrapped: Buffer, context: Record<string, string>): Promise<Buffer> {
  if (kms) {
    const r = await kms.send(new DecryptCommand({ CiphertextBlob: wrapped, EncryptionContext: context }));
    return Buffer.from(r.Plaintext!);
  }
  return ungcm(devKey!, wrapped, context);
}

/** `context` (e.g. { userId }) is bound to the ciphertext, so a value can't be swapped between users. */
export async function encrypt(value: string, context: Record<string, string>): Promise<Buffer> {
  const { plain, wrapped } = await newDataKey(context);
  const len = Buffer.alloc(2);
  len.writeUInt16BE(wrapped.length);
  return Buffer.concat([len, wrapped, gcm(plain, Buffer.from(value, "utf8"), context)]);
}

export async function decrypt(blob: Buffer, context: Record<string, string>): Promise<string> {
  const n = blob.readUInt16BE(0);
  const key = await unwrapKey(blob.subarray(2, 2 + n), context);
  return ungcm(key, blob.subarray(2 + n), context).toString("utf8");
}
