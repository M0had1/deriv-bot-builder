import { LogTypes } from '../../../constants/messages';
import { api_base } from '../../api/api-base';
import { contractStatus, info, log } from '../utils/broadcast';
import { doUntilDone, getUUID, recoverFromError, tradeOptionToBuy } from '../utils/helpers';
import { purchaseSuccessful } from './state/actions';
import { BEFORE_PURCHASE } from './state/constants';
import VirtualHookManager from '../../virtual-hook-manager';

let delayIndex = 0;
let purchase_reference;

/**
 * Simulate a virtual trade result
 * @param {Object} tradeOptions - Trade options for the contract
 * @returns {Object} Simulated trade response
 */
const simulateVirtualTradeResult = (tradeOptions) => {
    // 50/50 chance of win/loss for virtual trades
    const won = Math.random() > 0.5;
    const buyPrice = parseFloat(tradeOptions.amount) || 1;
    const sellPrice = won ? buyPrice * 1.1 : buyPrice * 0.9; // Simulate 10% gain or loss
    
    return {
        buy: {
            transaction_id: `virtual_${getUUID()}`,
            contract_id: `virtual_${getUUID()}`,
            buy_price: buyPrice,
            sell_price: sellPrice,
            longcode: `[Virtual] ${tradeOptions.contract_type || 'CALL'}`,
            profit: sellPrice - buyPrice,
        },
    };
};

export default Engine =>
    class Purchase extends Engine {
        purchase(contract_type) {
            // Prevent calling purchase twice
            if (this.store.getState().scope !== BEFORE_PURCHASE) {
                return Promise.resolve();
            }

            const onSuccess = response => {
                // Don't unnecessarily send a forget request for a purchased contract.
                const { buy } = response;

                contractStatus({
                    id: 'contract.purchase_received',
                    data: buy.transaction_id,
                    buy,
                });

                this.contractId = buy.contract_id;
                this.store.dispatch(purchaseSuccessful());

                if (this.is_proposal_subscription_required) {
                    this.renewProposalsOnPurchase();
                }

                delayIndex = 0;
                log(LogTypes.PURCHASE, { longcode: buy.longcode, transaction_id: buy.transaction_id });
                info({
                    accountID: this.accountInfo.loginid,
                    totalRuns: this.updateAndReturnTotalRuns(),
                    transaction_ids: { buy: buy.transaction_id },
                    contract_type,
                    buy_price: buy.buy_price,
                });

                // Log virtual hook info if active
                if (VirtualHookManager.is_enabled) {
                    const modeLabel = VirtualHookManager.isVirtualMode() ? '[VIRTUAL]' : '[REAL]';
                    log(LogTypes.PURCHASE, { 
                        virtual_hook_mode: modeLabel,
                        trading_mode: VirtualHookManager.getTradingMode(),
                    });
                }
            };

            // Check if virtual hook is enabled and in virtual mode
            const shouldUseVirtualTrade = VirtualHookManager.is_enabled && VirtualHookManager.isVirtualMode();

            if (this.is_proposal_subscription_required) {
                const { id, askPrice } = this.selectProposal(contract_type);

                const action = () => {
                    if (shouldUseVirtualTrade) {
                        // Simulate virtual trade instead of real API call
                        return Promise.resolve(simulateVirtualTradeResult(this.tradeOptions));
                    }
                    return api_base.api.send({ buy: id, price: askPrice });
                };

                this.isSold = false;

                contractStatus({
                    id: 'contract.purchase_sent',
                    data: askPrice,
                });

                if (!this.options.timeMachineEnabled) {
                    return doUntilDone(action).then(onSuccess);
                }

                return recoverFromError(
                    action,
                    (errorCode, makeDelay) => {
                        // if disconnected no need to resubscription (handled by live-api)
                        if (errorCode !== 'DisconnectError') {
                            this.renewProposalsOnPurchase();
                        } else {
                            this.clearProposals();
                        }

                        const unsubscribe = this.store.subscribe(() => {
                            const { scope, proposalsReady } = this.store.getState();
                            if (scope === BEFORE_PURCHASE && proposalsReady) {
                                makeDelay().then(() => this.observer.emit('REVERT', 'before'));
                                unsubscribe();
                            }
                        });
                    },
                    ['PriceMoved', 'InvalidContractProposal'],
                    delayIndex++
                ).then(onSuccess);
            }

            const trade_option = tradeOptionToBuy(contract_type, this.tradeOptions);
            
            const action = () => {
                if (shouldUseVirtualTrade) {
                    // Simulate virtual trade instead of real API call
                    return Promise.resolve(simulateVirtualTradeResult(this.tradeOptions));
                }
                return api_base.api.send(trade_option);
            };

            this.isSold = false;

            contractStatus({
                id: 'contract.purchase_sent',
                data: this.tradeOptions.amount,
            });

            if (!this.options.timeMachineEnabled) {
                return doUntilDone(action).then(onSuccess);
            }

            return recoverFromError(
                action,
                (errorCode, makeDelay) => {
                    if (errorCode === 'DisconnectError') {
                        this.clearProposals();
                    }
                    const unsubscribe = this.store.subscribe(() => {
                        const { scope } = this.store.getState();
                        if (scope === BEFORE_PURCHASE) {
                            makeDelay().then(() => this.observer.emit('REVERT', 'before'));
                            unsubscribe();
                        }
                    });
                },
                ['PriceMoved', 'InvalidContractProposal'],
                delayIndex++
            ).then(onSuccess);
        }
        getPurchaseReference = () => purchase_reference;
        regeneratePurchaseReference = () => {
            purchase_reference = getUUID();
        };
    };
