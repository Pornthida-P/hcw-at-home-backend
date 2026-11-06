module.exports = {
  tableName: 'mediasoupserver',

  attributes: {
    url: {
      type: 'string',
      required: true,
      maxLength: 2048,
      description: 'The URL for the mediasoup server',
      example: 'https://example.com',
      // isURL requires a TLD and rejects https://localhost:3443 or an
      // internal host name; accept any http(s) URL with a host instead
      custom: function (value) {
        try {
          const url = new URL(String(value).trim());
          return (url.protocol === 'http:' || url.protocol === 'https:') && !!url.hostname;
        } catch (e) {
          return false;
        }
      }
    },
    password: {
      type: 'string',
      required: true,
      maxLength: 100,
      description: 'Encrypted or plaintext password (should be hashed ideally)',
    },
    username: {
      type: 'string',
      required: true,
      maxLength: 100,
      description: 'Username used for server access',
    },
    maxNumberOfSessions: {
      type: 'number',
      required: true,
      min: 1,
      max: 1000,
      description: 'Max allowed sessions'
    },
    active: {
      type: 'boolean',
      defaultsTo: true,
      description: 'Server active status',
    }
  },
};
