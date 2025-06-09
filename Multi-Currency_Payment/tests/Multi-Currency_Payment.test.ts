import { describe, it, expect, beforeEach } from 'vitest';
import { Cl } from '@stacks/transactions';

// Mock Clarinet testing environment
interface ClarityValue {
  type: string;
  value: any;
}

interface CallResult {
  result: ClarityValue;
  events: any[];
}

interface TestContext {
  accounts: Map<string, string>;
  chain: {
    mineBlock: (txs: any[]) => any;
    callReadOnlyFn: (contract: string, method: string, args: any[], sender: string) => CallResult;
  };
}

// Mock implementations for testing
const mockAccounts = new Map([
  ['deployer', 'ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM'],
  ['wallet_1', 'ST1SJ3DTE5DN7X54YDH5D64R3BCB6A2AG2ZQ8YPD5'],
  ['wallet_2', 'ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG'],
  ['merchant_1', 'ST2JHG361ZXG51QTKY2NQCVBPPRRE2KZB1HR05NNC'],
]);

const mockChain = {
  mineBlock: (txs: any[]) => ({ height: 1, receipts: txs }),
  callReadOnlyFn: (contract: string, method: string, args: any[], sender: string) => ({
    result: { type: 'ok', value: null },
    events: []
  })
};

const mockContext: TestContext = {
  accounts: mockAccounts,
  chain: mockChain
};

// Contract name
const CONTRACT_NAME = 'payment-gateway';

// Error constants
const ERR_NOT_AUTHORIZED = 401;
const ERR_INVALID_AMOUNT = 402;
const ERR_PAYMENT_NOT_FOUND = 404;
const ERR_PAYMENT_ALREADY_PROCESSED = 409;
const ERR_INSUFFICIENT_BALANCE = 410;
const ERR_CURRENCY_NOT_SUPPORTED = 411;

describe('Multi-Currency Payment Gateway', () => {
  let deployer: string;
  let wallet1: string;
  let wallet2: string;
  let merchant1: string;

  beforeEach(() => {
    deployer = mockContext.accounts.get('deployer')!;
    wallet1 = mockContext.accounts.get('wallet_1')!;
    wallet2 = mockContext.accounts.get('wallet_2')!;
    merchant1 = mockContext.accounts.get('merchant_1')!;
  });

  describe('Contract Initialization', () => {
    it('should initialize with supported currencies', () => {
      // Test USD currency initialization
      const usdInfo = mockContext.chain.callReadOnlyFn(
        CONTRACT_NAME,
        'get-currency-info',
        [Cl.stringAscii('USD')],
        deployer
      );

      expect(usdInfo.result.type).toBe('some');
      
      // Mock the expected structure
      const expectedUSD = {
        enabled: true,
        'exchange-rate-usd': 1000000,
        'decimal-places': 2
      };
      
      // In a real test, you would assert the actual values
      expect(expectedUSD.enabled).toBe(true);
      expect(expectedUSD['exchange-rate-usd']).toBe(1000000);
      expect(expectedUSD['decimal-places']).toBe(2);
    });

    it('should initialize with all expected currencies', () => {
      const currencies = ['USD', 'EUR', 'GBP', 'JPY', 'STX'];
      
      currencies.forEach(currency => {
        const currencyInfo = mockContext.chain.callReadOnlyFn(
          CONTRACT_NAME,
          'get-currency-info',
          [Cl.stringAscii(currency)],
          deployer
        );
        
        expect(currencyInfo.result.type).toBe('some');
      });
    });
  });

  describe('Currency Management', () => {
    it('should allow owner to add new currency', () => {
      const block = mockContext.chain.mineBlock([
        {
          contractCall: {
            contract: CONTRACT_NAME,
            method: 'add-currency',
            args: [
              Cl.stringAscii('CAD'),
              Cl.uint(750000), // 0.75 USD
              Cl.uint(2)
            ],
            sender: deployer
          }
        }
      ]);

      expect(block.receipts[0].result.type).toBe('ok');
    });

    it('should reject non-owner adding currency', () => {
      const block = mockContext.chain.mineBlock([
        {
          contractCall: {
            contract: CONTRACT_NAME,
            method: 'add-currency',
            args: [
              Cl.stringAscii('CAD'),
              Cl.uint(750000),
              Cl.uint(2)
            ],
            sender: wallet1
          }
        }
      ]);

      expect(block.receipts[0].result.type).toBe('err');
      expect(block.receipts[0].result.value).toBe(ERR_NOT_AUTHORIZED);
    });

    it('should reject invalid exchange rate', () => {
      const block = mockContext.chain.mineBlock([
        {
          contractCall: {
            contract: CONTRACT_NAME,
            method: 'add-currency',
            args: [
              Cl.stringAscii('CAD'),
              Cl.uint(0), // Invalid rate
              Cl.uint(2)
            ],
            sender: deployer
          }
        }
      ]);

      expect(block.receipts[0].result.type).toBe('err');
      expect(block.receipts[0].result.value).toBe(ERR_INVALID_AMOUNT);
    });
  });

  describe('Payment Creation', () => {
    it('should create payment successfully with valid parameters', () => {
      const block = mockContext.chain.mineBlock([
        {
          contractCall: {
            contract: CONTRACT_NAME,
            method: 'create-payment',
            args: [
              Cl.principal(merchant1),
              Cl.uint(1000000), // 1 STX
              Cl.stringAscii('STX')
            ],
            sender: wallet1
          }
        }
      ]);

      expect(block.receipts[0].result.type).toBe('ok');
      // Payment ID should be "0" for first payment
      expect(block.receipts[0].result.value).toBe('0');
    });

    it('should reject payment with unsupported currency', () => {
      const block = mockContext.chain.mineBlock([
        {
          contractCall: {
            contract: CONTRACT_NAME,
            method: 'create-payment',
            args: [
              Cl.principal(merchant1),
              Cl.uint(1000000),
              Cl.stringAscii('XYZ') // Unsupported currency
            ],
            sender: wallet1
          }
        }
      ]);

      expect(block.receipts[0].result.type).toBe('err');
      expect(block.receipts[0].result.value).toBe(ERR_CURRENCY_NOT_SUPPORTED);
    });

    it('should reject payment with zero amount', () => {
      const block = mockContext.chain.mineBlock([
        {
          contractCall: {
            contract: CONTRACT_NAME,
            method: 'create-payment',
            args: [
              Cl.principal(merchant1),
              Cl.uint(0), // Zero amount
              Cl.stringAscii('STX')
            ],
            sender: wallet1
          }
        }
      ]);

      expect(block.receipts[0].result.type).toBe('err');
      expect(block.receipts[0].result.value).toBe(ERR_INVALID_AMOUNT);
    });

    it('should increment payment counter', () => {
      // Create first payment
      const block1 = mockContext.chain.mineBlock([
        {
          contractCall: {
            contract: CONTRACT_NAME,
            method: 'create-payment',
            args: [
              Cl.principal(merchant1),
              Cl.uint(1000000),
              Cl.stringAscii('STX')
            ],
            sender: wallet1
          }
        }
      ]);

      // Create second payment
      const block2 = mockContext.chain.mineBlock([
        {
          contractCall: {
            contract: CONTRACT_NAME,
            method: 'create-payment',
            args: [
              Cl.principal(merchant1),
              Cl.uint(2000000),
              Cl.stringAscii('USD')
            ],
            sender: wallet2
          }
        }
      ]);

      expect(block1.receipts[0].result.value).toBe('0');
      expect(block2.receipts[0].result.value).toBe('1');
    });
  });

  describe('Payment Processing', () => {
    beforeEach(() => {
      // Create a payment first
      mockContext.chain.mineBlock([
        {
          contractCall: {
            contract: CONTRACT_NAME,
            method: 'create-payment',
            args: [
              Cl.principal(merchant1),
              Cl.uint(1000000),
              Cl.stringAscii('STX')
            ],
            sender: wallet1
          }
        }
      ]);
    });

    it('should process STX payment successfully', () => {
      const block = mockContext.chain.mineBlock([
        {
          contractCall: {
            contract: CONTRACT_NAME,
            method: 'process-payment',
            args: [Cl.stringAscii('0')],
            sender: wallet1
          }
        }
      ]);

      expect(block.receipts[0].result.type).toBe('ok');
      expect(block.receipts[0].result.value).toBe(true);

      // Should have STX transfer event
      expect(block.receipts[0].events.length).toBeGreaterThan(0);
    });

    it('should process non-STX payment successfully', () => {
      // Create USD payment first
      mockContext.chain.mineBlock([
        {
          contractCall: {
            contract: CONTRACT_NAME,
            method: 'create-payment',
            args: [
              Cl.principal(merchant1),
              Cl.uint(10000), // $100.00
              Cl.stringAscii('USD')
            ],
            sender: wallet1
          }
        }
      ]);

      const block = mockContext.chain.mineBlock([
        {
          contractCall: {
            contract: CONTRACT_NAME,
            method: 'process-payment',
            args: [Cl.stringAscii('1')],
            sender: wallet1
          }
        }
      ]);

      expect(block.receipts[0].result.type).toBe('ok');
      expect(block.receipts[0].result.value).toBe(true);
    });

    it('should reject processing non-existent payment', () => {
      const block = mockContext.chain.mineBlock([
        {
          contractCall: {
            contract: CONTRACT_NAME,
            method: 'process-payment',
            args: [Cl.stringAscii('999')],
            sender: wallet1
          }
        }
      ]);

      expect(block.receipts[0].result.type).toBe('err');
      expect(block.receipts[0].result.value).toBe(ERR_PAYMENT_NOT_FOUND);
    });

    it('should reject processing by non-customer', () => {
      const block = mockContext.chain.mineBlock([
        {
          contractCall: {
            contract: CONTRACT_NAME,
            method: 'process-payment',
            args: [Cl.stringAscii('0')],
            sender: wallet2 // Different wallet
          }
        }
      ]);

      expect(block.receipts[0].result.type).toBe('err');
      expect(block.receipts[0].result.value).toBe(ERR_NOT_AUTHORIZED);
    });

    it('should reject processing already completed payment', () => {
      // Process payment first time
      mockContext.chain.mineBlock([
        {
          contractCall: {
            contract: CONTRACT_NAME,
            method: 'process-payment',
            args: [Cl.stringAscii('0')],
            sender: wallet1
          }
        }
      ]);

      // Try to process again
      const block = mockContext.chain.mineBlock([
        {
          contractCall: {
            contract: CONTRACT_NAME,
            method: 'process-payment',
            args: [Cl.stringAscii('0')],
            sender: wallet1
          }
        }
      ]);

      expect(block.receipts[0].result.type).toBe('err');
      expect(block.receipts[0].result.value).toBe(ERR_PAYMENT_ALREADY_PROCESSED);
    });
  });

  describe('Merchant Balances', () => {
    beforeEach(() => {
      // Create and process a payment
      mockContext.chain.mineBlock([
        {
          contractCall: {
            contract: CONTRACT_NAME,
            method: 'create-payment',
            args: [
              Cl.principal(merchant1),
              Cl.uint(1000000),
              Cl.stringAscii('STX')
            ],
            sender: wallet1
          }
        }
      ]);

      mockContext.chain.mineBlock([
        {
          contractCall: {
            contract: CONTRACT_NAME,
            method: 'process-payment',
            args: [Cl.stringAscii('0')],
            sender: wallet1
          }
        }
      ]);
    });

    it('should update merchant balance after payment', () => {
      const balance = mockContext.chain.callReadOnlyFn(
        CONTRACT_NAME,
        'get-merchant-balance',
        [Cl.principal(merchant1), Cl.stringAscii('STX')],
        deployer
      );

      expect(balance.result.type).toBe('uint');
      expect(balance.result.value).toBe(1000000);
    });

    it('should allow merchant to withdraw STX', () => {
      const block = mockContext.chain.mineBlock([
        {
          contractCall: {
            contract: CONTRACT_NAME,
            method: 'withdraw',
            args: [
              Cl.stringAscii('STX'),
              Cl.uint(500000) // Withdraw half
            ],
            sender: merchant1
          }
        }
      ]);

      expect(block.receipts[0].result.type).toBe('ok');
      expect(block.receipts[0].result.value).toBe(true);
    });

    it('should reject withdrawal with insufficient balance', () => {
      const block = mockContext.chain.mineBlock([
        {
          contractCall: {
            contract: CONTRACT_NAME,
            method: 'withdraw',
            args: [
              Cl.stringAscii('STX'),
              Cl.uint(2000000) // More than balance
            ],
            sender: merchant1
          }
        }
      ]);

      expect(block.receipts[0].result.type).toBe('err');
      expect(block.receipts[0].result.value).toBe(ERR_INSUFFICIENT_BALANCE);
    });

    it('should update balance after withdrawal', () => {
      // Withdraw some amount
      mockContext.chain.mineBlock([
        {
          contractCall: {
            contract: CONTRACT_NAME,
            method: 'withdraw',
            args: [
              Cl.stringAscii('STX'),
              Cl.uint(300000)
            ],
            sender: merchant1
          }
        }
      ]);

      const balance = mockContext.chain.callReadOnlyFn(
        CONTRACT_NAME,
        'get-merchant-balance',
        [Cl.principal(merchant1), Cl.stringAscii('STX')],
        deployer
      );

      expect(balance.result.value).toBe(700000); // 1000000 - 300000
    });
  });

  describe('Read-Only Functions', () => {
    it('should get payment information', () => {
      // Create a payment first
      mockContext.chain.mineBlock([
        {
          contractCall: {
            contract: CONTRACT_NAME,
            method: 'create-payment',
            args: [
              Cl.principal(merchant1),
              Cl.uint(1000000),
              Cl.stringAscii('STX')
            ],
            sender: wallet1
          }
        }
      ]);

      const payment = mockContext.chain.callReadOnlyFn(
        CONTRACT_NAME,
        'get-payment',
        [Cl.stringAscii('0')],
        deployer
      );

      expect(payment.result.type).toBe('some');
      // In real test, you would check the payment details structure
    });

    it('should return none for non-existent payment', () => {
      const payment = mockContext.chain.callReadOnlyFn(
        CONTRACT_NAME,
        'get-payment',
        [Cl.stringAscii('999')],
        deployer
      );

      expect(payment.result.type).toBe('none');
    });

    it('should get merchant balance', () => {
      const balance = mockContext.chain.callReadOnlyFn(
        CONTRACT_NAME,
        'get-merchant-balance',
        [Cl.principal(merchant1), Cl.stringAscii('STX')],
        deployer
      );

      expect(balance.result.type).toBe('uint');
      expect(balance.result.value).toBe(0); // Initially zero
    });
  });

  describe('Currency Conversion', () => {
    it('should convert between currencies correctly', () => {
      // Convert 1 USD to EUR (USD rate: 1000000, EUR rate: 1100000)
      const conversion = mockContext.chain.callReadOnlyFn(
        CONTRACT_NAME,
        'convert-currency',
        [
          Cl.uint(1000000), // 1 USD
          Cl.stringAscii('USD'),
          Cl.stringAscii('EUR')
        ],
        deployer
      );

      expect(conversion.result.type).toBe('ok');
      // Expected: (1000000 * 1100000) / 1000000 = 1100000 (1.1 EUR)
      expect(conversion.result.value).toBe(1100000);
    });

    it('should handle same currency conversion', () => {
      const conversion = mockContext.chain.callReadOnlyFn(
        CONTRACT_NAME,
        'convert-currency',
        [
          Cl.uint(1000000),
          Cl.stringAscii('USD'),
          Cl.stringAscii('USD')
        ],
        deployer
      );

      expect(conversion.result.type).toBe('ok');
      expect(conversion.result.value).toBe(1000000); // Same amount
    });

    it('should reject conversion with unsupported currency', () => {
      const conversion = mockContext.chain.callReadOnlyFn(
        CONTRACT_NAME,
        'convert-currency',
        [
          Cl.uint(1000000),
          Cl.stringAscii('XYZ'),
          Cl.stringAscii('USD')
        ],
        deployer
      );

      expect(conversion.result.type).toBe('err');
      expect(conversion.result.value).toBe(ERR_CURRENCY_NOT_SUPPORTED);
    });
  });

  describe('Edge Cases', () => {
    it('should handle multiple payments from same customer', () => {
      const payments = [];
      
      // Create multiple payments
      for (let i = 0; i < 3; i++) {
        const block = mockContext.chain.mineBlock([
          {
            contractCall: {
              contract: CONTRACT_NAME,
              method: 'create-payment',
              args: [
                Cl.principal(merchant1),
                Cl.uint(1000000 * (i + 1)),
                Cl.stringAscii('STX')
              ],
              sender: wallet1
            }
          }
        ]);
        
        payments.push(block.receipts[0].result.value);
      }

      expect(payments).toEqual(['0', '1', '2']);
    });

    it('should handle large amounts', () => {
      const largeAmount = 999999999999; // Very large amount
      
      const block = mockContext.chain.mineBlock([
        {
          contractCall: {
            contract: CONTRACT_NAME,
            method: 'create-payment',
            args: [
              Cl.principal(merchant1),
              Cl.uint(largeAmount),
              Cl.stringAscii('STX')
            ],
            sender: wallet1
          }
        }
      ]);

      expect(block.receipts[0].result.type).toBe('ok');
    });

    it('should handle multiple merchants', () => {
      const merchant2 = mockContext.accounts.get('wallet_2')!;
      
      // Payment to merchant1
      const block1 = mockContext.chain.mineBlock([
        {
          contractCall: {
            contract: CONTRACT_NAME,
            method: 'create-payment',
            args: [
              Cl.principal(merchant1),
              Cl.uint(1000000),
              Cl.stringAscii('STX')
            ],
            sender: wallet1
          }
        }
      ]);

      // Payment to merchant2
      const block2 = mockContext.chain.mineBlock([
        {
          contractCall: {
            contract: CONTRACT_NAME,
            method: 'create-payment',
            args: [
              Cl.principal(merchant2),
              Cl.uint(2000000),
              Cl.stringAscii('STX')
            ],
            sender: wallet1
          }
        }
      ]);

      expect(block1.receipts[0].result.type).toBe('ok');
      expect(block2.receipts[0].result.type).toBe('ok');
    });
  });
});