'use strict';

class CustomerCache {
  constructor(ttlMs) {
    this.ttlMs = ttlMs;
    this.entries = new Map();
  }

  get(orgid) {
    const entry = this.entries.get(orgid);
    if (!entry) return null;

    if (Date.now() >= entry.expiresAt) {
      this.entries.delete(orgid);
      return null;
    }

    return entry.value;
  }

  set(orgid, value) {
    this.entries.set(orgid, {
      value,
      expiresAt: Date.now() + this.ttlMs
    });
  }

  delete(orgid) {
    return this.entries.delete(orgid);
  }
}

module.exports = { CustomerCache };
