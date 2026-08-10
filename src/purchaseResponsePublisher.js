'use strict';

function createPurchaseResponsePublisher(pubsub, topicName) {
  const topic = pubsub.topic(topicName);

  return {
    async publish(payload) {
      return topic.publishMessage({
        data: Buffer.from(JSON.stringify(payload), 'utf8'),
        attributes: {
          eventType: 'UPDATE_PURCHASE_SALES_RESPONSE',
          purchaseNumber: String(payload.purchaseNumber)
        }
      });
    }
  };
}

module.exports = { createPurchaseResponsePublisher };
