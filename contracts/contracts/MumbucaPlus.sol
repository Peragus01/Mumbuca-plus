// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Capped} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title MumbucaPlus (Mum+)
 * @notice DEMONSTRATION token for testnet (Polygon Amoy) only. It has no monetary
 *         value and must not be used in production.
 * @dev Minted automatically by a backend holding MINTER_ROLE after a confirmed Pix
 *      payment. Each payment reference (bytes32) can be used only once on-chain.
 *      Pause blocks only minting; transfers keep working.
 */
contract MumbucaPlus is ERC20, ERC20Capped, AccessControl, Pausable {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    uint256 public maxMintPerTx;
    mapping(bytes32 => bool) public paymentRefUsed;

    event MintedForPayment(address indexed to, uint256 amount, bytes32 indexed paymentRef);
    event MaxMintPerTxUpdated(uint256 newLimit);

    error PaymentRefAlreadyUsed(bytes32 paymentRef);
    error MintAmountExceedsLimit(uint256 amount, uint256 limit);
    error InvalidMintAmount();

    constructor(address admin, uint256 cap_, uint256 maxMintPerTx_)
        ERC20("Mumbuca+", "Mum+")
        ERC20Capped(cap_)
    {
        maxMintPerTx = maxMintPerTx_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
    }

    function mint(address to, uint256 amount, bytes32 paymentRef)
        external
        onlyRole(MINTER_ROLE)
        whenNotPaused
    {
        if (amount == 0) revert InvalidMintAmount();
        if (amount > maxMintPerTx) revert MintAmountExceedsLimit(amount, maxMintPerTx);
        if (paymentRefUsed[paymentRef]) revert PaymentRefAlreadyUsed(paymentRef);
        paymentRefUsed[paymentRef] = true;
        _mint(to, amount);
        emit MintedForPayment(to, amount, paymentRef);
    }

    function setMaxMintPerTx(uint256 newLimit) external onlyRole(DEFAULT_ADMIN_ROLE) {
        maxMintPerTx = newLimit;
        emit MaxMintPerTxUpdated(newLimit);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function _update(address from, address to, uint256 value) internal override(ERC20, ERC20Capped) {
        super._update(from, to, value);
    }
}
