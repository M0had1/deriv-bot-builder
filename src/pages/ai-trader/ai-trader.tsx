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

interface AISettings {
    baseStake: number;
    martingaleMultiplier: number;
    confidenceThreshold: number;
    selectedMarkets: string[];
    enableRecovery: boolean;
}

const DEFAULT_MARKETS = ['digit_over_0', 'digit_under_9', 'differ_digit', 'rise_fall'];
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

    generateTradeSignal(analysis: MarketAnalysis, selectedMarkets: string[]): TradeSignal | null {
        const { rsi, momentum, trend, volatility, bollingerBands } = analysis;
        
        if (rsi < 30 && momentum < -2 && trend === 'downtrend' && volatility < 2) {
            const market = selectedMarkets.includes('digit_over_0') ? 'digit_over_0' : selectedMarkets[0];
            return {
                market,
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
            const market = selectedMarkets.includes('digit_under_9') ? 'digit_under_9' : selectedMarkets[0];
            return {
                market,
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
            const market = selectedMarkets.includes('differ_digit') ? 'differ_digit' : selectedMarkets[0];
            return {
                market,
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

    generateRecoverySignal(recoveryMarkets: string[]): TradeSignal {
        const recoveryType = Math.floor(Math.random() * Math.min(4, recoveryMarkets.length));
        const selectedMarket = recoveryMarkets[recoveryType] || 'rise_fall';

        const signals: { [key: string]: TradeSignal } = {
            'digit_over_4': {
                market: 'digit_over_4',
                type: 'DIGIT',
                confidence: 0.70,
                analysisData: { momentum: 0, trend: 'recovery', volatility: 0, resistance: 0, support: 0 },
            },
            'digit_under_5': {
                market: 'digit_under_5',
                type: 'DIGIT',
                confidence: 0.70,
                analysisData: { momentum: 0, trend: 'recovery', volatility: 0, resistance: 0, support: 0 },
            },
            'even_odd': {
                market: 'even_odd',
                type: 'EVEN',
                confidence: 0.65,
                analysisData: { momentum: 0, trend: 'recovery', volatility: 0, resistance: 0, support: 0 },
            },
            'rise_fall': {
                market: 'rise_fall',
                type: Math.random() > 0.5 ? 'RISE' : 'FALL',
                confidence: 0.65,
                analysisData: { momentum: 0, trend: 'recovery', volatility: 0, resistance: 0, support: 0 },
            },
        };

        return signals[selectedMarket] || signals['rise_fall'];
    }
}

const AITrader = observer(() => {
    const { client } = useStore();
    const [isRunning, setIsRunning] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
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
    });

    const [settings, setSettings] = useState<AISettings>({
        baseStake: 1,
        martingaleMultiplier: 2,
        confidenceThreshold: 0.75,
        selectedMarkets: DEFAULT_MARKETS,
        enableRecovery: true,
    });

    const [tempSettings, setTempSettings] = useState<AISettings>(settings);
    const analyzerRef = useRef(new AITradeAnalyzer());
    const pricesRef = useRef<number[]>([]);
    const subscriptionRef = useRef<any>(null);
    const currentStakeRef = useRef(settings.baseStake);

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

    const applySettings = useCallback(() => {
        setSettings(tempSettings);
        currentStakeRef.current = tempSettings.baseStake;
        setShowSettings(false);
    }, [tempSettings]);

    const resetSettings = useCallback(() => {
        setTempSettings(settings);
    }, [settings]);

    const handleMarketToggle = (market: string) => {
        setTempSettings(prev => ({
            ...prev,
            selectedMarkets: prev.selectedMarkets.includes(market)
                ? prev.selectedMarkets.filter(m => m !== market)
                : [...prev.selectedMarkets, market]
        }));
    };

    const executeRecoveryTrade = useCallback(async () => {
        if (!api_base?.api || !settings.enableRecovery) return;

        try {
            const martingaleAmount = currentStakeRef.current * settings.martingaleMultiplier;
            const signal = analyzerRef.current.generateRecoverySignal(RECOVERY_MARKETS);
            setCurrentSignal(signal);

            const proposal = {
                contract_type: signal.type,
                currency: client.currency,
                amount: martingaleAmount,
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
                        amount: martingaleAmount,
                        result: 'pending',
                        profit: 0,
                        timestamp: Date.now(),
                        isRecoveryTrade: true,
                    };

                    setTradeHistory(prev => [...prev, newTrade]);
                    
                    api_base.api.send({
                        buy: response.proposal.id,
                        price: response.proposal.ask_price,
                    });
                }
            });
        } catch (error) {
            console.error('Recovery trade error:', error);
        }
    }, [client.currency, settings.enableRecovery, settings.martingaleMultiplier]);

    const executeTrade = useCallback(async (signal: TradeSignal) => {
        if (!api_base?.api || !isRunning) return;

        try {
            const proposal = {
                contract_type: signal.type,
                currency: client.currency,
                amount: currentStakeRef.current,
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
                        amount: currentStakeRef.current,
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
    }, [isRunning, client.currency]);

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

            if (result === 'loss') {
                currentStakeRef.current = currentStakeRef.current * settings.martingaleMultiplier;
                executeRecoveryTrade();
            } else if (result === 'win' && prev.losses > 0) {
                currentStakeRef.current = settings.baseStake;
            }

            return {
                ...prev,
                totalTrades: newTotal,
                wins: newWins,
                losses: newLosses,
                winRate: newWinRate,
            };
        });

        setProfit(prev => prev + profit);
    }, [settings.baseStake, settings.martingaleMultiplier, executeRecoveryTrade]);

    const startAITrading = useCallback(() => {
        if (!api_base?.api || settings.selectedMarkets.length === 0) return;

        setIsRunning(true);
        setTradeHistory([]);
        setProfit(0);
        currentStakeRef.current = settings.baseStake;

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

                    const signal = analyzerRef.current.generateTradeSignal(analysis, settings.selectedMarkets);
                    if (signal && signal.confidence > settings.confidenceThreshold) {
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
    }, [executeTrade, handleTradeResult, settings]);

    const stopAITrading = useCallback(() => {
        setIsRunning(false);
        if (subscriptionRef.current) {
            subscriptionRef.current.unsubscribe();
        }
        pricesRef.current = [];
    }, []);

    const getStatusColor = () => {
        if (!isRunning) return 'idle';
        if (stats.winRate > 60) return 'excellent';
        if (stats.winRate > 50) return 'good';
        if (stats.winRate > 40) return 'fair';
        return 'poor';
    };

    const getPerformanceIndicator = () => {
        const rate = stats.winRate;
        if (rate > 70) return { label: 'EXCELLENT', icon: '⭐⭐⭐', color: '#10b981' };
        if (rate > 60) return { label: 'VERY GOOD', icon: '⭐⭐', color: '#3b82f6' };
        if (rate > 50) return { label: 'GOOD', icon: '⭐', color: '#f59e0b' };
        return { label: 'NEUTRAL', icon: '○', color: '#6b7280' };
    };

    const performanceIndicator = getPerformanceIndicator();

    return (
        <div className='ai-trader-container'>
            <div className='ai-trader-wrapper'>
                {/* Professional Header */}
                <div className='ai-trader-header'>
                    <div className='header-content'>
                        <div className='header-info'>
                            <div className='header-logo-section'>🤖</div>
                            <div className='title-section'>
                                <h1>{localize('AI Trader Pro')}</h1>
                                <p>{localize('Intelligent Trading System')}</p>
                            </div>
                        </div>

                        <div className='header-stats'>
                            <div className='stat'>
                                <span className='stat-value'>{stats.totalTrades}</span>
                                <span className='stat-label'>{localize('Trades')}</span>
                            </div>
                            <div className='stat'>
                                <span className='stat-value' style={{color: performanceIndicator.color}}>
                                    {stats.winRate.toFixed(1)}%
                                </span>
                                <span className='stat-label'>{localize('Win Rate')}</span>
                            </div>
                            <div className='stat'>
                                <span className='stat-value' style={{color: profit >= 0 ? '#10b981' : '#ef4444'}}>
                                    {profit >= 0 ? '+' : ''}{profit.toFixed(2)}
                                </span>
                                <span className='stat-label'>{localize('Profit')}</span>
                            </div>
                        </div>

                        <div className='header-actions'>
                            <button
                                className={`control-btn ${isRunning ? 'btn-stop' : 'btn-start'}`}
                                onClick={isRunning ? stopAITrading : startAITrading}
                                disabled={!isRunning && settings.selectedMarkets.length === 0}
                            >
                                <span>{isRunning ? '⏸' : '▶'}</span>
                                <span className='btn-text'>{isRunning ? localize('Stop') : localize('Start')}</span>
                            </button>
                            <button
                                className={`settings-btn ${showSettings ? 'active' : ''}`}
                                onClick={() => setShowSettings(!showSettings)}
                                title={localize('Settings')}
                            >
                                ⚙️
                            </button>
                        </div>
                    </div>

                    {isRunning && (
                        <div className='live-indicator'>
                            <div className='pulse-dot'></div>
                            <span>{localize('LIVE TRADING')}</span>
                        </div>
                    )}
                </div>

                <div className='ai-trader-main'>
                    {/* Professional Settings Panel */}
                    {showSettings && (
                        <div className='settings-panel'>
                            <div className='settings-header'>
                                <h3 className='header-title'>
                                    <span>⚙️</span>
                                    {localize('Advanced Settings')}
                                </h3>
                                <button className='close-btn' onClick={() => setShowSettings(false)}>✕</button>
                            </div>

                            <div className='settings-content'>
                                {/* Trading Parameters Section */}
                                <div className='settings-section'>
                                    <div className='section-header'>
                                        <h4>💵 {localize('Trading Parameters')}</h4>
                                        <div className='section-count'>{localize('Basic')}</div>
                                    </div>

                                    <div className='setting-group'>
                                        <div className='label-row'>
                                            <label>{localize('Base Stake')}</label>
                                            <span className='hint'>Min: 0.1 {client.currency}</span>
                                        </div>
                                        <div className='input-wrapper'>
                                            <input
                                                type='number'
                                                min='0.1'
                                                step='0.1'
                                                value={tempSettings.baseStake}
                                                onChange={(e) => setTempSettings({
                                                    ...tempSettings,
                                                    baseStake: parseFloat(e.target.value) || 1
                                                })}
                                                placeholder='Enter stake amount'
                                            />
                                            <span className='input-suffix'>{client.currency}</span>
                                        </div>
                                    </div>

                                    <div className='setting-group'>
                                        <div className='label-row'>
                                            <label>{localize('Martingale Multiplier')}</label>
                                            <span className='hint'>1x - 8x</span>
                                        </div>
                                        <div className='input-wrapper'>
                                            <input
                                                type='number'
                                                min='1'
                                                max='8'
                                                step='0.5'
                                                value={tempSettings.martingaleMultiplier}
                                                onChange={(e) => setTempSettings({
                                                    ...tempSettings,
                                                    martingaleMultiplier: parseFloat(e.target.value) || 2
                                                })}
                                                placeholder='Multiplier'
                                            />
                                            <span className='input-suffix'>x</span>
                                        </div>
                                    </div>

                                    <div className='setting-group'>
                                        <div className='label-row'>
                                            <label>{localize('Confidence Threshold')}</label>
                                            <span className='hint'>{(tempSettings.confidenceThreshold * 100).toFixed(0)}%</span>
                                        </div>
                                        <div className='slider-wrapper'>
                                            <input
                                                type='range'
                                                min='0.5'
                                                max='0.95'
                                                step='0.05'
                                                value={tempSettings.confidenceThreshold}
                                                onChange={(e) => setTempSettings({
                                                    ...tempSettings,
                                                    confidenceThreshold: parseFloat(e.target.value)
                                                })}
                                            />
                                            <span className='slider-value'>{(tempSettings.confidenceThreshold * 100).toFixed(0)}%</span>
                                        </div>
                                    </div>

                                    <div className='setting-group checkbox-group'>
                                        <label>
                                            <input
                                                type='checkbox'
                                                checked={tempSettings.enableRecovery}
                                                onChange={(e) => setTempSettings({
                                                    ...tempSettings,
                                                    enableRecovery: e.target.checked
                                                })}
                                            />
                                            <div className='label-text'>
                                                <span className='checkbox-label'>🔄 {localize('Enable Loss Recovery')}</span>
                                                <span className='checkbox-desc'>{localize('Auto-recover with martingale strategy')}</span>
                                            </div>
                                        </label>
                                    </div>
                                </div>

                                {/* Market Selection Section */}
                                <div className='settings-section'>
                                    <div className='section-header'>
                                        <h4>🎯 {localize('Trading Markets')}</h4>
                                        <div className='section-count'>{tempSettings.selectedMarkets.length} / 4</div>
                                    </div>

                                    <div className='markets-container'>
                                        {DEFAULT_MARKETS.map(market => (
                                            <label key={market} className='market-card'>
                                                <input
                                                    type='checkbox'
                                                    checked={tempSettings.selectedMarkets.includes(market)}
                                                    onChange={() => handleMarketToggle(market)}
                                                />
                                                <div className='market-icon'>
                                                    {market === 'digit_over_0' && '📊'}
                                                    {market === 'digit_under_9' && '📉'}
                                                    {market === 'differ_digit' && '🔄'}
                                                    {market === 'rise_fall' && '📈'}
                                                </div>
                                                <div className='market-details'>
                                                    <span className='market-name'>
                                                        {market === 'digit_over_0' && 'Over 0'}
                                                        {market === 'digit_under_9' && 'Under 9'}
                                                        {market === 'differ_digit' && 'Differ Digit'}
                                                        {market === 'rise_fall' && 'Rise/Fall'}
                                                    </span>
                                                    <span className='market-type'>
                                                        {(market === 'digit_over_0' || market === 'digit_under_9' || market === 'differ_digit') 
                                                            ? 'Digits' 
                                                            : 'Volatility'}
                                                    </span>
                                                </div>
                                            </label>
                                        ))}
                                    </div>
                                </div>

                                {/* Action Buttons */}
                                <div className='settings-actions'>
                                    <button className='btn-apply' onClick={applySettings}>
                                        ✓ {localize('Apply')}
                                    </button>
                                    <button className='btn-reset' onClick={resetSettings}>
                                        ↻ {localize('Reset')}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Main Content Area */}
                    <div className={`content-area ${showSettings ? 'with-sidebar' : ''}`}>
                        {/* Statistics Dashboard */}
                        <div className='stats-grid'>
                            <div className='stat-card primary'>
                                <div className='stat-icon'>💵</div>
                                <div className='stat-info'>
                                    <span className='stat-label'>{localize('Balance')}</span>
                                    <span className='stat-value'>{balance.toFixed(2)}</span>
                                </div>
                            </div>

                            <div className={`stat-card ${profit >= 0 ? 'positive' : 'negative'}`}>
                                <div className='stat-icon'>{profit >= 0 ? '📈' : '📉'}</div>
                                <div className='stat-info'>
                                    <span className='stat-label'>{localize('Total Profit')}</span>
                                    <span className='stat-value'>{profit >= 0 ? '+' : ''}{profit.toFixed(2)}</span>
                                </div>
                            </div>

                            <div className='stat-card info'>
                                <div className='stat-icon'>📊</div>
                                <div className='stat-info'>
                                    <span className='stat-label'>{localize('Trades')}</span>
                                    <span className='stat-value'>{stats.totalTrades}</span>
                                </div>
                            </div>

                            <div className='stat-card success'>
                                <div className='stat-icon'>✅</div>
                                <div className='stat-info'>
                                    <span className='stat-label'>{localize('Win Rate')}</span>
                                    <span className='stat-value'>{stats.winRate.toFixed(1)}%</span>
                                </div>
                            </div>

                            <div className='stat-card'>
                                <div className='stat-icon'>💰</div>
                                <div className='stat-info'>
                                    <span className='stat-label'>{localize('Current Stake')}</span>
                                    <span className='stat-value'>{currentStakeRef.current.toFixed(2)}</span>
                                </div>
                            </div>

                            <div className='stat-card'>
                                <div className='stat-icon'>🎯</div>
                                <div className='stat-info'>
                                    <span className='stat-label'>{localize('Multiplier')}</span>
                                    <span className='stat-value'>x{settings.martingaleMultiplier}</span>
                                </div>
                            </div>
                        </div>

                        {/* Market Analysis */}
                        {marketAnalysis && (
                            <div className='analysis-section'>
                                <h3>{localize('Market Analysis')}</h3>
                                <div className='analysis-grid'>
                                    <div className='analysis-card'>
                                        <span className='card-label'>{localize('Trend')}</span>
                                        <span className='card-value'>{marketAnalysis.trend === 'uptrend' ? '📈 Up' : '📉 Down'}</span>
                                    </div>
                                    <div className='analysis-card'>
                                        <span className='card-label'>{localize('RSI')}</span>
                                        <div className='rsi-bar'>
                                            <div className='rsi-value' style={{ width: `${Math.min(marketAnalysis.rsi, 100)}%` }}></div>
                                        </div>
                                        <span className='card-value text-right'>{marketAnalysis.rsi.toFixed(1)}</span>
                                    </div>
                                    <div className='analysis-card'>
                                        <span className='card-label'>{localize('Volatility')}</span>
                                        <span className='card-value'>{marketAnalysis.volatility.toFixed(4)}</span>
                                    </div>
                                    <div className='analysis-card'>
                                        <span className='card-label'>{localize('Momentum')}</span>
                                        <span className={`card-value ${marketAnalysis.momentum >= 0 ? 'positive' : 'negative'}`}>
                                            {marketAnalysis.momentum >= 0 ? '+' : ''}{marketAnalysis.momentum.toFixed(2)}%
                                        </span>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Trade History */}
                        <div className='history-section'>
                            <h3>{localize('Trade History')}</h3>
                            <div className='trade-history-container'>
                                {tradeHistory.length === 0 ? (
                                    <div className='empty-state'>
                                        <span className='empty-icon'>📭</span>
                                        <p>{localize('No trades yet. Start trading to see history.')}</p>
                                    </div>
                                ) : (
                                    <div className='trade-list'>
                                        {tradeHistory.slice().reverse().map((trade, idx) => (
                                            <div key={idx} className={`trade-row ${trade.result}`}>
                                                <div className='trade-main'>
                                                    <div className='trade-marker'>
                                                        {trade.isRecoveryTrade && <span className='recovery-badge'>Recovery</span>}
                                                        <span className='trade-type'>{trade.type}</span>
                                                    </div>
                                                    <div className='trade-details'>
                                                        <span className='trade-market'>{trade.market}</span>
                                                        <span className='trade-time'>
                                                            {new Date(trade.timestamp).toLocaleTimeString()}
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className='trade-outcome'>
                                                    <span className='trade-amount'>{trade.amount.toFixed(2)}</span>
                                                    <span className={`trade-result ${trade.result}`}>
                                                        {trade.result === 'pending' && '⏳'}
                                                        {trade.result === 'win' && `✅ +${trade.profit.toFixed(2)}`}
                                                        {trade.result === 'loss' && `❌ ${trade.profit.toFixed(2)}`}
                                                    </span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
});

export default AITrader;
