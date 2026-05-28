/**
 * Ed25519 signer that runs inside the Worker.
 *
 * Wire format matches Sui's expectation for `executeTransactionBlock`:
 *
 *   sui_signature = [scheme: u8 = 0x00] || [signature: 64B] || [pubkey: 32B]
 *
 * Address derivation matches Sui's Ed25519 scheme:
 *
 *   addr = blake2b_256( [0x00] || pubkey ) [..32]
 *
 * The seed lives in `env.AGENT_PRIVATE_KEY_HEX` as a 32-byte hex string. In
 * production this is sealed inside the TEE (Phala Cloud sealed storage,
 * AWS Nitro Vsock-attested KMS, Intel TDX sealed blob). In demo deployment
 * it lives as a Worker Secret — same access model from the Worker's
 * perspective, weaker against host compromise.
 */

import * as ed from "@noble/ed25519";
import { blake2b } from "@noble/hashes/blake2b";
import { sha512 } from "@noble/hashes/sha2";

// noble/ed25519 v2 requires us to supply sha512 since Web Crypto doesn't
// expose synchronous SHA-512.
ed.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed.etc.concatBytes(...m));

export interface AgentIdentity {
    /** 0x-prefixed lowercased Sui address. */
    address: string;
    /** 32-byte raw public key. */
    publicKey: Uint8Array;
}

export class AgentSigner {
    private secretSeed: Uint8Array;
    public readonly identity: AgentIdentity;

    private constructor(seed: Uint8Array, pub: Uint8Array, address: string) {
        this.secretSeed = seed;
        this.identity = { address, publicKey: pub };
    }

    static async fromHexSeed(hex: string): Promise<AgentSigner> {
        const seed = hexToBytes(hex);
        if (seed.length !== 32) {
            throw new Error(
                `AGENT_PRIVATE_KEY_HEX must decode to 32 bytes, got ${seed.length}`,
            );
        }
        const pub = await ed.getPublicKeyAsync(seed);
        const address = deriveAddress(pub);
        return new AgentSigner(seed, pub, address);
    }

    /** Returns the 97-byte Sui-format Ed25519 signature for an unsigned tx blob. */
    async signTxBytes(txBytesBase64: string): Promise<string> {
        // Sui signs the intent-prefixed BLAKE2b-256 digest of tx bytes.
        //   intent = [0x00, 0x00, 0x00]  (Intent::TransactionData)
        //   blob   = intent || tx_bytes
        //   digest = blake2b_256(blob)   ← 32 bytes
        //
        // The ed25519 signature is over `digest` itself, not over the raw blob.
        const txBytes = base64ToBytes(txBytesBase64);
        const intent = new Uint8Array(3);
        const blob = new Uint8Array(intent.length + txBytes.length);
        blob.set(intent, 0);
        blob.set(txBytes, intent.length);
        const digest = blake2b(blob, { dkLen: 32 });

        const sig = await ed.signAsync(digest, this.secretSeed);

        // Wire: [scheme: 0x00] || sig (64) || pubkey (32)
        const wire = new Uint8Array(1 + 64 + 32);
        wire[0] = 0x00;
        wire.set(sig, 1);
        wire.set(this.identity.publicKey, 65);
        return bytesToBase64(wire);
    }
}

function deriveAddress(publicKey: Uint8Array): string {
    // [scheme: 0x00] || pubkey
    const prefixed = new Uint8Array(1 + publicKey.length);
    prefixed[0] = 0x00;
    prefixed.set(publicKey, 1);
    const hash = blake2b(prefixed, { dkLen: 32 });
    return "0x" + bytesToHex(hash);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Byte helpers
// ─────────────────────────────────────────────────────────────────────────────

function hexToBytes(s: string): Uint8Array {
    let h = s.trim();
    if (h.startsWith("0x") || h.startsWith("0X")) h = h.slice(2);
    if (h.length % 2 !== 0) {
        throw new Error("hex must be even-length");
    }
    const out = new Uint8Array(h.length / 2);
    for (let i = 0; i < out.length; i++) {
        out[i] = parseInt(h.slice(2 * i, 2 * i + 2), 16);
    }
    return out;
}

function bytesToHex(b: Uint8Array): string {
    let out = "";
    for (let i = 0; i < b.length; i++) {
        out += b[i].toString(16).padStart(2, "0");
    }
    return out;
}

function bytesToBase64(b: Uint8Array): string {
    let s = "";
    for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s);
}

function base64ToBytes(s: string): Uint8Array {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}
