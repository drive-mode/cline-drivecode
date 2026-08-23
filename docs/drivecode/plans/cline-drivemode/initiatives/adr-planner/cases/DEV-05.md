# DEV-05 · Public API replacement

**Status:** frozen development brief
**Benchmark version:** `m0.1`
**Permitted source refs:** none; this brief is the complete evaluator input

## Brief

A six-engineer product team owns an internal order-status HTTP endpoint used by
three company services. The team must launch a supported API for external
logistics partners in 90 days while keeping existing internal consumers
working for at least six months. The current endpoint returns PostgreSQL order
and shipment data, deploys several times per week, and has an incomplete
OpenAPI document. One downstream owner is known; the other consumer owners and
their exact usage are not documented.

The public API will expose customer order identifiers, fulfillment state, and
estimated delivery dates, but not payment card data. Partners expect a stable
contract and advance notice of breaking changes. Authentication, authorization,
rate limits, pagination, error semantics, compatibility policy, support hours,
service objectives, migration evidence, and deprecation ownership are
unspecified. The business has committed to a design-partner integration before
general availability.

