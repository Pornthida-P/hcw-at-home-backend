const { add, remove } = require('../utils/socketTracker');
module.exports = {

  async subscribe(req, res) {
    if (!req.isSocket) {
      sails.config.customLogger.log('warn', 'subscribe: Request is not a socket.', null, 'message', req.user?.id);
      return res.badRequest();
    }
    const user = await User.findOne({ id: req.user.id });
    if (!user) {
      sails.config.customLogger.log('error', 'Unauthorized access attempt - User not found', null, 'message', req.user?.id);
      return res.forbidden();
    }
    const socketId = sails.sockets.getId(req);
    const socket = sails.sockets.get(socketId);
    add(user.id, socketId);

    socket.once('disconnect', async (reason) => {
      sails.config.customLogger.log('info', `User disconnected: ID=${user.id}, Reason=${reason}`, null, 'server-action', req.user?.id);
      const isLast = remove(user.id, socketId);
      if (isLast) {
        try {
          await Consultation.changeOnlineStatus(user, false);
        } catch (err) {
          // During server shutdown, ORM/datastore may already be torn down (race condition).
          // Log and ignore so shutdown can complete without uncaught exception.
          const isTeardownError = err && (
            (err.adapterMethodName && err.modelIdentity) ||
            (typeof err.message === 'string' && (
              err.message.includes('datastore') ||
              err.message.includes('torn down') ||
              err.message.includes('Consistency violation')
            ))
          );
          if (isTeardownError) {
            sails.config.customLogger.log('info', `Skipping changeOnlineStatus on disconnect (app likely shutting down): ${err.message}`, null, 'server-action', req.user?.id);
          } else {
            sails.config.customLogger.log('error', `changeOnlineStatus failed on disconnect: ${err?.message || err}`, err, 'server-action', req.user?.id);
          }
        }
      } else {
        sails.log.info('info',`User ${user.id} has other active sockets, skipping offline broadcast`, null, 'server-action', req.user?.id);
      }
    });
    sails.sockets.join(req, user.id, async (err) => {
      await Consultation.changeOnlineStatus(user, true);
      if (err) {
        sails.config.customLogger.log('error', `Error joining session: ${err?.message || err}`, null, 'server-action', req.user?.id);
        return res.serverError(err);
      }
      sails.config.customLogger.log('info', `User subscribed to room: ID=${user.id}`, null, 'message', req.user?.id);
      return res.json({ message: `Subscribed to room ${user.id}` });
    });
  }

};

