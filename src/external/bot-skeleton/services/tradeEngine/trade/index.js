import { applyMiddleware, createStore } from 'redux';
import { thunk } from 'redux-thunk';
import { localize } from '@deriv-com/translations';
import { createError } from '../../../utils/error';
import { observer as globalObserver } from '../../../utils/observer';
import { api_base } from '../../api/api-base';
import { checkBlocksForProposalRequest, doUntilDone } from '../utils/helpers';
import { expectInitArg } from '../utils/sanitize';
import { proposalsReady, start } from './state/actions';
import * as constants from './state/constants';
import rootReducer from './state/reducers';
import Balance from './Balance';
import OpenContract from './OpenContract';
import Proposal from './Proposal';
import Purchase from './Purchase';
import Sell from './Sell';
import Ticks from './Ticks';
import Total from './Total';
import VirtualHookManager from '../../virtual-hook-manager';

const watchBefore = store =>
    watchScope({
        store,
        stopScope: constants.DURING_PURCHASE,
        passScope: constants.BEFORE_PURCHASE,
        passFlag: 'proposalsReady',
    });

const watchDuring = store =>
    watchScope({
        store,
        stopScope: constants.STOP,
        passScope: constants.DURING_PURCHASE,
        passFlag: 'openContract',
    });

/* The watchScope function is called randomly and resets the prevTick
 * which leads to the same problem we try to solve. So prevTick is isolated
 */
let prevTick;
const watchScope = ({ store, stopScope, passScope, passFlag }) => {
    // in case watch is called after stop is fired
    if (store.getState().scope === stopScope) {
        return Promise.resolve(false);
    }
    return new Promise(resolve => {
        const unsubscribe = store.subscribe(() => {
            const newState = store.getState();

            if (newState.newTick === prevTick) return;
            prevTick = newState.newTick;

            if (newState.scope === passScope && newState[passFlag]) {
                unsubscribe();
                resolve(true);
            }

            if (newState.scope === stopScope) {
                unsubscribe();
                resolve(false);
            }
        });
    });
};

export default class TradeEngine extends Balance(Purchase(Sell(OpenContract(Proposal(Ticks(Total(class {}))))))) {
    constructor($scope) {
        super();
        this.observer = $scope.observer;
        this.$scope = $scope;
        this.observe();
        this.data = {
            contract: {},
            proposals: [],
        };
        this.subscription_id_for_accumulators = null;
        this.is_proposal_requested_for_accumulators = false;
        this.store = createStore(rootReducer, applyMiddleware(thunk));
    }

    init(...args) {
        const [token, options] = expectInitArg(args);
        const { symbol } = options;

        this.initArgs = args;
        this.options = options;
        this.startPromise = this.loginAndGetBalance(token);

        if (!this.checkTicksPromiseExists()) this.watchTicks(symbol);
    }

    start(tradeOptions) {
        if (!this.options) {
            throw createError('NotInitialized', localize('Bot.init is not called'));
        }

        globalObserver.emit('bot.running');

        const validated_trade_options = this.validateTradeOptions(tradeOptions);

        // Explicitly preserve virtual_hook configuration in trade parameters
        this.tradeOptions = {
            ...validated_trade_options,
            symbol: this.options.symbol,
            virtual_hook: tradeOptions.virtual_hook || undefined,
        };

        // Initialize Virtual Hook if configured in trade options
        if (tradeOptions.virtual_hook) {
            VirtualHookManager.initialize({
                enabled: tradeOptions.virtual_hook.enabled || false,
                martingale_multiplier: tradeOptions.virtual_hook.martingale_multiplier || 2,
            });

            // Subscribe to virtual hook mode changes for logging/monitoring
            VirtualHookManager.onModeChange((event) => {
                globalObserver.emit('bot.virtual_hook_mode_change', event);
                console.log('[Virtual Hook] Mode changed:', event);
            });
        } else {
            VirtualHookManager.initialize({ enabled: false });
        }

        this.store.dispatch(start());
        this.checkLimits(validated_trade_options);

        this.makeDirectPurchaseDecision();
    }

    loginAndGetBalance(token) {
        if (this.token === token) {
            return Promise.resolve();
        }
        // for strategies using total runs, GetTotalRuns function is trying to get loginid and it gets called before Proposals calls.
        // the below required loginid to be set in Proposal calls where loginAndGetBalance gets resolved.
        // Earlier this used to happen as soon as we get ticks_history response and by the time GetTotalRuns gets called we have required info.
        this.accountInfo = api_base.account_info;
        this.token = api_base.token;
        return new Promise(resolve => {
            // Try to recover from a situation where API doesn't give us a correct response on
            // "proposal_open_contract" which would make the bot run forever. When there's a "sell"
            // event, wait a couple seconds for the API to give us the correct "proposal_open_contract"
            // response, if there's none after x seconds. Send an explicit request, which _should_
            // solve the issue. This is a backup!
            const subscription = api_base.api.onMessage().subscribe(({ data }) => {
                if (data.msg_type === 'transaction' && data.transaction.action === 'sell') {
                    this.transaction_recovery_timeout = setTimeout(() => {
                        const { contract } = this.data;
                        const is_same_contract = contract.contract_id === data.transaction.contract_id;
                        const is_open_contract = contract.status === 'open';
                        if (is_same_contract && is_open_contract) {
                            doUntilDone(() => {
                                api_base.api.send({ proposal_open_contract: 1, contract_id: contract.contract_id });
                            }, ['PriceMoved']);
                        }
                    }, 1500);
                }
                resolve();
            });
            api_base.pushSubscription(subscription);
        });
    }

    observe() {
        this.observeOpenContract();
        this.observeBalance();
        this.observeProposals();

        // Hook into contract completion for virtual hook result processing
        if (VirtualHookManager.is_enabled) {
            globalObserver.register('contract.sold', this.processVirtualHookResult);
        }
    }

    processVirtualHookResult = (contractData) => {
        // Process trade result with virtual hook
        if (!VirtualHookManager.is_enabled || !this.data.contract) {
            return;
        }

        const contract = this.data.contract;
        const sellPrice = parseFloat(contract.sell_price) || 0;
        const buyPrice = parseFloat(contract.buy_price) || 0;
        const profit = sellPrice - buyPrice;
        const result = profit < 0 ? 'loss' : 'win';

        // Update virtual hook with result 
        const stakeAmount = parseFloat(this.tradeOptions.amount) || 1;
        const update = VirtualHookManager.handleTradeResult(result, stakeAmount);

        // If mode changed to real with martingale, update the stake
        if (update.mode_changed && update.action === 'switched_to_real_with_martingale') {
            const newStake = stakeAmount * VirtualHookManager.martingale_multiplier;
            this.tradeOptions.amount = newStake;

            console.log('[Virtual Hook] Switched to REAL mode. Applying martingale: new stake =', newStake);
            globalObserver.emit('bot.virtual_hook_martingale_applied', {
                old_stake: stakeAmount,
                new_stake: newStake,
                multiplier: VirtualHookManager.martingale_multiplier,
            });
        }

        globalObserver.emit('bot.virtual_hook_result_processed', {
            trade_result: result,
            stake: stakeAmount,
            profit: profit,
            virtual_hook_state: VirtualHookManager.getState(),
        });
    };

    watch(watchName) {
        if (watchName === 'before') {
            return watchBefore(this.store);
        }
        return watchDuring(this.store);
    }

    makeDirectPurchaseDecision() {
        const { has_payout_block, is_basis_payout } = checkBlocksForProposalRequest();
        this.is_proposal_subscription_required = has_payout_block || is_basis_payout;

        if (this.is_proposal_subscription_required) {
            this.makeProposals({ ...this.options, ...this.tradeOptions });
            this.checkProposalReady();
        } else {
            this.store.dispatch(proposalsReady());
        }
    }

    /**
     * Reset virtual hook state when bot stops or is reset
     */
    resetVirtualHook() {
        if (VirtualHookManager.is_enabled) {
            VirtualHookManager.reset();
            console.log('[Virtual Hook] Reset virtual hook state');
        }
    }
}
