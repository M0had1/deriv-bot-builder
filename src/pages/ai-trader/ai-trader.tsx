import React, { useState, useEffect, useCallback, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { localize } from '@deriv-com/translations';
import { useStore } from '@/hooks/useStore';
import { api_base } from '@/external/bot-skeleton';
import './ai-trader.scss';

interface TradeSignal {
    market: string;
    type: 'CALL' | 'PUT' | 'DIGIT' | 'EVEN' | 'ODD' | 'RISE' | 'FALL';
    confidence: number;
    analysisData: {
        momentum: number;
        trend: string;
        volatility: number;
        resistance: number;
        support: number;
    };
}

interface TradeHistory {
    id: string;
    market: string;
    type: string;
    amount: number;
    result: 'win' | 'loss' | 'pending';
    profit: number;
    timestamp: number;
    isRecoveryTrade: boolean;
}

interface MarketAnalysis {
    market: string;
    currentPrice: number;
    trend: string;
    momentum: number;
    volatility: number;
    rsi: number;
    macd: number;
    bollingerBands: {
        upper: number;
        middle: number;
        lower: number;
    };
}

const LOW_RISK_MARKETS = ['digit_over_0', 'digit_under_9', 'differ_digit', 'rise_fall'];
const RECOVERY_MARKETS = ['digit_over_4', 'digit_under_5', 'even_odd', 'rise_fall'];

class AITradeAnalyzer {
    private priceHistory: number[] = [];
    private maxHistoryLength = 100;

    analyzePrices(prices: number[]): MarketAnalysis {
        this.priceHistory = [...this.priceHistory, ...prices].slice(-this.maxHistoryLength);
        
        const currentPrice = prices[prices.length - 1];
        const previousPrice = prices[Math.max(0, prices.length - 2)];
        
        const trend = currentPrice > previousPrice ? 'uptrend' : 'downtrend';
        const momentum = this.calculateMomentum(prices);
        const volatility = this.calculateVolatility(prices);
        const rsi = this.calculateRSI(prices);
        const macd = this.calculateMACD(prices);
        const bollingerBands = this.calculateBollingerBands(prices);

        return {
            market: 'current',
            currentPrice,
            trend,
            momentum,
            volatility,
            rsi,
            macd,
            bollingerBands,
        };
    }

    private calculateMomentum(prices: number[]): number {
        if (prices.length < 2) return 0;
        const recent = prices.slice(-5);
        const suma = recent.length;
        const sum = recent.reduce((a, b) => a + b, 0);
        return ((recent[recent.length - 1] - recent[0]) / recent[0]) * 100;
    }

    private calculateVolatility(prices: number[]): number {
        if (prices.length < 2) return 0;
        const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
        const variance = prices.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / prices.length;
        return Math.sqrt(variance);
    }

    private calculateRSI(prices: number[], period = 14): number {
        if (prices.length < period + 1) return 50;
        
        let gains = 0;
        let losses = 0;

        for (let i = prices.length - period; i < prices.length; i++) {
            const diff = prices[i] - prices[i - 1];
            if (diff > 0) gains += diff;
            else losses += Math.abs(diff);
        }

        const avgGain = gains / period;
        const avgLoss = losses / period;
        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        return 100 - (100 / (1 + rs));
    }

    private calculateMACD(prices: number[]): number {
        const ema12 = this.calculateEMA(prices, 12);
        const ema26 = this.calculateEMA(prices, 26);
        return ema12 - ema26;
    }

    private calculateBollingerBands(prices: number[], period = 20, stdDev = 2) {
        if (prices.length < period) {
            return { upper: 0, middle: 0, lower: 0 };
        }

        const recentPrices = prices.slice(-period);
        const middle = recentPrices.reduce((a, b) => a + b, 0) / period;
        const variance = recentPrices.reduce((a, b) => a + Math.pow(b - middle, 2), 0) / period;
        const std = Math.sqrt(variance);

        return {
            upper: middle + stdDev * std,
            middle,
            lower: middle - stdDev * std,
        };
    }

    private calculateEMA(prices: number[], period: number): number {
        if (prices.length < period) return prices[prices.length - 1];
        
        const multiplier = 2 / (period + 1);
        let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;

        for (let i = period; i < prices.length; i++) {
            ema = prices[i] * multiplier + ema * (1 - multiplier);
        }

        return ema;
    }

    generateTradeSignal(analysis: MarketAnalysis): TradeSignal | null {
        const { rsi, momentum, trend, volatility, bollingerBands } = analysis;
        
        // Strong signals with high confidence
        if (rsi < 30 && momentum < -2 && trend === 'downtrend' && volatility < 2) {
            return {
                market: 'digit_over_0',
                type: 'CALL',
                confidence: 0.85,
                analysisData: {
                    momentum,
                    trend,
                    volatility,
                    resistance: bollingerBands.upper,
                    support: bollingerBands.lower,
                },
            };
        }

        if (rsi > 70 && momentum > 2 && trend === 'uptrend' && volatility < 2) {
            return {
                market: 'digit_under_9',
                type: 'PUT',
                confidence: 0.85,
                analysisData: {
                    momentum,
                    trend,
                    volatility,
                    resistance: bollingerBands.upper,
                    support: bollingerBands.lower,
                },
            };
        }

        if (Math.abs(momentum) < 1 && volatility > 1.5) {
            return {
                market: 'differ_digit',
                type: 'DIGIT',
                confidence: 0.75,
                analysisData: {
                    momentum,
                    trend,
                    volatility,
                    resistance: bollingerBands.upper,
                    support: bollingerBands.lower,
                },
            };
        }

        return null;
    }

    generateRecoverySignal(lastLoss: number): TradeSignal {
        const recoveryType = Math.floor(Math.random() * 4);
        const signals: TradeSignal[] = [
            {
                market: 'digit_over_4',
                type: 'DIGIT',
                confidence: 0.70,
                analysisData: {
                    momentum: 0,
                    trend: 'recovery',
                    volatility: 0,
                    resistance: 0,
                    support: 0,
                },
            },
            {
                market: 'digit_under_5',
                type: 'DIGIT',
                confidence: 0.70,
                analysisData: {
                    momentum: 0,
                    trend: 'recovery',
                    volatility: 0,
                    resistance: 0,
                    support: 0,
                },
            },
            {
                market: 'even_odd',
                type: 'EVEN',
                confidence: 0.65,
                analysisData: {
                    momentum: 0,
                    trend: 'recovery',
                    volatility: 0,
                    resistance: 0,
                    support: 0,
                },
            },
            {
                market: 'rise_fall',
                type: Math.random() > 0.5 ? 'RISE' : 'FALL',
                confidence: 0.65,
                analysisData: {
                    momentum: 0,
                    trend: 'recovery',
                    volatility: 0,
                    resistance: 0,
                    support: 0,
                },
            },
        ];

        return signals[recoveryType];
    }
}

const AITrader = observer(() => {
    const { client } = useStore();
    const [isRunning, setIsRunning] = useState(false);
    const [tradeHistory, setTradeHistory] = useState<TradeHistory[]>([]);
    const [currentSignal, setCurrentSignal] = useState<TradeSignal | null>(null);
    const [marketAnalysis, setMarketAnalysis] = useState<MarketAnalysis | null>(null);
    const [balance, setBalance] = useState(0);
    const [profit, setProfit] = useState(0);
    const [stats, setStats] = useState({
        totalTrades: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        martingaleMultiplier: 2,
        currentStake: 1,
    });

    const analyzerRef = useRef(new AITradeAnalyzer());
    const pricesRef = useRef<number[]>([]);
    const subscriptionRef = useRef<any>(null);

    const updateBalance = useCallback(() => {
        if (api_base?.api) {
            api_base.api.send({ balance: 1 }).then((response: any) => {
                if (!response.error) {
                    setBalance(response.balance?.balance || 0);
                }
            });
        }
    }, []);

    useEffect(() => {
        updateBalance();
        const interval = setInterval(updateBalance, 5000);
        return () => clearInterval(interval);
    }, [updateBalance]);

    const executeRecoveryTrade = useCallback(async (martingaleAmount: number) => {
        if (!api_base?.api) return;

        try {
            const signal = analyzerRef.current.generateRecoverySignal(martingaleAmount);
            setCurrentSignal(signal);

            const proposal = {
                contract_type: signal.type,
                currency: client.currency,
                amount: martingaleAmount,
                symbol: '1HZ100V',
                duration: 1,
                duration_unit: 'm',
            };

            // Send proposed contract to API
            api_base.api.send(proposal).then((response: any) => {
                if (!response.error && response.proposal) {
                    const newTrade: TradeHistory = {
                        id: `trade-${Date.now()}`,
                        market: signal.market,
                        type: signal.type,
                        amount: martingaleAmount,
                        result: 'pending',
                        profit: 0,
                        timestamp: Date.now(),
                        isRecoveryTrade: true,
                    };

                    setTradeHistory(prev => [...prev, newTrade]);
                    
                    // Auto buy at market price
                    api_base.api.send({
                        buy: response.proposal.id,
                        price: response.proposal.ask_price,
                    });
                }
            });
        } catch (error) {
            console.error('Recovery trade error:', error);
        }
    }, [client.currency]);

    const executeTrade = useCallback(async (signal: TradeSignal) => {
        if (!api_base?.api || !isRunning) return;

        try {
            const stake = stats.currentStake;

            const proposal = {
                contract_type: signal.type,
                currency: client.currency,
                amount: stake,
                symbol: '1HZ100V',
                duration: 1,
                duration_unit: 'm',
            };

            api_base.api.send(proposal).then((response: any) => {
                if (!response.error && response.proposal) {
                    const newTrade: TradeHistory = {
                        id: `trade-${Date.now()}`,
                        market: signal.market,
                        type: signal.type,
                        amount: stake,
                        result: 'pending',
                        profit: 0,
                        timestamp: Date.now(),
                        isRecoveryTrade: false,
                    };

                    setTradeHistory(prev => [...prev, newTrade]);

                    api_base.api.send({
                        buy: response.proposal.id,
                        price: response.proposal.ask_price,
                    });
                }
            });
        } catch (error) {
            console.error('Trade execution error:', error);
        }
    }, [isRunning, stats.currentStake, client.currency]);

    const handleTradeResult = useCallback((contractId: string, result: 'win' | 'loss', profit: number) => {
        setTradeHistory(prev =>
            prev.map(trade =>
                trade.id === contractId
                    ? { ...trade, result, profit }
                    : trade
            )
        );

        setStats(prev => {
            const newWins = result === 'win' ? prev.wins + 1 : prev.wins;
            const newLosses = result === 'loss' ? prev.losses + 1 : prev.losses;
            const newTotal = newWins + newLosses;
            const newWinRate = newTotal > 0 ? (newWins / newTotal) * 100 : 0;
            let newStake = prev.currentStake;

            if (result === 'loss') {
                newStake = prev.currentStake * prev.martingaleMultiplier;
                // Trigger recovery trade
                executeRecoveryTrade(newStake);
            } else if (result === 'win' && prev.losses > 0) {
                newStake = 1; // Reset to base stake after recovery win
            }

            return {
                ...prev,
                totalTrades: newTotal,
                wins: newWins,
                losses: newLosses,
                winRate: newWinRate,
                currentStake: newStake,
            };
        });

        setProfit(prev => prev + profit);
    }, [executeRecoveryTrade]);

    const startAITrading = useCallback(() => {
        if (!api_base?.api) return;

        setIsRunning(true);
        setTradeHistory([]);
        setProfit(0);

        // Subscribe to price updates
        const priceSubscription = {
            ticks: '1HZ100V',
        };

        subscriptionRef.current = api_base.api.onMessage().subscribe(({ data }: any) => {
            if (data.msg_type === 'tick' && data.tick) {
                const newPrice = data.tick.bid || 0;
                pricesRef.current = [...pricesRef.current, newPrice].slice(-100);

                if (pricesRef.current.length >= 10) {
                    const analysis = analyzerRef.current.analyzePrices(pricesRef.current);
                    setMarketAnalysis(analysis);

                    const signal = analyzerRef.current.generateTradeSignal(analysis);
                    if (signal && signal.confidence > 0.75) {
                        executeTrade(signal);
                    }
                }
            }

            if (data.msg_type === 'proposal_open_contract') {
                const contract = data.proposal_open_contract;
                if (contract.status !== 'open') {
                    const result = contract.profit > 0 ? 'win' : 'loss';
                    handleTradeResult(
                        `trade-${contract.contract_id}`,
                        result as 'win' | 'loss',
                        contract.profit || 0
                    );
                }
            }
        });

        api_base.api.send(priceSubscription);
    }, [executeTrade, handleTradeResult]);

    const stopAITrading = useCallback(() => {
        setIsRunning(false);
        if (subscriptionRef.current) {
            subscriptionRef.current.unsubscribe();
        }
        pricesRef.current = [];
    }, []);

    return (
        <div className='ai-trader-container'>
            <div className='ai-trader-header'>
                <h1>{localize('AI Trader')}</h1>
                <p>{localize('Automated trading with intelligent market analysis and recovery strategies')}</p>
            </div>

            <div className='ai-trader-content'>
                <div className='ai-trader-controls'>
                    <button
                        className={`ai-btn ${isRunning ? 'stop' : 'start'}`}
                        onClick={isRunning ? stopAITrading : startAITrading}
                    >
                        {isRunning ? localize('Stop AI Trader') : localize('Start AI Trader')}
                    </button>
                </div>

                <div className='ai-trader-stats'>
                    <div className='stat-card'>
                        <span className='stat-label'>{localize('Balance')}</span>
                        <span className='stat-value'>{balance.toFixed(2)}</span>
                    </div>
                    <div className='stat-card'>
                        <span className='stat-label'>{localize('Total Profit')}</span>
                        <span className={`stat-value ${profit >= 0 ? 'positive' : 'negative'}`}>
                            {profit >= 0 ? '+' : ''} {profit.toFixed(2)}
                        </span>
                    </div>
                    <div className='stat-card'>
                        <span className='stat-label'>{localize('Total Trades')}</span>
                        <span className='stat-value'>{stats.totalTrades}</span>
                    </div>
                    <div className='stat-card'>
                        <span className='stat-label'>{localize('Win Rate')}</span>
                        <span className='stat-value'>{stats.winRate.toFixed(2)}%</span>
                    </div>
                    <div className='stat-card'>
                        <span className='stat-label'>{localize('Current Stake')}</span>
                        <span className='stat-value'>{stats.currentStake.toFixed(2)}</span>
                    </div>
                    <div className='stat-card'>
                        <span className='stat-label'>{localize('Martingale x')}</span>
                        <span className='stat-value'>{stats.martingaleMultiplier}</span>
                    </div>
                </div>

                {marketAnalysis && (
                    <div className='market-analysis-panel'>
                        <h3>{localize('Market Analysis')}</h3>
                        <div className='analysis-grid'>
                            <div className='analysis-item'>
                                <span>{localize('Trend')}</span>
                                <strong>{marketAnalysis.trend}</strong>
                            </div>
                            <div className='analysis-item'>
                                <span>{localize('RSI')}</span>
                                <strong>{marketAnalysis.rsi.toFixed(2)}</strong>
                            </div>
                            <div className='analysis-item'>
                                <span>{localize('Volatility')}</span>
                                <strong>{marketAnalysis.volatility.toFixed(4)}</strong>
                            </div>
                            <div className='analysis-item'>
                                <span>{localize('Momentum')}</span>
                                <strong>{marketAnalysis.momentum.toFixed(2)}%</strong>
                            </div>
                        </div>
                    </div>
                )}

                <div className='trade-history-panel'>
                    <h3>{localize('Trade History')}</h3>
                    <div className='trade-history'>
                        {tradeHistory.length === 0 ? (
                            <p className='no-trades'>{localize('No trades yet')}</p>
                        ) : (
                            tradeHistory.slice().reverse().map(trade => (
                                <div key={trade.id} className={`trade-item ${trade.result}`}>
                                    <div className='trade-info'>
                                        <span className='trade-market'>{trade.market}</span>
                                        <span className='trade-type'>{trade.type}</span>
                                    </div>
                                    <div className='trade-details'>
                                        <span className='trade-amount'>{localize('Amount')}: {trade.amount.toFixed(2)}</span>
                                        <span className={`trade-profit ${trade.result}`}>
                                            {trade.result === 'pending' ? localize('Pending') : (
                                                trade.profit >= 0 ? `+${trade.profit.toFixed(2)}` : `${trade.profit.toFixed(2)}`
                                            )}
                                        </span>
                                        {trade.isRecoveryTrade && (
                                            <span className='recovery-badge'>{localize('Recovery')}</span>
                                        )}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
});

export default AITrader;
