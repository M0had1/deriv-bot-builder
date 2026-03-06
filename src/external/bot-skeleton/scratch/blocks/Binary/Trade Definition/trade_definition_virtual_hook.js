/**
 * Virtual Hook Protection Block
 * 
 * Allows users to enable virtual trading mode that activates after real trading losses.
 * When enabled, losing real trades trigger virtual (demo) mode until a virtual win is achieved.
 * After a virtual win, the bot returns to real trading with increased stakes (martingale).
 */

import { localize } from '@deriv-com/translations';

window.Blockly.Blocks.trade_definition_virtual_hook = {
    init() {
        this.jsonInit(this.definition());
        this.setNextStatement(false);
    },
    definition() {
        return {
            message0: localize('Virtual Hook Protection'),
            message1: localize('Enable: %1'),
            message2: localize('Martingale Multiplier: %1'),
            args1: [
                {
                    type: 'field_checkbox',
                    name: 'ENABLED',
                    checked: false,
                },
            ],
            args2: [
                {
                    type: 'input_value',
                    name: 'MARTINGALE_MULTIPLIER',
                    check: 'Number',
                },
            ],
            inputsInline: false,
            colour: window.Blockly.Colours.Special1.colour,
            colourSecondary: window.Blockly.Colours.Special1.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special1.colourTertiary,
            previousStatement: null,
            nextStatement: null,
            tooltip: localize(
                'Enable virtual trading mode: if a real trade loses, the next trade will be virtual (demo). When a virtual trade wins, switch back to real with increased stake.'
            ),
            category: window.Blockly.Categories.Trade_Definition,
        };
    },
    meta() {
        return {
            display_name: localize('Virtual Hook Protection'),
            description: localize(
                'Enable virtual trading protection. After a real loss, trades switch to virtual mode. Returns to real trading with increased stake after a virtual win.'
            ),
        };
    },
    restricted_parents: ['trade_definition'],
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.trade_definition_virtual_hook = block => {
    // This block doesn't generate code by itself
    // Instead, its configuration is extracted by the parent trade option block
    return '';
};
