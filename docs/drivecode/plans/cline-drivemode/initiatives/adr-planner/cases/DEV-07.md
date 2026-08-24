# DEV-07 · Offline-first field service

**Status:** frozen development brief
**Benchmark version:** `m0.1`
**Permitted source refs:** none; this brief is the complete evaluator input

## Brief

A field-service company wants a mobile application for 2,000 technicians who
may work without connectivity for up to 72 hours. Technicians must view and
update work orders, customer contact details, equipment notes, photos, and
customer signatures. Dispatchers can edit the same work orders while a device
is offline. The existing backend API assumes continuous connectivity and has
no synchronization protocol.

The company expects an Android and iOS pilot with 50 technicians in four
months. Some devices are corporate managed and some are personally owned.
Authentication while offline, local encryption, conflict semantics, attachment
limits, synchronization ordering, retry and deduplication, device loss and
remote revocation, audit history, data retention, regional constraints,
support ownership, and recovery from incompatible app versions are
unspecified. A delayed synchronization must not silently discard a technician's
completed work or overwrite a dispatcher's safety-critical update.

