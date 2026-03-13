#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys

from eth_abi import encode
from web3 import Web3


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Encode PolyWeatherCheckout constructor args for PolygonScan verification.",
    )
    parser.add_argument("--usdc", required=True, help="USDC token address")
    parser.add_argument("--treasury", required=True, help="Treasury address")
    args = parser.parse_args()

    if not Web3.is_address(args.usdc):
        print("invalid --usdc address", file=sys.stderr)
        return 1
    if not Web3.is_address(args.treasury):
        print("invalid --treasury address", file=sys.stderr)
        return 1

    encoded = encode(
        ["address", "address"],
        [Web3.to_checksum_address(args.usdc), Web3.to_checksum_address(args.treasury)],
    ).hex()
    print(encoded)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
