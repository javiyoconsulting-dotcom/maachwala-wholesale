'use strict';

function createCustomerService(repository, cache) {
  return {
    async getCustomers(orgid, { refresh = false } = {}) {
      if (!refresh) {
        const cached = cache.get(orgid);
        if (cached !== null) {
          return { customers: cached, cacheStatus: 'HIT' };
        }
      }

      const customers = await repository.findAll(orgid);
      cache.set(orgid, customers);
      return { customers, cacheStatus: refresh ? 'REFRESH' : 'MISS' };
    },

    clearCustomers(orgid) {
      cache.delete(orgid);
    },

    async createCustomers(orgid, customers) {
      const created = await repository.createMany(orgid, customers);
      cache.delete(orgid);
      return created;
    }
  };
}

module.exports = { createCustomerService };
