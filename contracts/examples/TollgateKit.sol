/*
 * SPDX-License-Identitifer:    GPL-3.0-or-later
 *
 * This file requires contract dependencies which are licensed as
 * GPL-3.0-or-later, forcing it to also be licensed as such.
 *
 * This is the only file in your project that requires this license and
 * you are free to choose a different license for the rest of the project.
 */

pragma solidity 0.4.24;

import "../Tollgate.sol";
import "@aragon/os/contracts/apm/Repo.sol";
import "@aragon/os/contracts/apm/APMNamehash.sol";
import "@aragon/os/contracts/factory/DAOFactory.sol";
import "@aragon/os/contracts/lib/ens/ENS.sol";
import "@aragon/os/contracts/lib/token/ERC20.sol";
import "@aragon/os/contracts/lib/ens/PublicResolver.sol";
import "@aragon/apps-vault/contracts/Vault.sol";
import "@aragon/apps-finance/contracts/Finance.sol";
import "@aragon/apps-voting/contracts/Voting.sol";
import "@aragon/apps-token-manager/contracts/TokenManager.sol";
import "@aragon/apps-shared-minime/contracts/MiniMeToken.sol";


interface Kits {
    function fac() public returns (DAOFactory);
}

contract TollgateKit is APMNamehash {
    uint64 internal constant PCT = 10 ** 16;
    address internal constant ANY_ENTITY = address(-1);

    bytes32 internal VAULT_APP_ID = apmNamehash("vault");
    bytes32 internal VOTING_APP_ID = apmNamehash("voting");
    bytes32 internal FINANCE_APP_ID = apmNamehash("finance");
    bytes32 internal TOLLGATE_APP_ID = apmNamehash("tollgate");
    bytes32 internal TOKEN_MANAGER_APP_ID = apmNamehash("token-manager");

    ENS public ens;
    DAOFactory public daoFactory;
    MiniMeTokenFactory public miniMeTokenFactory;

    event DeployInstance(address dao);
    event InstalledApp(address appProxy, bytes32 appId);

    constructor(ENS _ens) public {
        ens = _ens;
        bytes32 bareKit = apmNamehash("bare-kit");
        daoFactory = Kits(latestVersionAppBase(bareKit)).fac();
        miniMeTokenFactory = new MiniMeTokenFactory();
    }

    function newInstance() public {
        address root = msg.sender;
        Kernel dao = daoFactory.newDAO(this);
        ACL acl = ACL(dao.acl());
        acl.createPermission(this, dao, dao.APP_MANAGER_ROLE(), this);

        Vault vault = Vault(installApp(dao, VAULT_APP_ID));
        Voting voting = Voting(installDefaultApp(dao, VOTING_APP_ID));
        Finance finance = Finance(installApp(dao, FINANCE_APP_ID));
        Tollgate tollgate = Tollgate(installApp(dao, TOLLGATE_APP_ID));
        TokenManager tokenManager = TokenManager(installApp(dao, TOKEN_MANAGER_APP_ID));

        MiniMeToken token = miniMeTokenFactory.createCloneToken(MiniMeToken(0), 0, "Tollgate DAO Token", 18, "TDT", true);
        token.changeController(tokenManager);

        vault.initialize();
        finance.initialize(vault, 30 days);
        acl.createPermission(finance, vault, vault.TRANSFER_ROLE(), root);

        MiniMeToken feeToken = miniMeTokenFactory.createCloneToken(MiniMeToken(0), 0, "Tollgate Fee Token", 18, "TFT", true);
        feeToken.generateTokens(root, 100e18);
        feeToken.changeController(root);
        tollgate.initialize(ERC20(feeToken), 1e18, root);

        voting.initialize(token, 50 * PCT, 0, 1 days);
        tokenManager.initialize(token, true, 0);

        acl.createPermission(tollgate, voting, voting.CREATE_VOTES_ROLE(), root);

        acl.createPermission(root, tollgate, tollgate.CHANGE_AMOUNT_ROLE(), root);
        acl.createPermission(root, tollgate, tollgate.CHANGE_DESTINATION_ROLE(), root);

        acl.createPermission(this, tokenManager, tokenManager.MINT_ROLE(), this);
        tokenManager.mint(root, 1e18);
        acl.grantPermission(voting, tokenManager, tokenManager.MINT_ROLE());
        acl.revokePermission(this, tokenManager, tokenManager.MINT_ROLE());
        acl.setPermissionManager(root, tokenManager, tokenManager.MINT_ROLE());

        acl.grantPermission(root, dao, dao.APP_MANAGER_ROLE());
        acl.revokePermission(this, dao, dao.APP_MANAGER_ROLE());
        acl.setPermissionManager(root, dao, dao.APP_MANAGER_ROLE());

        acl.grantPermission(root, acl, acl.CREATE_PERMISSIONS_ROLE());
        acl.revokePermission(this, acl, acl.CREATE_PERMISSIONS_ROLE());
        acl.setPermissionManager(root, acl, acl.CREATE_PERMISSIONS_ROLE());

        emit DeployInstance(dao);
    }

    function installApp(Kernel dao, bytes32 appId) internal returns (address) {
        address instance = address(dao.newAppInstance(appId, latestVersionAppBase(appId)));
        emit InstalledApp(instance, appId);
        return instance;
    }

    function installDefaultApp(Kernel dao, bytes32 appId) internal returns (address) {
        address instance = address(dao.newAppInstance(appId, latestVersionAppBase(appId), new bytes(0), true));
        emit InstalledApp(instance, appId);
        return instance;
    }

    function latestVersionAppBase(bytes32 appId) internal view returns (address) {
        Repo repo = Repo(PublicResolver(ens.resolver(appId)).addr(appId));
        (,address base,) = repo.getLatest();
        return base;
    }
}
