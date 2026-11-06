const mediasoupClient = require('../utils/mediasoup-client');
module.exports = {
  friendlyName: 'Get mediasoup token',
  description: 'Create a mediasoup-api session and return the wss URL (with token) for the client',
  inputs: {
    peerId: {
      type: 'string',
      required: true
    },
    roomId: {
      type: 'string',

      required: true
    },
    server: {
      type: {},
      required: true
    }
  },


  exits: {
    success: {
      outputFriendlyName: 'Mediasoup token',
    },

  },


  fn: async function (inputs, exits) {
    // Timeout, optional self-signed TLS
    // (MEDIASOUP_ACCEPT_SELF_SIGNED), normalized URL and an error message that
    // says what to check (errors carry err.httpStatus for the controller).
    const token = await mediasoupClient.createSession(inputs.server, inputs.roomId, inputs.peerId);
    return exits.success(mediasoupClient.buildClientUrl(inputs.server, token));
  }
};
