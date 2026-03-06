/**
 * Virtual Hook Manager - Singleton service for managing real/virtual trading mode switching
 * 
 * Purpose: When a real trade results in a loss, the bot switches to virtual (demo) trading.
 * When a virtual trade results in a win, the bot returns to real trading with a martingale multiplier applied.
 * 
 * This provides protection against catastrophic losses while allowing recovery with increased stakes.
 */

class VirtualHookManager {
    constructor() {
        this.is_enabled = false;
        this.is_virtual_mode = false;
        this.martingale_multiplier = 2;
        this.virtual_win_count = 0;
        this.real_loss_count = 0;
        this.mode_change_listeners = [];
    }

    /**
     * Initialize virtual hook with configuration
     * @param {Object} config - Configuration object
     * @param {boolean} config.enabled - Whether virtual hook is enabled
     * @param {number} config.martingale_multiplier - Stake multiplier when returning to real mode
     */
    initialize(config = {}) {
        this.is_enabled = config.enabled || false;
        this.martingale_multiplier = config.martingale_multiplier || 2;
        this.is_virtual_mode = false;
        this.virtual_win_count = 0;
        this.real_loss_count = 0;
    }

    /**
     * Handle trade result and update mode if necessary
     * @param {string} result - Trade result: 'win' or 'loss'
     * @param {number} stake - The stake amount for tracking
     * @returns {Object} Update information with mode_changed, action, and counts
     */
    handleTradeResult(result, stake) {
        if (!this.is_enabled) {
            return {
                mode_changed: false,
                action: 'virtual_hook_disabled',
            };
        }

        let mode_changed = false;
        let action = null;
        let new_mode = this.is_virtual_mode ? 'virtual' : 'real';

        if (this.is_virtual_mode) {
            // In virtual mode
            if (result === 'win') {
                // Winner in virtual mode - switch back to real
                mode_changed = true;
                action = 'switched_to_real_with_martingale';
                this.is_virtual_mode = false;
                this.virtual_win_count += 1;
                new_mode = 'real';

                // Emit mode change event
                this._emitModeChange({
                    from_mode: 'virtual',
                    to_mode: 'real',
                    action: action,
                    timestamp: Date.now(),
                    martingale_multiplier: this.martingale_multiplier,
                });
            } else {
                // Loss in virtual mode - stay virtual
                action = 'virtual_loss_continue_virtual';
            }
        } else {
            // In real mode
            if (result === 'loss') {
                // Loser in real mode - switch to virtual
                mode_changed = true;
                action = 'switched_to_virtual';
                this.is_virtual_mode = true;
                this.real_loss_count += 1;
                new_mode = 'virtual';

                // Emit mode change event
                this._emitModeChange({
                    from_mode: 'real',
                    to_mode: 'virtual',
                    action: action,
                    timestamp: Date.now(),
                });
            } else {
                // Win in real mode - stay real
                action = 'real_win_continue_real';
            }
        }

        return {
            mode_changed,
            new_mode,
            action,
            virtual_win_count: this.virtual_win_count,
            real_loss_count: this.real_loss_count,
        };
    }

    /**
     * Get current trading mode
     * @returns {string} 'real' or 'virtual'
     */
    getTradingMode() {
        return this.is_virtual_mode ? 'virtual' : 'real';
    }

    /**
     * Check if currently in virtual mode
     * @returns {boolean}
     */
    isVirtualMode() {
        return this.is_virtual_mode;
    }

    /**
     * Get complete state
     * @returns {Object} Complete state object
     */
    getState() {
        return {
            enabled: this.is_enabled,
            is_virtual_mode: this.is_virtual_mode,
            martingale_multiplier: this.martingale_multiplier,
            virtual_win_count: this.virtual_win_count,
            real_loss_count: this.real_loss_count,
            trading_mode: this.getTradingMode(),
        };
    }

    /**
     * Reset virtual hook state
     */
    reset() {
        this.is_virtual_mode = false;
        this.virtual_win_count = 0;
        this.real_loss_count = 0;
    }

    /**
     * Subscribe to mode change events
     * @param {Function} callback - Callback function to call on mode change
     */
    onModeChange(callback) {
        if (typeof callback === 'function') {
            this.mode_change_listeners.push(callback);
        }
    }

    /**
     * Emit mode change event to all listeners
     * @private
     */
    _emitModeChange(event) {
        this.mode_change_listeners.forEach(callback => {
            try {
                callback(event);
            } catch (error) {
                console.error('[Virtual Hook] Error in mode change listener:', error);
            }
        });
    }
}

// Export singleton instance
export default new VirtualHookManager();
