;; Multi-Currency Payment Gateway Smart Contract
;; Handles international payments with multiple currencies

;; Error codes
(define-constant ERR-NOT-AUTHORIZED (err u401))
(define-constant ERR-INVALID-AMOUNT (err u402))
(define-constant ERR-PAYMENT-NOT-FOUND (err u404))
(define-constant ERR-PAYMENT-ALREADY-PROCESSED (err u409))
(define-constant ERR-INSUFFICIENT-BALANCE (err u410))
(define-constant ERR-CURRENCY-NOT-SUPPORTED (err u411))

;; Contract owner
(define-constant CONTRACT-OWNER tx-sender)

;; Supported currencies with their codes
(define-map supported-currencies 
  { currency-code: (string-ascii 3) }
  { 
    enabled: bool,
    exchange-rate-usd: uint,  ;; Rate in micro-units (1 USD = 1000000)
    decimal-places: uint
  }
)

;; Payment records
(define-map payments
  { payment-id: (string-ascii 64) }
  {
    merchant-id: principal,
    customer-id: principal,
    amount: uint,
    currency: (string-ascii 3),
    status: (string-ascii 20),
    payment-counter: uint,
    transaction-ref: (optional uint)
  }
)

;; Merchant balances by currency
(define-map merchant-balances
  { merchant: principal, currency: (string-ascii 3) }
  { balance: uint }
)

;; Payment counter for generating unique IDs
(define-data-var payment-counter uint u0)

;; Initialize supported currencies
(define-private (init-currencies)
  (begin
    (map-set supported-currencies { currency-code: "USD" } 
      { enabled: true, exchange-rate-usd: u1000000, decimal-places: u2 })
    (map-set supported-currencies { currency-code: "EUR" } 
      { enabled: true, exchange-rate-usd: u1100000, decimal-places: u2 })
    (map-set supported-currencies { currency-code: "GBP" } 
      { enabled: true, exchange-rate-usd: u1250000, decimal-places: u2 })
    (map-set supported-currencies { currency-code: "JPY" } 
      { enabled: true, exchange-rate-usd: u7500, decimal-places: u0 })
    (map-set supported-currencies { currency-code: "STX" } 
      { enabled: true, exchange-rate-usd: u500000, decimal-places: u6 })
  )
)
;; Initialize the contract
(init-currencies)

;; Add or update supported currency (owner only)
(define-public (add-currency (currency-code (string-ascii 3)) (exchange-rate uint) (decimal-places uint))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-NOT-AUTHORIZED)
    (asserts! (> exchange-rate u0) ERR-INVALID-AMOUNT)
    (ok (map-set supported-currencies 
      { currency-code: currency-code }
      { enabled: true, exchange-rate-usd: exchange-rate, decimal-places: decimal-places }
    ))
  )
)

;; Create a new payment
(define-public (create-payment 
  (merchant principal)
  (amount uint)
  (currency (string-ascii 3))
)
  (let 
    (
      (current-counter (var-get payment-counter))
      (payment-id (int-to-ascii current-counter))
      (currency-info (map-get? supported-currencies { currency-code: currency }))
    )
    (asserts! (is-some currency-info) ERR-CURRENCY-NOT-SUPPORTED)
    (asserts! (get enabled (unwrap-panic currency-info)) ERR-CURRENCY-NOT-SUPPORTED)
    (asserts! (> amount u0) ERR-INVALID-AMOUNT)
    
    (map-set payments
      { payment-id: payment-id }
      {
        merchant-id: merchant,
        customer-id: tx-sender,
        amount: amount,
        currency: currency,
        status: "pending",
        payment-counter: current-counter,
        transaction-ref: none
      }
    )
    
    (var-set payment-counter (+ current-counter u1))
    (ok payment-id)
  )
)
;; Process payment (in STX for simplicity, real implementation would handle multiple currencies)
(define-public (process-payment (payment-id (string-ascii 64)))
  (let 
    (
      (payment-info (map-get? payments { payment-id: payment-id }))
      (payment (unwrap! payment-info ERR-PAYMENT-NOT-FOUND))
    )
    (asserts! (is-eq (get status payment) "pending") ERR-PAYMENT-ALREADY-PROCESSED)
    (asserts! (is-eq tx-sender (get customer-id payment)) ERR-NOT-AUTHORIZED)
    
    ;; For STX payments, transfer the amount
    (if (is-eq (get currency payment) "STX")
      (begin
        (try! (stx-transfer? (get amount payment) tx-sender (get merchant-id payment)))
        (update-merchant-balance (get merchant-id payment) (get currency payment) (get amount payment))
        (map-set payments
          { payment-id: payment-id }
          (merge payment { 
            status: "completed", 
            transaction-ref: (some (get payment-counter payment))
          })
        )
        (ok true)
      )
      ;; For other currencies, mark as completed (external processing required)
      (begin
        (update-merchant-balance (get merchant-id payment) (get currency payment) (get amount payment))
        (map-set payments
          { payment-id: payment-id }
          (merge payment { 
            status: "completed"
          })
        )
        (ok true)
      )
    )
  )
)

;; Update merchant balance
(define-private (update-merchant-balance (merchant principal) (currency (string-ascii 3)) (amount uint))
  (let 
    (
      (current-balance (default-to u0 (get balance (map-get? merchant-balances { merchant: merchant, currency: currency }))))
    )
    (map-set merchant-balances
      { merchant: merchant, currency: currency }
      { balance: (+ current-balance amount) }
    )
  )
)

;; Merchant withdrawal
(define-public (withdraw (currency (string-ascii 3)) (amount uint))
  (let 
    (
      (current-balance (default-to u0 (get balance (map-get? merchant-balances { merchant: tx-sender, currency: currency }))))
    )
    (asserts! (>= current-balance amount) ERR-INSUFFICIENT-BALANCE)
    
    (if (is-eq currency "STX")
      (begin
        (try! (stx-transfer? amount (as-contract tx-sender) tx-sender))
        (map-set merchant-balances
          { merchant: tx-sender, currency: currency }
          { balance: (- current-balance amount) }
        )
        (ok true)
      )
      ;; For other currencies, just update balance (external processing required)
      (begin
        (map-set merchant-balances
          { merchant: tx-sender, currency: currency }
          { balance: (- current-balance amount) }
        )
        (ok true)
      )
    )
  )
)

;; Get payment information
(define-read-only (get-payment (payment-id (string-ascii 64)))
  (map-get? payments { payment-id: payment-id })
)

;; Get merchant balance
(define-read-only (get-merchant-balance (merchant principal) (currency (string-ascii 3)))
  (default-to u0 (get balance (map-get? merchant-balances { merchant: merchant, currency: currency })))
)

;; Get supported currencies
(define-read-only (get-currency-info (currency-code (string-ascii 3)))
  (map-get? supported-currencies { currency-code: currency-code })
)

;; Convert amount between currencies using exchange rates
(define-read-only (convert-currency 
  (amount uint) 
  (from-currency (string-ascii 3)) 
  (to-currency (string-ascii 3))
)
  (let 
    (
      (from-rate (get exchange-rate-usd (unwrap! (map-get? supported-currencies { currency-code: from-currency }) ERR-CURRENCY-NOT-SUPPORTED)))
      (to-rate (get exchange-rate-usd (unwrap! (map-get? supported-currencies { currency-code: to-currency }) ERR-CURRENCY-NOT-SUPPORTED)))
    )
    (ok (/ (* amount to-rate) from-rate))
  )
)