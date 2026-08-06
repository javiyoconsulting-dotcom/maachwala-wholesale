'use strict';

function createBuyerAllocationDistributionPublisher(pubsub, topicName) {
  const topic = pubsub.topic(topicName);

  return {
    async publish(payload) {
      return topic.publishMessage({
        data: Buffer.from(JSON.stringify(payload), 'utf8'),
        attributes: {
          eventType: 'BUYER_ALLOCATION_DISTRIBUTION',
          orgid: String(payload.orgid),
          purchaseDate: payload.purchaseDate
        }
      });
    }
  };
}

module.exports = { createBuyerAllocationDistributionPublisher };
