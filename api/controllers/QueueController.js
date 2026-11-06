const QUEUE_FIELDS = ['name', 'disableFeedback', 'disableProvidingTimeEstimate', 'shareWhenOpened'];

function normalizeQueueName(name) {
  return typeof name === 'string'
    ? name.replace(/\s+/g, ' ').trim().toLowerCase()
    : '';
}

async function queueNameExists(name, ignoreId) {
  const normalized = normalizeQueueName(name);
  const queues = await Queue.find({ select: ['name'] });
  return queues.some(queue => queue.id !== ignoreId && normalizeQueueName(queue.name) === normalized);
}

function pickQueueValues(body) {
  const values = {};
  QUEUE_FIELDS.forEach(field => {
    if (body && body[field] !== undefined) {
      values[field] = body[field];
    }
  });
  return values;
}

module.exports = {
  async create(req, res) {
    const values = pickQueueValues(req.body);
    values.name = typeof values.name === 'string' ? values.name.replace(/\s+/g, ' ').trim() : '';
    if (!values.name) {
      return res.badRequest({ message: 'QUEUE_NAME_REQUIRED', details: 'Queue name is required' });
    }
    try {
      if (await queueNameExists(values.name)) {
        sails.config.customLogger.log('warn', 'Queue create rejected: duplicate name', null, 'user-action', req.user?.id);
        return res.status(409).json({ message: 'QUEUE_NAME_EXISTS', details: 'A waiting queue with this name already exists' });
      }
      const queue = await Queue.create(values).fetch();
      sails.config.customLogger.log('info', `Queue ${queue.id} created`, null, 'user-action', req.user?.id);
      return res.json(queue);
    } catch (error) {
      sails.config.customLogger.log('error', 'Queue create failed', { error: error?.message }, 'server-action', req.user?.id);
      return res.serverError(error);
    }
  },

  async update(req, res) {
    const queueId = req.params.id;
    const values = pickQueueValues(req.body);
    if (values.name !== undefined) {
      values.name = typeof values.name === 'string' ? values.name.replace(/\s+/g, ' ').trim() : '';
      if (!values.name) {
        return res.badRequest({ message: 'QUEUE_NAME_REQUIRED', details: 'Queue name is required' });
      }
    }
    try {
      const existing = await Queue.findOne({ id: queueId });
      if (!existing) {
        return res.notFound();
      }
      if (values.name !== undefined && await queueNameExists(values.name, queueId)) {
        sails.config.customLogger.log('warn', `Queue ${queueId} update rejected: duplicate name`, null, 'user-action', req.user?.id);
        return res.status(409).json({ message: 'QUEUE_NAME_EXISTS', details: 'A waiting queue with this name already exists' });
      }
      const queue = await Queue.updateOne({ id: queueId }).set(values);
      sails.config.customLogger.log('info', `Queue ${queueId} updated`, null, 'user-action', req.user?.id);
      return res.json(queue);
    } catch (error) {
      sails.config.customLogger.log('error', 'Queue update failed', { error: error?.message }, 'server-action', req.user?.id);
      return res.serverError(error);
    }
  },

  async find(req, res) {
    const userId = req.user ? req.user.id : 'unknown';
    const userRole = req.user ? req.user.role : 'unknown';
    sails.config.customLogger.log('verbose', `Queue find action initiated for user with id ${userId} and role ${userRole}`, null, 'user-action', req.user?.id);

    const viewAll = req.user.role === sails.config.globals.ROLE_ADMIN ? !!req.query.viewAllQueues : false;

    if (
      viewAll ||
      req.user.viewAllQueues ||
      req.user.role === sails.config.globals.ROLE_SCHEDULER
    ) {
      const queues = await Queue.find({});
      sails.config.customLogger.log('verbose', `Returning all queues for ${userId} queueCount ${queues.length}`, null, 'server-action', req.user?.id);
      return res.json(queues);
    }

    if (req.user.allowedQueues && req.user.allowedQueues.length > 0) {
      sails.config.customLogger.log('verbose', `Returning allowed queues for user ${userId} allowedQueueCount ${req.user.allowedQueues.length}`, null, 'server-action', req.user?.id);
      return res.json(req.user.allowedQueues);
    }

    sails.config.customLogger.log('warn', `No queues available for user with id ${userId}`, null, 'message', req.user?.id);
    return res.json([]);
  }
};
