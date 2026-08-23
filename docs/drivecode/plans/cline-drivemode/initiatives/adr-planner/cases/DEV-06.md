# DEV-06 · Event-driven fulfillment pipeline

**Status:** frozen development brief
**Benchmark version:** `m0.1`
**Permitted source refs:** none; this brief is the complete evaluator input

## Brief

A five-engineer commerce team is replacing a synchronous order-fulfillment
call that frequently times out. The replacement receives checkout events from
an existing broker and coordinates inventory reservation, payment capture, a
warehouse system, customer notifications, and refunds. Broker delivery is at
least once; duplicate and out-of-order events have occurred in production.
Inventory and payment operations can each succeed while the other fails.

Normal traffic is 300 orders per minute and promotions can reach 5,000 per
minute. Operations currently reconciles failures manually from database rows.
The first production pilot is planned in eight weeks. Event ownership,
partitioning, ordering scope, idempotency keys, retry limits, dead-letter and
replay behavior, schema evolution, reconciliation authority, retention,
service objectives, observability, and rollback are unspecified. Existing
orders cannot be lost or charged twice during migration.

