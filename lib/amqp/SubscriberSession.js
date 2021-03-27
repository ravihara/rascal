const debug = require('debug')('rascal:SubscriberSession');
const EventEmitter = require('events').EventEmitter;
const inherits = require('util').inherits;
const _ = require('lodash');
const setTimeoutUnref = require('../utils/setTimeoutUnref');

module.exports = SubscriberSession;

inherits(SubscriberSession, EventEmitter);

function SubscriberSession(sequentialChannelOperations, config) {

  let index = 0;
  const channels = {};
  let cancelled = false;
  let timeout;
  const self = this;

  this.name = config.name;
  this.config = _.cloneDeep(config);

  this.isCancelled = function() {
    return cancelled;
  };

  this._open = function(channel, consumerTag, next) {
    if (cancelled) return next(new Error('Subscriber has been cancelled'));
    debug('Opening subscriber session: %s on channel: %s', consumerTag, channel._rascal_id);
    channels[consumerTag] = { index: index++, channel, consumerTag };
    channel.once('close', unref.bind(null, consumerTag));
    channel.once('error', unref.bind(null, consumerTag));
    next();
  };

  this.cancel = function(next) {
    clearTimeout(timeout);
    sequentialChannelOperations.push((done) => {
      cancelled = true;
      self._unsafeClose(done);
    }, next);
  };

  this._close = function(next) {
    sequentialChannelOperations.push((done) => {
      self._unsafeClose(done);
    }, next);
  };

  this._unsafeClose = function(next) {
    withCurrentChannel((channel, consumerTag) => {
      debug('Cancelling subscriber session: %s on channel: %s', consumerTag, channel._rascal_id);
      channel.cancel(consumerTag, (err) => {
        if (err) return next(err);
        doom(consumerTag);
        next();
      });
    }, () => {
      debug('No current subscriber session');
      next();
    });
  };

  this._schedule = function(fn, delay) {
    timeout = setTimeoutUnref(fn, delay);
  };

  this._maxDeferCloseChannel = function(other) {
    return Math.max(config.deferCloseChannel, other) ;
  };

  this._getRascalChannelId = function() {
    let rascalChannelId = null;
    withCurrentChannel((channel) => {
      rascalChannelId = channel._rascal_id;
    });
    return rascalChannelId;
  };

  this._ack = function(message, next) {
    withConsumerChannel(message.fields.consumerTag, (channel) => {
      debug('Acknowledging message: %s on channel: %s', message.properties.messageId, channel._rascal_id);
      channel.ack(message);
      setImmediate(next);
    }, () => {
      setImmediate(() => {
        next(new Error('The channel has been closed. Unable to ack message'));
      });
    });
  };

  this._nack = function(message, options, next) {
    if (arguments.length === 2) return self._nack(arguments[0], {}, arguments[1]);
    withConsumerChannel(message.fields.consumerTag, (channel) => {
      debug('Not acknowledging message: %s with requeue: %s on channel: %s', message.properties.messageId, !!options.requeue, channel._rascal_id);
      channel.nack(message, false, !!options.requeue);
      setImmediate(next);
    }, () => {
      setImmediate(() => {
        next(new Error('The channel has been closed. Unable to nack message'));
      });
    });
  };

  function withCurrentChannel(fn, altFn) {
    const entry = _.chain(channels).values().filter(channel => {
      return !channel.doomed;
    }).sortBy('index').last().value();
    if (entry) return fn(entry.channel, entry.consumerTag, entry);
    return altFn && altFn();
  }

  function withConsumerChannel(consumerTag, fn, altFn) {
    const entry = channels[consumerTag];
    if (entry) return fn(entry.channel, entry.consumerTag, entry);
    return altFn && altFn();
  }

  function unref(consumerTag) {
    withConsumerChannel(consumerTag, (channel) => {
      debug('Removing channel: %s from session', channel._rascal_id);
      delete channels[consumerTag];
    });
  }

  function doom(consumerTag) {
    withConsumerChannel(consumerTag, (channel, consumerTag, entry) => {
      if (entry.doomed) return;
      entry.doomed = true;
      scheduleClose(entry);
    });
  }

  /*
    There may still be delivered messages that have yet to be ack or nacked
    but no way of telling how many are outstanding since due to potentially
    complicated recovery strategies, with timeouts etc.
    Keeping channels around for a minute shouldn't hurt
  */
  function scheduleClose(entry) {
    debug('Deferring close channel: %s by %dms', entry.channel._rascal_id, config.deferCloseChannel);
    setTimeoutUnref(() => {
      withConsumerChannel(entry.consumerTag, (channel) => {
        channel.close(() => {
          debug('Channel: %s was closed', channel._rascal_id);
        });
      });
    }, config.deferCloseChannel);
  }
}
