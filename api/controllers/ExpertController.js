const { getExpertInvitationURL } = require('../utils/invite-urls');

/**
 * Make sure the consultation has an expert token and return the
 * expert link built with the CURRENT EXPERT_URL/PUBLIC_URL (patient app,
 * `/inv/?invite=<expertToken>`). Returns null when the consultation does not exist.
 */
async function ensureExpertLink(consultationId, userId) {
  const consultation = await Consultation.findOne({ id: consultationId }).populate('doctor');
  if (!consultation) {
    return null;
  }
  if (!consultation.expertToken) {
    const invite = await PublicInvite.create({
      id: consultation.id,
      firstName: consultation.firstName,
      lastName: consultation.lastName,
      queue: consultation.queue,
      gender: consultation.gender,
    }).fetch();

    const expertInvitationURL = getExpertInvitationURL(invite.expertToken);
    await Consultation.updateOne({ id: consultationId }).set({
      expertInvitationURL,
      expertToken: invite.expertToken,
      invitationToken:  invite.inviteToken
    });
    consultation.expertToken = invite.expertToken;
    sails.config.customLogger.log('info', 'Expert token was missing and has been generated', null, 'message', userId);
  }
  consultation.expertInvitationURL = getExpertInvitationURL(consultation.expertToken);
  return consultation;
}

module.exports = {
  /**
   * GET /api/v1/consultation/:consultation/expert-link
   * Returns the link a colleague (expert) must open to join the consultation.
   */
  getExpertLink: async function(req, res) {
    try {
      const consultationId = req.params.consultation;
      const consultation = await ensureExpertLink(consultationId, req.user?.id);
      if (!consultation) {
        return res.notFound({ message: 'Consultation not found' });
      }
      return res.ok({ expertInvitationURL: consultation.expertInvitationURL });
    } catch (error) {
      sails.config.customLogger.log('error', 'Error getting expert link', { error: error?.message || error }, 'server-action', req.user?.id);
      return res.serverError({ message: 'Error getting expert link' });
    }
  },

  sendExpertLink: async function(req, res) {
    try {
      const { to, consultationId, messageService } = req.body;
      const { locale } = req.headers || {};
      if (typeof to !== 'string' || !to) {
        return res.badRequest({ message: 'Invalid "to" field. It should be either a valid email address or phone number.' });
      }
      const consultation = await ensureExpertLink(consultationId, req.user?.id);
      if (!consultation) {
        sails.config.customLogger.log('warn', `sendExpertLink: consultation ${consultationId} not found`, null, 'message', req.user?.id);
        return res.notFound({ message: 'Consultation not found' });
      }
      const isPhoneNumber = /^(\+|00)[0-9 ]+$/.test(to);
      const isEmail = to.includes('@');
      if (isPhoneNumber && !isEmail) {
        if (messageService === '1') {
          const type = 'please use this link';
          const language = req?.body?.language || 'en';
          const template = await WhatsappTemplate.findOne({ language, key: type, approvalStatus: 'approved' });
          sails.config.customLogger.log('info', `Fetched WhatsApp template for type "${type}" and language "${language}"`, null, 'message', req.user?.id);
          if (template && template.sid) {
            const twilioTemplatedId = template.sid;
            const params = { 1: consultation.expertToken };
            if (twilioTemplatedId) {
              await sails.helpers.sms.with({
                phoneNumber: to,
                message: sails._t(locale, type, { expertLink: consultation.expertInvitationURL }),
                senderEmail: consultation.doctor?.email,
                whatsApp: true,
                params,
                twilioTemplatedId
              });
              sails.config.customLogger.log('verbose', `WhatsApp SMS sent successfully to ${to}`, null, 'server-action', req.user?.id);
            } else {
              sails.config.customLogger.log('warn', 'Template id is missing for WhatsApp SMS', null, 'message', req.user?.id);
            }
          } else {
            sails.config.customLogger.log('warn', `WhatsApp template not found or missing sid for language "${language}" and type "${type}"`, null, 'message', req.user?.id);
          }
        } else if (messageService === '2') {
          await sails.helpers.sms.with({
            phoneNumber: to,
            message: sails._t(locale, 'please use this link', { expertLink: consultation.expertInvitationURL }),
            senderEmail: consultation.doctor?.email,
            whatsApp: false,
          });
          sails.config.customLogger.log('verbose', `SMS sent successfully to ${to}`, null, 'server-action', req.user?.id);
        }
        return res.ok({ message: 'SMS sent successfully' });
      } else if (isEmail && !isPhoneNumber) {
        await sails.helpers.email.with({
          to,
          subject: sails._t(locale, 'consultation link'),
          text: sails._t(locale, 'please use this link', { expertLink: consultation.expertInvitationURL }),
        });
        sails.config.customLogger.log('verbose', `Email sent successfully to ${to}`, null, 'server-action', req.user?.id);
        return res.ok({ message: 'Email sent successfully' });
      } else {
        sails.config.customLogger.log('warn', `Invalid "to" field. It should be either a valid email address or phone number. to ${to}`, null, 'server-action', req.user?.id);
        return res.badRequest({
          message: 'Invalid "to" field. It should be either a valid email address or phone number.',
        });
      }
    } catch (error) {
      sails.config.customLogger.log('error', 'Error sending message', { error: error?.message || error }, null, 'server-action', req.user?.id);
      return res.serverError({ message: 'Error sending message' });
    }
  },
};
