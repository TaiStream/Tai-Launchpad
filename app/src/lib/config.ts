/**
 * Network + on-chain Tai deployment pointers.
 *
 * v1.0.2 is the canonical current testnet deployment. v1.0.1 is the legacy
 * deployment that still hosts Larry (the reference agent). The app reads from
 * both packages because Larry's LaunchpadAccount<LARRY> lives at v1.0.1.
 *
 * Source: `move/published.json` at the repo root.
 */

export const SUI_RPC = "https://fullnode.testnet.sui.io";

export const TAI = {
  v1_1_0: {
    label: "v1.1.0",
    packageId:
      "0x7d86697afc21895a94687ee5c16012384862d43dfd8a6841e2e4a0ac0690efb3",
    configId:
      "0x4a8bdc697738df24f01f6161af29e70136b326db072e3d7e3630b3711f673c50",
    publisherId:
      "0x2ce74c8e1ca4658a80286d17bd3182e84dd717ba3032a8b5727b7dcfbc72352f",
    upgradeCapId:
      "0x15db65b905cccde75e5f38311b5506d013cb878ec1fea8a143f1747e9b8e5467",
  },
  v1_0_2: {
    label: "v1.0.2",
    packageId:
      "0xa93885e3ec2191336a99dfa9a8f4db2bad4fb03a7431780d9153f9191d555026",
    configId:
      "0x4a217cd1c02a0f4341802a85129f473ed7cc3990b5d9c2084bee410ea46515d8",
    publisherId:
      "0xed19b78e2d9ea0f322a59e1762c6ba666ba6e000b970831dc0a3d4af265316ce",
    upgradeCapId:
      "0xc334041c275bdc356f94f84e55f2c19e59877de0fd349dd4635634a0646abf6c",
  },
  v1_0_1: {
    label: "v1.0.1",
    packageId:
      "0xb41fa8ee7b2d902e706f197ec7e90484e4ded4347c6666d08eff09820e266909",
    configId:
      "0xe2ec37d9edf190d94835a6163cdd079ca296196475dd4969a890396b94daa1f0",
    publisherId:
      "0x9d9532b7be93404c773fe4a99e3db51b97e95b82549d47b9c42af326516fd203",
    upgradeCapId:
      "0x6046b65192508a01375810014857e85e02251633929c7fd99a5561b5960b364b",
  },
} as const;

export type TaiPackageInfo = (typeof TAI)[keyof typeof TAI];

/** All known Tai packages — order matters: newest first. */
export const ALL_PACKAGES: TaiPackageInfo[] = [TAI.v1_1_0, TAI.v1_0_2, TAI.v1_0_1];

/** Suiscan link helper. */
export function suiscan(kind: "object" | "tx" | "address", id: string): string {
  return `https://suiscan.xyz/testnet/${kind}/${id}`;
}
