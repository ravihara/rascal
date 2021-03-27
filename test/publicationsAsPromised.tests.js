const assert = require('assert');
const _ = require('lodash');
const amqplib = require('amqplib/callback_api');
const testConfig = require('../lib/config/tests');
const format = require('util').format;
const uuid = require('uuid').v4;
const BrokerAsPromised = require('..').BrokerAsPromised;
const AmqpUtils = require('./utils/amqputils');

describe('Publications As Promised', () => {

  let broker;
  let amqputils;
  let namespace;
  let vhosts;

  beforeEach((test, done) => {

    namespace = uuid();

    vhosts = {
      '/': {
        namespace,
        exchanges: {
          e1: {
            assert: true,
          },
          e2: {
            assert: true,
          },
          xx: {
            assert: true,
          },
        },
        queues: {
          q1: {
            assert: true,
          },
          q2: {
            assert: true,
          },
        },
        bindings: {
          b1: {
            source: 'e1',
            destination: 'q1',
          },
          b2: {
            source: 'e2',
            destination: 'q2',
          },
        },
      },
    };

    amqplib.connect((err, connection) => {
      if (err) return done(err);
      amqputils = AmqpUtils.init(connection);
      done();
    });
  });

  afterEach((test, done) => {
    amqputils.disconnect(() => {
      if (broker) return broker.nuke().catch(done).then(done);
      done();
    });
  });

  it('should report unknown publications', () => {
    return createBroker({
      vhosts,
      publications: {
        p1: {
          exchange: 'e1',
        },
      },
    }).then((broker) => {
      return broker.publish('does-not-exist', 'test message').catch((err) => {
        assert.ok(err);
        assert.strictEqual(err.message, 'Unknown publication: does-not-exist');
      });
    });
  });

  it('should report deprecated publications', (test, done) => {
    createBroker({
      vhosts,
      publications: {
        p1: {
          exchange: 'e1',
          deprecated: true,
        },
      },
    }).then((broker) => {
      broker.publish('p1', 'test message').then((publication) => {
        publication.on('success', () => {
          amqputils.assertMessage('q1', namespace, 'test message', done);
        });
      });
    });
  });

  it('should publish text messages to normal exchanges', (test, done) => {
    createBroker({
      vhosts,
      publications: {
        p1: {
          exchange: 'e1',
          confirm: false,
        },
      },
    }).then((broker) => {
      broker.publish('p1', 'test message').then((publication) => {
        publication.on('success', () => {
          amqputils.assertMessage('q1', namespace, 'test message', done);
        });
      });
    });
  });

  it('should publish text messages using confirm channels to exchanges', (test, done) => {
    createBroker({
      vhosts,
      publications: {
        p1: {
          exchange: 'e1',
          confirm: true,
        },
      },
    }).then((broker) => {
      broker.publish('p1', 'test message').then((publication) => {
        publication.on('success', () => {
          amqputils.assertMessage('q1', namespace, 'test message', done);
        });
      });
    });
  });

  it('should publish text messages to queues', (test, done) => {
    createBroker({
      vhosts,
      publications: {
        p1: {
          queue: 'q1',
        },
      },
    }).then((broker) => {
      broker.publish('p1', 'test message').then((publication) => {
        publication.on('success', () => {
          amqputils.assertMessage('q1', namespace, 'test message', done);
        });
      });
    });
  });

  it('should decorate the message with a uuid', (test, done) => {
    createBroker({
      vhosts,
      publications: {
        p1: {
          exchange: 'e1',
        },
      },
    }).then((broker) => {
      broker.publish('p1', 'test message').then((publication) => {
        publication.on('success', (messageId) => {
          assert.ok(/\w+-\w+-\w+-\w+-\w+/.test(messageId), format('%s failed to match expected pattern', messageId));

          amqputils.getMessage('q1', namespace, (err, message) => {
            assert.ifError(err);
            assert.ok(message);
            assert.strictEqual(messageId, message.properties.messageId);
            done();
          });
        });
      });
    });
  });

  it('should publish to using confirm channels to queues', (test, done) => {
    createBroker({
      vhosts,
      publications: {
        p1: {
          queue: 'q1',
          confirm: true,
        },
      },
    }).then((broker) => {
      broker.publish('p1', 'test message').then((publication) => {
        publication.on('success', () => {
          amqputils.assertMessage('q1', namespace, 'test message', done);
        });
      });
    });
  });

  it('should publish json messages to normal exchanges', (test, done) => {
    createBroker({
      vhosts,
      publications: {
        p1: {
          exchange: 'e1',
        },
      },
    }).then((broker) => {
      broker.publish('p1', { message: 'test message' }).then((publication) => {
        publication.on('success', () => {
          amqputils.assertMessage('q1', namespace, JSON.stringify({ message: 'test message' }), done);
        });
      });
    });
  });

  it('should publish messages with custom contentType to normal exchanges', (test, done) => {
    createBroker({
      vhosts,
      publications: {
        p1: {
          exchange: 'e1',
        },
      },
    }).then((broker) => {
      broker.publish('p1', { message: 'test message' }, { options: { contentType: 'application/vnd+custom.contentType.v1' } }).then((publication) => {
        publication.on('success', () => {
          amqputils.getMessage('q1', namespace, (err, message) => {
            assert.ifError(err);
            assert.ok(message, 'Message was not present');
            assert.strictEqual(message.properties.contentType, 'application/vnd+custom.contentType.v1');
            assert.strictEqual(message.content.toString(), JSON.stringify({ message: 'test message' }));
            done();
          });
        });
      });
    });
  });

  it('should publish buffer messages to normal exchanges', (test, done) => {
    createBroker({
      vhosts,
      publications: {
        p1: {
          exchange: 'e1',
        },
      },
    }).then((broker) => {
      broker.publish('p1', Buffer.from('test message')).then((publication) => {
        publication.on('success', () => {
          amqputils.assertMessage('q1', namespace, 'test message', done);
        });
      });
    });
  });

  it('should allow publish overrides', (test, done) => {
    createBroker({
      vhosts,
      publications: {
        p1: {
          queue: 'q1',
        },
      },
    }).then((broker) => {
      broker.publish('p1', 'test message', { options: { expiration: 1 } }).then((publication) => {
        publication.on('success', () => {
          setTimeout(() => {
            amqputils.assertMessageAbsent('q1', namespace, done);
          }, 100);
        });
      });
    });
  });

  it('should report unrouted messages', (test, done) => {
    createBroker({
      vhosts,
      publications: {
        p1: {
          exchange: 'xx',
        },
      },
    }).then((broker) => {
      broker.publish('p1', 'test message', { options: { expiration: 1 } }).then((publication) => {
        publication.on('return', (message) => {
          assert.ok(message);
          done();
        });
      });
    });
  });

  it('should forward messages to publications', (test, done) => {
    createBroker({
      vhosts,
      publications: {
        p1: {
          exchange: 'e1',
          routingKey: 'rk1',
        },
        p2: {
          exchange: 'e2',
          routingKey: 'rk2',
        },
      },
      subscriptions: {
        s1: {
          vhost: '/',
          queue: 'q1',
        },
      },
    }).then((broker) => {

      let messageId;

      broker.subscribe('s1').then((subscription) => {

        subscription.on('message', (message, content, ackOrNack) => {
          broker.forward('p2', message).then((publication) => {
            publication.on('success', () => {
              ackOrNack();

              amqputils.getMessage('q2', namespace, (err, message) => {
                assert.ifError(err);
                assert.ok(message);
                assert.strictEqual(message.fields.routingKey, 'rk2');
                assert.strictEqual(message.properties.messageId, messageId);
                assert.strictEqual(message.properties.contentType, 'text/plain');
                assert.strictEqual(message.content.toString(), 'test message');
                assert.ok(/\w+-\w+-\w+-\w+-\w+:q1/.test(message.properties.headers.rascal.originalQueue), format('%s failed to match expected pattern', message.properties.headers.rascal.originalQueue));
                assert.strictEqual(message.properties.headers.rascal.restoreRoutingHeaders, false);
                assert.strictEqual(message.properties.headers.rascal.originalRoutingKey, 'rk1');
                assert.strictEqual(message.properties.headers.rascal.originalExchange, namespace + ':e1');
                done();
              });
            });
          });
        });
      });

      broker.publish('p1', 'test message').then((publication) => {
        publication.on('success', (_messageId) => {
          messageId = _messageId;
        });
      });
    });
  });

  it('should forward messages to publications maintaining the original routing key when not overriden', (test, done) => {
    createBroker({
      vhosts,
      publications: {
        p1: {
          exchange: 'e1',
          routingKey: 'rk1',
        },
        p2: {
          exchange: 'e2',
        },
      },
      subscriptions: {
        s1: {
          vhost: '/',
          queue: 'q1',
        },
      },
    }).then((broker) => {

      broker.subscribe('s1').then((subscription) => {

        subscription.on('message', (message, content, ackOrNack) => {

          broker.forward('p2', message).then((publication) => {
            publication.on('success', () => {
              ackOrNack();

              amqputils.getMessage('q2', namespace, (err, message) => {
                assert.ifError(err);
                assert.ok(message);
                assert.strictEqual(message.fields.routingKey, 'rk1');
                done();
              });
            });
          });
        });
      });

      broker.publish('p1', 'test message');
    });
  });

  it('should publish lots of messages using normal channels', () => {

    return createBroker({
      vhosts,
      publications: {
        p1: {
          queue: 'q1',
          confirm: false,
        },
      },
    }).then((broker) => {
      return new Array(1000).fill().reduce((p) => {
        return p.then(() => {
          return broker.publish('p1', 'test message').then((publication) => {
            return new Promise((resolve) => {
              publication.on('success', () => {
                resolve();
              });
            });
          });
        });
      }, Promise.resolve());
    });
  }, { timeout: 60000 });

  it('should publish lots of messages using confirm channels', () => {

    return createBroker({
      vhosts,
      publications: {
        p1: {
          queue: 'q1',
          confirm: true,
        },
      },
    }).then((broker) => {
      return new Array(1000).fill().reduce((p) => {
        return p.then(() => {
          return broker.publish('p1', 'test message').then((publication) => {
            return new Promise((resolve) => {
              publication.on('success', () => {
                resolve();
              });
            });
          });
        });
      }, Promise.resolve());
    });
  }, { timeout: 20000 });

  it('should symetrically encrypt messages', (test, done) => {
    createBroker({
      vhosts,
      publications: {
        p1: {
          queue: 'q1',
          encryption: {
            name: 'well-known',
            key: 'f81db52a3b2c717fe65d9a3b7dd04d2a08793e1a28e3083db3ea08db56e7c315',
            ivLength: 16,
            algorithm: 'aes-256-cbc',
          },
        },
      },
    }).then((broker) => {

      broker.publish('p1', 'test message').then((publication) => {
        publication.on('success', (messageId) => {
          amqputils.getMessage('q1', namespace, (err, message) => {
            assert.ifError(err);
            assert.ok(message);
            assert.strictEqual(messageId, message.properties.messageId);
            assert.strictEqual('well-known', message.properties.headers.rascal.encryption.name);
            assert.strictEqual(32, message.properties.headers.rascal.encryption.iv.length);
            assert.strictEqual('text/plain', message.properties.headers.rascal.encryption.originalContentType);
            assert.strictEqual('application/octet-stream', message.properties.contentType);
            done();
          });
        });
      });
    });
  });

  it('should report encryption errors', () => {
    return createBroker({
      vhosts,
      publications: {
        p1: {
          queue: 'q1',
          encryption: {
            name: 'well-known',
            key: 'aa',
            ivLength: 16,
            algorithm: 'aes-256-cbc',
          },
        },
      },
    }).then((broker) => {
      return broker.publish('p1', 'test message').catch((err) => {
        assert.strictEqual(err.message, 'Invalid key length');
      });
    });
  });


  it('should capture publication stats for normal channels', (test, done) => {
    createBroker({
      vhosts,
      publications: {
        p1: {
          exchange: 'e1',
        },
      },
    }).then((broker) => {
      broker.publish('p1', { message: 'test message' }).then((publication) => {
        publication.on('success', () => {
          assert.strictEqual(typeof publication.stats.duration, 'number');
          assert.ok(publication.stats.duration >= 0);
          done();
        });
      });
    });
  });


  it('should capture publication stats for confirm channels', (test, done) => {
    createBroker({
      vhosts,
      publications: {
        p1: {
          exchange: 'e1',
          confirm: true,
        },
      },
    }).then((broker) => {
      broker.publish('p1', 'test message').then((publication) => {
        publication.on('success', () => {
          assert.strictEqual(typeof publication.stats.duration, 'number');
          assert.ok(publication.stats.duration >= 0);
          done();
        });
      });
    });
  });

  function createBroker(config) {
    config = _.defaultsDeep(config, testConfig);
    return BrokerAsPromised.create(config)
      .catch((err) => {
        if (err.broker) broker = err[err.broker];
        throw err;
      }).then((_broker) => {
        broker = _broker;
        return broker;
      });
  }
}, { timeout: 2000 });
