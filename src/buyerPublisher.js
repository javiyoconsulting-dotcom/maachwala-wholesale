'use strict';

function createBuyerPublisher(pubsub, topicName) {
  const topic = pubsub.topic(topicName);

  return {
    async publish(payload) {
      return topic.publishMessage({
        data: Buffer.from(JSON.stringify(payload), 'utf8'),
        attributes: {
          eventType: 'WHOLESALE_CREATE_SALE_PURCHASE',
          orgid: payload.orgid,
          purchaseDate: payload.purchaseDate
        }
      });
    }
  };
}

module.exports = { createBuyerPublisher };
