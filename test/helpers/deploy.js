module.exports = (artifacts, web3) => {
  const { bigExp } = require('./numbers')(web3)
  const { getEventArgument, getNewProxyAddress } = require('@aragon/test-helpers/events')

  const getContract = name => artifacts.require(name)

  const ACL = getContract('ACL')
  const Kernel = getContract('Kernel')
  const DAOFactory = getContract('DAOFactory')
  const EVMScriptRegistryFactory = getContract('EVMScriptRegistryFactory')
  const Voting = getContract('Voting')

  const Tollgate = getContract('Tollgate')

  async function deployErc20TokenAndDeposit(holder, name = 'ERC20Token', decimals = 18) {
    const token = await getContract('MiniMeToken').new('0x0', '0x0', 0, name, decimals, 'E20', true) // dummy parameters for minime
    const amount = bigExp(1e18, decimals)
    await token.generateTokens(holder, amount)
    return token
  }

  async function deployDao(owner) {
    const kernelBase = await Kernel.new(true) // petrify immediately
    const aclBase = await ACL.new()
    const regFact = await EVMScriptRegistryFactory.new()
    const daoFact = await DAOFactory.new(kernelBase.address, aclBase.address, regFact.address)

    const ANY_ENTITY = await aclBase.ANY_ENTITY()
    const APP_MANAGER_ROLE = await kernelBase.APP_MANAGER_ROLE()

    const kernelReceipt = await daoFact.newDAO(owner)
    const dao = Kernel.at(getEventArgument(kernelReceipt, 'DeployDAO', 'dao'))
    const acl = ACL.at(await dao.acl())

    await acl.createPermission(owner, dao.address, APP_MANAGER_ROLE, owner, { from: owner })

    return { dao }
  }

  async function installVoting(dao, token) {
    const votingBase = await Voting.new()
    const votingReceipt = await dao.newAppInstance('0x1234', votingBase.address, '0x', false, { from: owner })
    const voting = Voting.at(getNewProxyAddress(votingReceipt))
    await voting.initialize(token.address, bigExp(1e16), bigExp(1e16), 1000) // 1% support and quorum

    return voting
  }

  async function installTollgate(dao, ...initializationArgs) {
    const tollgateBase = await Tollgate.new()
    const receipt = await dao.newAppInstance('0x4321', tollgate.address, '0x', false, { from: owner })
    const tolllgate = Tollgate.at(getNewProxyAddress(receipt))
    await tollgate.initialize(...initializationArgs)

    return { tollgate }
  }

  return {
    deployErc20TokenAndDeposit,
    deployDao,
    installVoting,
    installTollgate,
  }
}
