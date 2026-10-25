// @effect-diagnostics nodeBuiltinImport:off -- One-time desktop-to-environment credential transfer.
import * as NodeCrypto from "node:crypto";
import type { LinearConnectionEnvelope } from "@t3tools/contracts";

/** The renderer carries ciphertext only; the destination environment owns the private key. */
export function sealLinearConnection(value: string, recipient: string): LinearConnectionEnvelope {
  const { publicKey, privateKey } = NodeCrypto.generateKeyPairSync("x25519");
  const key = NodeCrypto.diffieHellman({
    privateKey,
    publicKey: NodeCrypto.createPublicKey({
      key: Buffer.from(recipient, "base64"),
      format: "der",
      type: "spki",
    }),
  });
  const iv = NodeCrypto.randomBytes(12);
  const cipher = NodeCrypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    publicKey: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}
export function openLinearConnection(
  envelope: LinearConnectionEnvelope,
  privateKey: NodeCrypto.KeyObject,
): unknown {
  const key = NodeCrypto.diffieHellman({
    privateKey,
    publicKey: NodeCrypto.createPublicKey({
      key: Buffer.from(envelope.publicKey, "base64"),
      format: "der",
      type: "spki",
    }),
  });
  const decipher = NodeCrypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(envelope.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8"),
  ) as unknown;
}
