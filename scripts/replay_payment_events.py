import argparse
import json
import os
import sys
from typing import Any, Dict, List

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from src.payments import PAYMENT_CHECKOUT  # noqa: E402
from src.payments.event_loop import _decode_order_paid_log  # noqa: E402


def _collect_logs(from_block: int, to_block: int) -> List[Dict[str, Any]]:
    w3 = PAYMENT_CHECKOUT._get_web3(force_refresh=True)  # noqa: SLF001
    receiver_contracts = sorted(
        {
            token.receiver_contract
            for token in PAYMENT_CHECKOUT.supported_tokens.values()
            if token.receiver_contract
        }
    )
    if not receiver_contracts:
        return []
    topic0 = str(PAYMENT_CHECKOUT._event_topic or "").strip()  # noqa: SLF001
    params: Dict[str, Any] = {
        "fromBlock": int(from_block),
        "toBlock": int(to_block),
        "topics": [topic0],
        "address": receiver_contracts if len(receiver_contracts) > 1 else receiver_contracts[0],
    }
    logs = w3.eth.get_logs(params)
    out: List[Dict[str, Any]] = []
    for log_item in logs:
        decoded = _decode_order_paid_log(log_item)
        if decoded:
            out.append(decoded)
    return out


def main():
    parser = argparse.ArgumentParser(description="Replay payment OrderPaid events across a block range.")
    parser.add_argument("--from-block", type=int, required=True)
    parser.add_argument("--to-block", type=int, required=True)
    parser.add_argument(
        "--output",
        default=os.path.join(PROJECT_ROOT, "artifacts", "payments", "replay_payment_events.json"),
    )
    args = parser.parse_args()

    rows = _collect_logs(args.from_block, args.to_block)
    payload = {
        "from_block": int(args.from_block),
        "to_block": int(args.to_block),
        "count": len(rows),
        "events": rows,
    }
    output_dir = os.path.dirname(os.path.abspath(args.output))
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
    print(json.dumps({"count": len(rows), "output": args.output}, ensure_ascii=False))


if __name__ == "__main__":
    main()
