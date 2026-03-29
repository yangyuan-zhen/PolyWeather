// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.24;

interface IERC20 {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

contract PolyWeatherCheckout {
    address public owner;
    address public treasury;
    mapping(address => bool) public allowedToken;
    mapping(bytes32 => bool) public paidOrder;

    event OrderPaid(
        bytes32 indexed orderId,
        address indexed payer,
        uint256 indexed planId,
        address token,
        uint256 amount
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "ONLY_OWNER");
        _;
    }

    constructor(address _token, address _treasury) {
        require(_token != address(0) && _treasury != address(0), "ZERO_ADDR");
        owner = msg.sender;
        treasury = _treasury;
        allowedToken[_token] = true;
    }

    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "ZERO_ADDR");
        treasury = _treasury;
    }

    function setTokenAllowed(address token, bool allowed) external onlyOwner {
        require(token != address(0), "ZERO_ADDR");
        allowedToken[token] = allowed;
    }

    function pay(bytes32 orderId, uint256 planId, uint256 amount, address token) external {
        require(allowedToken[token], "TOKEN_NOT_ALLOWED");
        require(amount > 0, "AMOUNT_ZERO");
        require(!paidOrder[orderId], "ORDER_PAID");

        paidOrder[orderId] = true;
        require(IERC20(token).transferFrom(msg.sender, treasury, amount), "TRANSFER_FAILED");

        emit OrderPaid(orderId, msg.sender, planId, token, amount);
    }
}
