pragma solidity 0.4.24;

import "@aragon/os/contracts/apps/AragonApp.sol";
import "@aragon/os/contracts/common/IForwarder.sol";
import "@aragon/os/contracts/common/IForwarderFee.sol";
import "@aragon/os/contracts/common/SafeERC20.sol";
import "@aragon/os/contracts/lib/token/ERC20.sol";


contract Tollgate is AragonApp, IForwarder, IForwarderFee {
    using SafeERC20 for ERC20;

    bytes32 public constant CHANGE_AMOUNT_ROLE = keccak256("CHANGE_AMOUNT_ROLE");
    bytes32 public constant CHANGE_DESTINATION_ROLE = keccak256("CHANGE_DESTINATION_ROLE");

    string private constant ERROR_FEE_TRANSFER_REVERTED = "TOLLGATE_FEE_TRANSFER_REVERT";

    ERC20 public feeToken;
    uint256 public feeAmount;
    address public feeDestination;

    event ChangeFeeAmount(uint256 amount);
    event ChangeFeeDestination(address indexed destination);

    /**
    * @notice Initialize Tollgate with fee of `@tokenAmount(_feeToken, _feeAmount)`
    * @param _feeToken ERC20 address for the fee token
    * @param _feeAmount Amount of tokens collected as a fee on each forward
    * @param _feeDestination Destination for collected fees
    */
    function initialize(ERC20 _feeToken, uint256 _feeAmount, address _feeDestination) external onlyInit {
        initialized();
        feeToken = _feeToken;
        feeAmount = _feeAmount;
        feeDestination = _feeDestination;
    }

    /**
    * @notice Change fee to `@tokenAmount(self.feeToken(): address, _feeAmount)`
    * @param _feeAmount Fee amount
    */
    function changeFeeAmount(uint256 _feeAmount) external authP(CHANGE_AMOUNT_ROLE, arr(_feeAmount, feeAmount)) {
        feeAmount = _feeAmount;
        emit ChangeFeeAmount(_feeAmount);
    }

    /**
    * @notice Change fee destination to `_feeDestination`
    * @param _feeDestination Destination for collected fees
    */
    function changeFeeDestination(address _feeDestination) external authP(CHANGE_DESTINATION_ROLE, arr(_feeDestination, feeDestination)) {
        feeDestination = _feeDestination;
        emit ChangeFeeDestination(_feeDestination);
    }

    // Forwarding fns

    function isForwarder() external pure returns (bool) {
        return true;
    }

    function forwardFee() external view returns (address, uint256) {
        return (address(feeToken), feeAmount);
    }

    /**
    * @notice Execute desired action after paying `@tokenAmount(self.feeToken(): address, self.feeAmount(): uint256)`
    * @dev IForwarder interface conformance. Forwards any action if the sender pays the configured amount.
    * @param _evmScript Script being executed
    */
    function forward(bytes _evmScript) public {
        // Don't do an unnecessary transfer if there's no fee right now
        if (feeAmount > 0) {
            require(
                feeToken.safeTransferFrom(msg.sender, feeDestination, feeAmount),
                ERROR_FEE_TRANSFER_REVERTED
            );
        }

        // Fee transfer successful; run script
        bytes memory input = new bytes(0);
        address[] memory blacklist = new address[](0);
        runScript(_evmScript, input, blacklist);
    }

    function canForward(address, bytes) public view returns (bool) {
        // Just always assume the sender can forward; they will be forced to pay the fee upon the
        // actual forwarding transaction
        return true;
    }
}
