const { getEvents } = require('@aragon/test-helpers/events')
const { assertRevert } = require('@aragon/test-helpers/assertThrow')
const { deployErc20TokenAndDeposit, deployDao, installVoting, installTollgate } = require('./helpers/deploy')(artifacts, web3)
const { bigExp } = require('./helpers/numbers')(web3)

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

contract('Tollgate', ([owner, recipient, anyone]) => {
  let dao, token, tollgate
  const feeAmount = 1e18

  before('deploy dao', async () => {
    ({ dao } = await deployDao(owner))
  })

  beforeEach('deploy tokens', async () => {
    ({ token } = await deployErc20TokenAndDeposit(owner))
  })

  beforeEach('create tollgate', async () => {
    ({ tollgate } = await installTollgate(dao, token, 1, recipient))
  })

  describe('initialization', () => {
  })

  describe('change fee amount', () => {
  })

  describe('change fee destination', () => {
  })

  describe('forward', () => {
  })
})
