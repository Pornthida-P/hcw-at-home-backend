const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const ACTIVATION_TOKEN_EXPIRY = process.env.ACTIVATION_TOKEN_EXPIRY || '24h';

async function hashToken(token) {
  return bcrypt.hash(token, 10);
}

function generateSecureToken() {
  return crypto.randomBytes(32).toString('hex');
}

module.exports = {
  friendlyName: 'Send activation email',
  description: 'Send account activation email with secure token',
  
  inputs: {
    user: {
      type: 'ref',
      required: true,
      description: 'The user object'
    }
  },
  
  exits: {
    success: {
      description: 'Activation email sent successfully'
    },
    error: {
      description: 'Failed to send activation email'
    }
  },
  
  async fn(inputs, exits) {
    try {
      const { user } = inputs;
      
      if (!user.email) {
        sails.config.customLogger.log('error', 'Cannot send activation email without user email', null, 'server-action', user.id);
        return exits.error(new Error('User email required'));
      }
      
      const plainToken = generateSecureToken();
      const hashedToken = await hashToken(plainToken);
      
      const db = User.getDatastore().manager;
      await db.collection("user").updateOne(
        { _id: user._id || user.id },
        { $set: { activationToken: hashedToken, isActivated: false } }
      );
      
      const appSecret = process.env.APP_SECRET || sails.config.globals.APP_SECRET;
      const jwtToken = jwt.sign(
        { 
          email: user.email.toLowerCase(),
          token: plainToken,
          type: 'account-activation'
        },
        appSecret,
        { expiresIn: ACTIVATION_TOKEN_EXPIRY }
      );
      
      const url = `${process.env.DOCTOR_URL}/reset-password?token=${jwtToken}`;
      const doctorLanguage = user.preferredLanguage || process.env.DEFAULT_DOCTOR_LOCALE || 'en';
      
      await sails.helpers.email.with({
        to: user.email,
        subject: sails._t(doctorLanguage, "account activation email subject", { url }) || `Activate your account`,
        text: sails._t(doctorLanguage, "account activation email", { url }) || `Please activate your account by clicking this link: ${url}`,
      });
      
      sails.config.customLogger.log('info', `Activation email sent to user ${user._id || user.id}`, null, 'server-action', user._id || user.id);
      return exits.success();
      
    } catch (error) {
      sails.config.customLogger.log('error', `Error sending activation email: ${error.message}`, null, 'server-action', inputs.user?.id);
      return exits.error(error);
    }
  }
};
