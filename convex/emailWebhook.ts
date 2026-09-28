import {internal} from "./_generated/api";
import {internalMutation} from "./_generated/server";
import {v} from "convex/values";
import {disableEmailForAddress} from "./emailPreferences";

export const handleResendEvent = internalMutation({
  args: {
    type: v.string(),
    email: v.optional(v.string()),
    createdAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const type = args.type.trim().toLowerCase();
    if (!args.email) return null;
    if (type === "email.bounced" || type === "email.complained") {
      await disableEmailForAddress(ctx, args.email);
      await ctx.db.insert("emailSendLog", {
        recipient: "",
        email: args.email.trim().toLowerCase(),
        status: "failed",
        reason: type,
        createdAt: args.createdAt,
      });
    }
    return null;
  },
});

export async function verifySvixSignature(secret: string, payload: string, headers: {id: string; timestamp: string; signature: string}) {
  const timestamp = Number(headers.timestamp);
  if (!Number.isFinite(timestamp)) return false;
  const age = Math.abs(Date.now() / 1000 - timestamp);
  if (age > 300) return false;
  const key = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let keyBytes: Uint8Array;
  try {
    keyBytes = Uint8Array.from(atob(key), char => char.charCodeAt(0));
  } catch {
    return false;
  }
  const signed = `${headers.id}.${headers.timestamp}.${payload}`;
  const keyBuffer = keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer;
  const cryptoKey = await crypto.subtle.importKey("raw", keyBuffer, {name: "HMAC", hash: "SHA-256"}, false, ["sign"]);
  const signedBytes = new TextEncoder().encode(signed);
  const signedBuffer = signedBytes.buffer.slice(signedBytes.byteOffset, signedBytes.byteOffset + signedBytes.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.sign("HMAC", cryptoKey, signedBuffer);
  const expected = btoa(String.fromCharCode(...new Uint8Array(digest)));
  for (const part of headers.signature.split(" ")) {
    const [version, signature] = part.split(",", 2);
    if (version === "v1" && signature === expected) return true;
  }
  return false;
}
