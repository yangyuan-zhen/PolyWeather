#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys

from eth_abi import encode
from web3 import Web3


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Encode PolyWeatherCheckoutV2 constructor args for PolygonScan verification.",
    )
    parser.add_argument("--owner", required=True, help="Owner or multisig address")
    parser.add_argument("--treasury", required=True, help="Treasury address")
    parser.add_argument(
        "--signer",
        required=True,
        help="EIP-712 signer address (backend signer or multisig-controlled signer)",
    )
    args = parser.parse_args()

    for name, value in {
        "owner": args.owner,
        "treasury": args.treasury,
        "signer": args.signer,
    }.items():
        if not Web3.is_address(value):
            print(f"invalid --{name} address", file=sys.stderr)
            return 1

    encoded = encode(
        ["address", "address", "address"],
        [
            Web3.to_checksum_address(args.owner),
            Web3.to_checksum_address(args.treasury),
            Web3.to_checksum_address(args.signer),
        ],
    ).hex()
    print(encoded)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
