const { bigExp } = require('./helpers/numbers')(web3)
const { assertEvent } = require('@aragon/test-helpers/assertEvent')(web3)
const { assertRevert } = require('@aragon/test-helpers/assertThrow')
const { encodeCallScript } = require('@aragon/test-helpers/evmScript')
const { getEventArgument, getNewProxyAddress } = require('@aragon/test-helpers/events')

const Tollgate = artifacts.require('Tollgate')

const ACL = artifacts.require('ACL')
const Kernel = artifacts.require('Kernel')
const DAOFactory = artifacts.require('DAOFactory')
const MiniMeToken = artifacts.require('MiniMeToken')
const ExecutionTarget = artifacts.require('ExecutionTarget')
const EVMScriptRegistryFactory = artifacts.require('EVMScriptRegistryFactory')

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

contract('Tollgate', ([_, root, user, destination, anotherDestination, someone]) => {
  let dao, acl, tollgate, feeToken
  let daoFactory, tollgateBase, kernelBase
  let CHANGE_AMOUNT_ROLE, CHANGE_DESTINATION_ROLE, APP_MANAGER_ROLE

  const FEE_AMOUNT = bigExp(1, 18)

  before('deploy base implementations', async () => {
    kernelBase = await Kernel.new(true) // petrify immediately
    const aclBase = await ACL.new()
    const registryFactory = await EVMScriptRegistryFactory.new()
    daoFactory = await DAOFactory.new(kernelBase.address, aclBase.address, registryFactory.address)
    tollgateBase = await Tollgate.new()
  })

  before('deploy fee token', async () => {
    feeToken = await MiniMeToken.new('0x0', '0x0', 0, 'Fee Token', 18, 'FTK', true, { from: root }) // dummy parameters for minime
    await feeToken.generateTokens(user, bigExp(100, 18), { from: root })
  })

  before('load constants', async () => {
    APP_MANAGER_ROLE = await kernelBase.APP_MANAGER_ROLE()
    CHANGE_AMOUNT_ROLE = await tollgateBase.CHANGE_AMOUNT_ROLE()
    CHANGE_DESTINATION_ROLE = await tollgateBase.CHANGE_DESTINATION_ROLE()
  })

  beforeEach('create DAO', async () => {
    const receipt = await daoFactory.newDAO(root)
    dao = Kernel.at(getEventArgument(receipt, 'DeployDAO', 'dao'))
    acl = ACL.at(await dao.acl())
    await acl.createPermission(root, dao.address, APP_MANAGER_ROLE, root, { from: root })
  })

  beforeEach('create tollgate app', async () => {
    const receipt = await dao.newAppInstance('0x1234', tollgateBase.address, '0x', false, { from: root })
    tollgate = Tollgate.at(getNewProxyAddress(receipt))

    await acl.createPermission(root, tollgate.address, CHANGE_AMOUNT_ROLE, root, { from: root })
    await acl.createPermission(root, tollgate.address, CHANGE_DESTINATION_ROLE, root, { from: root })
  })

  describe('initialize', () => {
    it('cannot initialize the base app', async () => {
      assert.isTrue(await tollgateBase.isPetrified(), 'base tollgate app should be petrified')
      await assertRevert(tollgateBase.initialize(feeToken.address, FEE_AMOUNT, destination), 'INIT_ALREADY_INITIALIZED')
    })

    it('cannot initialize with a zero fee token', async () => {
      await assertRevert(tollgate.initialize(ZERO_ADDRESS, FEE_AMOUNT, destination), 'TOLLGATE_INVALID_FEE_TOKEN')
    })

    it('cannot initialize with a zero fee destination', async () => {
      await assertRevert(tollgate.initialize(feeToken.address, FEE_AMOUNT, ZERO_ADDRESS), 'TOLLGATE_INVALID_FEE_DESTINATION')
    })

    it('sets the fee token, amount and destination address', async () => {
      await tollgate.initialize(feeToken.address, FEE_AMOUNT, destination)

      assert.equal(await tollgate.feeToken(), feeToken.address, 'tollgate fee token does not match')
      assert.equal((await tollgate.feeAmount()).toString(), FEE_AMOUNT.toString(), 'tollgate fee amount does not match')
      assert.equal(await tollgate.feeDestination(), destination, 'tollgate fee destination does not match')
    })

    it('can be initialized only once', async () => {
      await tollgate.initialize(feeToken.address, FEE_AMOUNT, destination)

      assert.isTrue(await tollgate.hasInitialized(), 'tollgate should be initialized')
      await assertRevert(tollgate.initialize(feeToken.address, FEE_AMOUNT, destination), 'INIT_ALREADY_INITIALIZED')
    })
  })

  describe('changeFeeAmount', () => {
    context('when the app has already been initialized', () => {
      beforeEach('initialize tollgate app', async () => {
        await tollgate.initialize(feeToken.address, FEE_AMOUNT, destination)
      })

      context('when the sender is allowed', () => {
        const from = root

        const itUpdatesTheFeeAmountSuccessfully = (newFeeAmount) => {
          it('updates the fee amount', async () =>  {
            await tollgate.changeFeeAmount(newFeeAmount, { from })

            assert.equal((await tollgate.feeAmount()).toString(), newFeeAmount.toString(), 'fee amount does not match')
          })

          it('emits an event', async () => {
            const receipt = await tollgate.changeFeeAmount(newFeeAmount, { from })
            assertEvent(receipt, 'ChangeFeeAmount', { previousAmount: FEE_AMOUNT, newAmount: newFeeAmount })
          })
        }

        context('when the new fee amount is zero', () => {
          const newFeeAmount = bigExp(0, 18)

          itUpdatesTheFeeAmountSuccessfully(newFeeAmount)
        })

        context('when the new fee amount is different than the one before', () => {
          const newFeeAmount = FEE_AMOUNT.mul(2)

          itUpdatesTheFeeAmountSuccessfully(newFeeAmount)
        })

        context('when the new fee amount is equal to the one before', () => {
          const newFeeAmount = FEE_AMOUNT

          it('reverts', async () =>  {
            await assertRevert(tollgate.changeFeeAmount(newFeeAmount, { from }), 'TOLLGATE_INVALID_FEE_AMOUNT')
          })
        })
      })

      context('when the sender is not allowed', () => {
        const from = someone

        it('reverts', async () =>  {
          await assertRevert(tollgate.changeFeeAmount(FEE_AMOUNT.mul(2), { from }), 'APP_AUTH_FAILED')
        })
      })
    })

    context('when it has not been initialized yet', () => {
      it('reverts', async () => {
        await assertRevert(tollgate.changeFeeAmount(FEE_AMOUNT.mul(2), { from: root }), 'APP_AUTH_FAILED')
      })
    })
  })

  describe('changeFeeDestination', () => {
    context('when the app has already been initialized', () => {
      beforeEach('initialize tollgate app', async () => {
        await tollgate.initialize(feeToken.address, FEE_AMOUNT, destination)
      })

      context('when the sender is allowed', () => {
        const from = root

        context('when the new fee amount is different than the one before', () => {
          const newFeeDestination = anotherDestination

          it('updates the fee amount', async () =>  {
            await tollgate.changeFeeDestination(newFeeDestination, { from })

            assert.equal(await tollgate.feeDestination(), newFeeDestination, 'fee destination does not match')
          })

          it('emits an event', async () => {
            const receipt = await tollgate.changeFeeDestination(newFeeDestination, { from })
            assertEvent(receipt, 'ChangeFeeDestination', { previousDestination: destination, newDestination: newFeeDestination })
          })
        })

        context('when the new fee destination is the address zero', () => {
          const newDestination = ZERO_ADDRESS

          it('reverts', async () =>  {
            await assertRevert(tollgate.changeFeeDestination(newDestination, { from }), 'TOLLGATE_INVALID_FEE_DESTINATION')
          })
        })

        context('when the new fee destination is equal to the one before', () => {
          const newDestination = destination

          it('reverts', async () =>  {
            await assertRevert(tollgate.changeFeeDestination(newDestination, { from }), 'TOLLGATE_INVALID_FEE_DESTINATION')
          })
        })
      })

      context('when the sender is not allowed', () => {
        const from = someone

        it('reverts', async () =>  {
          await assertRevert(tollgate.changeFeeDestination(anotherDestination, { from }), 'APP_AUTH_FAILED')
        })
      })
    })

    context('when it has not been initialized yet', () => {
      it('reverts', async () => {
        await assertRevert(tollgate.changeFeeDestination(anotherDestination, { from: root }), 'APP_AUTH_FAILED')
      })
    })
  })

  describe('forwardFee', () => {
    context('when the app has already been initialized', () => {
      beforeEach('initialize tollgate app', async () => {
        await tollgate.initialize(feeToken.address, FEE_AMOUNT, destination)
      })

      it('returns configured fee token and amount', async () => {
        const [token, amount] = await tollgate.forwardFee()

        assert.equal(token, feeToken.address, 'fee token does not match')
        assert.equal(amount.toString(), FEE_AMOUNT.toString(), 'fee amount does not match')
      })
    })

    context('when it has not been initialized yet', () => {
      it('returns empty values', async () => {
        const [token, amount] = await tollgate.forwardFee()

        assert.equal(token, ZERO_ADDRESS, 'fee token does not match')
        assert.equal(amount.toString(), 0, 'fee amount does not match')
      })
    })
  })

  describe('isForwarder', () => {
    const itShouldAlwaysBeForwarder = () => {
      it('returns true', async () => {
        assert.isTrue(await tollgate.isForwarder(), 'should be a forwarder')
      })
    }

    context('when the app has already been initialized', () => {
      beforeEach('initialize tollgate app', async () => {
        await tollgate.initialize(feeToken.address, FEE_AMOUNT, destination)
      })

      itShouldAlwaysBeForwarder()
    })

    context('when it has not been initialized yet', () => {
      itShouldAlwaysBeForwarder()
    })
  })

  describe('canForward', () => {
    context('when the app has already been initialized', () => {
      beforeEach('initialize tollgate app', async () => {
        await tollgate.initialize(feeToken.address, FEE_AMOUNT, destination)
      })

      context('when the sender is has fee tokens', () => {
        const sender = user

        it('returns true', async () =>  {
          assert.isTrue(await tollgate.canForward(sender, '0x'), 'sender should be able to forward')
        })
      })

      context('when the sender does not have fee tokens', () => {
        const sender = someone

        it('returns true', async () =>  {
          assert.isTrue(await tollgate.canForward(sender, '0x'), 'sender should be able to forward')
        })
      })
    })

    context('when it has not been initialized yet', () => {
      context('when the sender is has fee tokens', () => {
        const sender = user

        it('returns false', async () =>  {
          assert.isFalse(await tollgate.canForward(sender, '0x'), 'sender should not be able to forward')
        })
      })

      context('when the sender does not have fee tokens', () => {
        const sender = someone

        it('returns false', async () =>  {
          assert.isFalse(await tollgate.canForward(sender, '0x'), 'sender should not be able to forward')
        })
      })
    })
  })

  describe('forward', () => {
    let executionTarget, script

    beforeEach('build script', async () => {
      executionTarget = await ExecutionTarget.new()
      const action = { to: executionTarget.address, calldata: executionTarget.contract.execute.getData() }
      script = encodeCallScript([action])
    })

    context('when the app has already been initialized', () => {
      const from = user

      context('when the fee amount is greater than zero', () => {
        beforeEach('initialize tollgate app', async () => {
          await tollgate.initialize(feeToken.address, FEE_AMOUNT, destination)
        })

        context('when the sender has approved the fee costs to the tollgate app', () => {
          beforeEach('allow token fees', async () => {
            await feeToken.approve(tollgate.address, FEE_AMOUNT, { from })
          })

          it('forwards the action', async () =>  {
            await tollgate.forward(script, { from })

            assert.equal(await executionTarget.counter(), 1, 'the execution script has not received execution calls')
          })

          it('transfers the fee amount to the destination', async () =>  {
            const userPreviousBalance = await feeToken.balanceOf(user)
            const destinationPreviousBalance = await feeToken.balanceOf(destination)

            await tollgate.forward(script, { from })

            const userCurrentBalance = await feeToken.balanceOf(user)
            const destinationCurrentBalance = await feeToken.balanceOf(destination)

            assert.equal(userCurrentBalance.toString(), userPreviousBalance.minus(FEE_AMOUNT).toString(), 'user current balance does not match')
            assert.equal(destinationCurrentBalance.toString(), destinationPreviousBalance.plus(FEE_AMOUNT).toString(), 'destination current balance does not match')
          })
        })

        context('when the sender has not approved the fee costs to the tollgate app', () => {
          it('reverts', async () =>  {
            await assertRevert(tollgate.forward(script, { from }), 'TOLLGATE_FEE_TRANSFER_REVERTED')
          })
        })
      })

      context('when the fee amount is zero', () => {
        beforeEach('initialize tollgate app', async () => {
          await tollgate.initialize(feeToken.address, 0, destination)
        })

        const itAlwaysForwardActions = () => {
          it('forwards the action', async () =>  {
            await tollgate.forward(script, { from })

            assert.equal(await executionTarget.counter(), 1, 'the execution script has not received execution calls')
          })

          it('does not transfer a fee amount to the destination', async () =>  {
            const userPreviousBalance = await feeToken.balanceOf(user)
            const destinationPreviousBalance = await feeToken.balanceOf(destination)

            await tollgate.forward(script, { from })

            const userCurrentBalance = await feeToken.balanceOf(user)
            const destinationCurrentBalance = await feeToken.balanceOf(destination)

            assert.equal(userCurrentBalance.toString(), userPreviousBalance.toString(), 'user current balance does not match')
            assert.equal(destinationCurrentBalance.toString(), destinationPreviousBalance.toString(), 'destination current balance does not match')
          })
        }

        context('when the sender has approved the fee costs to the tollgate app', () => {
          beforeEach('allow token fees', async () => {
            await feeToken.approve(tollgate.address, FEE_AMOUNT, { from })
          })

          itAlwaysForwardActions()
        })

        context('when the sender has not approved the fee costs to the tollgate app', () => {
          itAlwaysForwardActions()
        })
      })
    })

    context('when it has not been initialized yet', () => {
      it('reverts', async () => {
        await assertRevert(tollgate.forward(script, { from: user }), 'TOLLGATE_CAN_NOT_FORWARD')
      })
    })
  })
})
