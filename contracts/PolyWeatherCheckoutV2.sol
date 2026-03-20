// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function transfer(address to, uint256 value) external returns (bool);
}

library Address {
    function functionCall(address target, bytes memory data, string memory errorMessage) internal returns (bytes memory) {
        (bool success, bytes memory returndata) = target.call(data);
        require(success, errorMessage);
        return returndata;
    }
}

library SafeERC20 {
    using Address for address;

    function safeTransferFrom(IERC20 token, address from, address to, uint256 value) internal {
        bytes memory returndata = address(token).functionCall(
            abi.encodeWithSelector(token.transferFrom.selector, from, to, value),
            "SAFE_TRANSFER_FROM_FAILED"
        );
        if (returndata.length > 0) {
            require(abi.decode(returndata, (bool)), "SAFE_TRANSFER_FROM_FALSE");
        }
    }

    function safeTransfer(IERC20 token, address to, uint256 value) internal {
        bytes memory returndata = address(token).functionCall(
            abi.encodeWithSelector(token.transfer.selector, to, value),
            "SAFE_TRANSFER_FAILED"
        );
        if (returndata.length > 0) {
            require(abi.decode(returndata, (bool)), "SAFE_TRANSFER_FALSE");
        }
    }
}

abstract contract Ownable {
    address public owner;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "ONLY_OWNER");
        _;
    }

    constructor(address initialOwner) {
        require(initialOwner != address(0), "ZERO_OWNER");
        owner = initialOwner;
        emit OwnershipTransferred(address(0), initialOwner);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "ZERO_OWNER");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}

abstract contract Pausable {
    bool public paused;

    event Paused(address indexed account);
    event Unpaused(address indexed account);

    modifier whenNotPaused() {
        require(!paused, "PAUSED");
        _;
    }

    function _pause() internal {
        require(!paused, "PAUSED");
        paused = true;
        emit Paused(msg.sender);
    }

    function _unpause() internal {
        require(paused, "NOT_PAUSED");
        paused = false;
        emit Unpaused(msg.sender);
    }
}

abstract contract ReentrancyGuard {
    uint256 private _status = 1;

    modifier nonReentrant() {
        require(_status == 1, "REENTRANT");
        _status = 2;
        _;
        _status = 1;
    }
}

contract PolyWeatherCheckoutV2 is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct PlanConfig {
        uint256 amount;
        bool active;
    }

    bytes32 public constant AUTHORIZED_PAYMENT_TYPEHASH =
        keccak256(
            "AuthorizedPayment(bytes32 orderId,address payer,uint256 planId,address token,uint256 amount,uint256 nonce,uint256 deadline)"
        );

    bytes32 public immutable DOMAIN_SEPARATOR;

    address public treasury;
    address public signer;
    mapping(address => bool) public allowedToken;
    mapping(bytes32 => bool) public paidOrder;
    mapping(uint256 => mapping(address => PlanConfig)) public planConfig;
    mapping(address => uint256) public payerNonce;

    event OrderPaid(
        bytes32 indexed orderId,
        address indexed payer,
        uint256 indexed planId,
        address token,
        uint256 amount
    );
    event TreasuryUpdated(address indexed treasury);
    event SignerUpdated(address indexed signer);
    event TokenAllowedUpdated(address indexed token, bool allowed);
    event PlanConfigured(uint256 indexed planId, address indexed token, uint256 amount, bool active);

    constructor(address initialOwner, address initialTreasury, address initialSigner)
        Ownable(initialOwner)
    {
        require(initialTreasury != address(0), "ZERO_TREASURY");
        treasury = initialTreasury;
        signer = initialSigner;

        uint256 chainId;
        assembly {
            chainId := chainid()
        }
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256(bytes("PolyWeatherCheckoutV2")),
                keccak256(bytes("1")),
                chainId,
                address(this)
            )
        );
    }

    function setTreasury(address newTreasury) external onlyOwner {
        require(newTreasury != address(0), "ZERO_ADDR");
        treasury = newTreasury;
        emit TreasuryUpdated(newTreasury);
    }

    function setSigner(address newSigner) external onlyOwner {
        signer = newSigner;
        emit SignerUpdated(newSigner);
    }

    function setTokenAllowed(address token, bool allowed) external onlyOwner {
        require(token != address(0), "ZERO_ADDR");
        allowedToken[token] = allowed;
        emit TokenAllowedUpdated(token, allowed);
    }

    function setPlan(uint256 planId, address token, uint256 amount, bool active) external onlyOwner {
        require(planId > 0, "PLAN_ZERO");
        require(token != address(0), "ZERO_ADDR");
        require(amount > 0 || !active, "AMOUNT_ZERO");
        planConfig[planId][token] = PlanConfig({amount: amount, active: active});
        emit PlanConfigured(planId, token, amount, active);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function payPlan(bytes32 orderId, uint256 planId, address token)
        external
        whenNotPaused
        nonReentrant
    {
        require(allowedToken[token], "TOKEN_NOT_ALLOWED");
        PlanConfig memory config = planConfig[planId][token];
        require(config.active, "PLAN_NOT_ACTIVE");
        require(config.amount > 0, "PLAN_AMOUNT_ZERO");
        _collect(orderId, msg.sender, planId, token, config.amount);
    }

    function payAuthorized(
        bytes32 orderId,
        uint256 planId,
        address token,
        uint256 amount,
        uint256 deadline,
        bytes calldata signature
    ) external whenNotPaused nonReentrant {
        require(allowedToken[token], "TOKEN_NOT_ALLOWED");
        require(amount > 0, "AMOUNT_ZERO");
        require(deadline >= block.timestamp, "AUTH_EXPIRED");
        require(signer != address(0), "SIGNER_NOT_SET");

        uint256 nonce = payerNonce[msg.sender];
        bytes32 structHash = keccak256(
            abi.encode(
                AUTHORIZED_PAYMENT_TYPEHASH,
                orderId,
                msg.sender,
                planId,
                token,
                amount,
                nonce,
                deadline
            )
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash)
        );
        require(_recover(digest, signature) == signer, "BAD_SIGNATURE");
        payerNonce[msg.sender] = nonce + 1;

        _collect(orderId, msg.sender, planId, token, amount);
    }

    function rescueToken(address token, address to, uint256 amount) external onlyOwner nonReentrant {
        require(token != address(0) && to != address(0), "ZERO_ADDR");
        IERC20(token).safeTransfer(to, amount);
    }

    function _collect(bytes32 orderId, address payer, uint256 planId, address token, uint256 amount) internal {
        require(!paidOrder[orderId], "ORDER_PAID");
        paidOrder[orderId] = true;
        IERC20(token).safeTransferFrom(payer, treasury, amount);
        emit OrderPaid(orderId, payer, planId, token, amount);
    }

    function _recover(bytes32 digest, bytes calldata signature) internal pure returns (address) {
        require(signature.length == 65, "BAD_SIG_LEN");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (v < 27) {
            v += 27;
        }
        require(v == 27 || v == 28, "BAD_SIG_V");
        address recovered = ecrecover(digest, v, r, s);
        require(recovered != address(0), "BAD_SIG");
        return recovered;
    }
}
