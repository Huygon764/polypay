// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

interface IVerifyProofAggregation {
    function verifyProofAggregation(
        uint256 _domainId,
        uint256 _aggregationId,
        bytes32 _leaf,
        bytes32[] calldata _merklePath,
        uint256 _leafCount,
        uint256 _index
    ) external view returns (bool);
}

contract PrivateTransferContract {
    bytes32 public constant PROVING_SYSTEM_ID =
        keccak256(abi.encodePacked("ultraplonk"));
    bytes32 public constant VERSION_HASH = sha256(abi.encodePacked(""));

    address public immutable zkvContract;
    bytes32 public immutable vkHash;

    // Private state tracking
    mapping(uint256 => bool) public nullifiers; // Prevent double spend
    mapping(uint256 => uint256) public commitmentAmounts; // commitment → amount

    constructor(address _zkvContract, bytes32 _vkHash) {
        zkvContract = _zkvContract;
        vkHash = _vkHash;
    }

    // Public deposit to get private commitment
    function deposit(uint256 commitment) external payable {
        require(msg.value > 0, "Amount must be positive");
        require(commitmentAmounts[commitment] == 0, "Commitment exists");

        commitmentAmounts[commitment] = msg.value;
    }

    // Private transfer using ZK proof
    function privateTransfer(
        uint256 aggregationId,
        uint256 domainId,
        bytes32[] calldata merklePath,
        uint256 leafCount,
        uint256 index,
        address recipient,
        // Public inputs from ZK proof
        uint256 amount,
        uint256 commitment,
        uint256 nullifier
    ) external {
        // 1. Check commitment has enough balance
        require(
            commitmentAmounts[commitment] >= amount,
            "Insufficient commitment balance"
        );

        // 2. Check nullifier not used
        require(!nullifiers[nullifier], "Nullifier already used");

        // 3. Verify ZK proof
        require(
            _verifyProofHasBeenPostedToZkv(
                aggregationId,
                domainId,
                merklePath,
                leafCount,
                index,
                // public inputs
                commitment,
                nullifier
            ),
            "Invalid ZK proof"
        );

        // 4. Update state
        commitmentAmounts[commitment] -= amount;
        nullifiers[nullifier] = true;

        (bool sent, ) = recipient.call{value: amount}("");
        require(sent, "Failed to send Ether");
    }

    function _verifyProofHasBeenPostedToZkv(
        uint256 aggregationId,
        uint256 domainId,
        bytes32[] calldata merklePath,
        uint256 leafCount,
        uint256 index,
        uint256 commitment,
        uint256 nullifier
    ) internal view returns (bool) {
        bytes memory encodedInputs = abi.encodePacked(commitment, nullifier);

        // Calculate leaf hash
        bytes32 leaf = keccak256(
            abi.encodePacked(
                PROVING_SYSTEM_ID,
                vkHash,
                VERSION_HASH,
                keccak256(encodedInputs)
            )
        );

        // Verify with zkVerify
        return
            IVerifyProofAggregation(zkvContract).verifyProofAggregation(
                domainId,
                aggregationId,
                leaf,
                merklePath,
                leafCount,
                index
            );
    }
}
