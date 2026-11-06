const mediasoupClient = require('../utils/mediasoup-client');
// health check (/rooms-count) timeout per server
const FETCH_TIMEOUT = 3000;

module.exports = {
  friendlyName: 'Get mediasoup servers',
  description: 'Active, reachable mediasoup servers (falls back to MEDIASOUP_URL)',
  inputs: {},
  exits: {
    success: {
      outputFriendlyName: 'Mediasoup servers',
    },
  },


  fn: async function(inputs, exits) {
    const fallbackMediasoup = mediasoupClient.getFallbackServer();
    try {
      const allServers = await MediasoupServer.find();
      const servers = allServers.filter(server =>
        server.active === true || !server.hasOwnProperty('active')
      );

      sails.config.customLogger.log('verbose', `servers count ${servers.length}`, null, 'server-action', null);

      const serversStatues = await Promise.all(servers.map(async server => {
        try {
          server.activeSessions = await timeoutPromise(FETCH_TIMEOUT, mediasoupClient.getRoomsCount(server));
          server.reachable = true;
          return server;
        } catch (error) {
          sails.config.customLogger.log('error', `Server ${mediasoupClient.safeOrigin(server.url)} is Not reachable: ${error && error.message}`, null, 'server-action', null);
          return { reachable: false };
        }
      }));

      const availableServers = serversStatues.filter(server => {
        // a server without maxNumberOfSessions is not limited
        const hasCapacity = !server.maxNumberOfSessions || server.activeSessions < server.maxNumberOfSessions;
        return server.reachable && hasCapacity;
      });

      sails.config.customLogger.log('verbose', `AVAILABLE SERVERS:: ${availableServers.map(s => mediasoupClient.safeOrigin(s.url)).join(', ')}`, null, 'message', null);

      if (!availableServers.length) {
        if (!fallbackMediasoup.url) {
          // Say clearly that nothing is configured instead of
          // returning a server with an undefined URL
          sails.config.customLogger.log('error', 'NO AVAILABLE MEDIASOUP SERVER AND MEDIASOUP_URL IS NOT SET', null, 'server-action', null);
          return exits.success([]);
        }
        sails.config.customLogger.log(
          'info',
          'NO AVAILABLE SERVER USING FALLBACK ' + mediasoupClient.safeOrigin(fallbackMediasoup.url),
          null,
          'server-action',
          null
        );
        return exits.success([fallbackMediasoup]);
      }

      return exits.success(availableServers);
    } catch (error) {
      // Always resolve the helper (it used to never call an exit here,
      // leaving the HTTP request hanging)
      sails.config.customLogger.log(
        'error',
        'Error with getting Mediasoup server',
        { error: error && error.message },
        'server-action',
        null
      );
      return exits.success(fallbackMediasoup.url ? [fallbackMediasoup] : []);
    }
  }


};

function timeoutPromise(ms, promise) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error('promise timeout'));
    }, ms);
    promise.then(
      (res) => {
        clearTimeout(timeoutId);
        resolve(res);
      },
      (err) => {
        clearTimeout(timeoutId);
        reject(err);
      }
    );
  });
}
