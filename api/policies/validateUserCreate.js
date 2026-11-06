/**
 * Validation for the admin user blueprint (POST /api/v1/user and
 * PATCH /api/v1/user/:id).
 *  - staff roles (doctor, admin, nurse, scheduler) need a valid e-mail,
 *    a first name and a last name
 *  - the e-mail must not already be used by another account with the same role
 *  - the role must be one an admin can give (doctor, admin, scheduler)
 * Users created by invites / OpenID do not go through this policy.
 */
const validator = require('validator');

const STAFF_ROLES = ['doctor', 'admin', 'nurse', 'scheduler'];
// roles that can be given from the admin user form
const ADMIN_CREATABLE_ROLES = ['doctor', 'admin', 'scheduler'];

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

module.exports = async function (req, res, proceed) {
  try {
    const body = req.body || {};
    const isCreate = req.method === 'POST';
    const userId = req.params && req.params.id;

    let existing = null;
    if (!isCreate && userId) {
      existing = await User.findOne({ id: userId });
      if (!existing) {
        return res.notFound({ error: 'User not found' });
      }
    }

    const merged = Object.assign({}, existing || {}, body);
    const role = merged.role;

    if (isCreate && isBlank(role)) {
      return res.badRequest({ error: 'Role is required', message: 'Role is required' });
    }

    // a new account, or a role change, must use a role allowed for admin-created accounts
    const roleChanged = Object.prototype.hasOwnProperty.call(body, 'role') && (!existing || existing.role !== body.role);
    if ((isCreate || roleChanged) && !ADMIN_CREATABLE_ROLES.includes(role)) {
      return res.badRequest({ error: 'Invalid role', message: 'Invalid role' });
    }

    if (STAFF_ROLES.includes(role)) {
      const missing = [];
      // on update only validate the fields that are sent (or the role change)
      const check = (field) => isCreate || Object.prototype.hasOwnProperty.call(body, field) || Object.prototype.hasOwnProperty.call(body, 'role');
      if (check('email') && isBlank(merged.email)) missing.push('email');
      if (check('firstName') && isBlank(merged.firstName)) missing.push('firstName');
      if (check('lastName') && isBlank(merged.lastName)) missing.push('lastName');
      if (missing.length) {
        const message = `Missing required field(s): ${missing.join(', ')}`;
        return res.badRequest({ error: message, message, fields: missing });
      }
    }

    if (!isBlank(body.email)) {
      const email = String(body.email).trim();
      if (!validator.isEmail(email)) {
        return res.badRequest({ error: 'Invalid email address', message: 'Invalid email address' });
      }
      body.email = email;
      if (STAFF_ROLES.includes(role)) {
        const sameEmail = await User.find({ email, role }).limit(2);
        const conflict = sameEmail.find(u => !existing || u.id !== existing.id);
        if (conflict) {
          return res.badRequest({ error: 'Email already used', message: 'Email already used' });
        }
      }
    }

    return proceed();
  } catch (error) {
    sails.config.customLogger.log('error', 'validateUserCreate: unexpected error', { error: error?.message || error }, 'server-action', req.user?.id);
    return res.serverError({ error: 'An error occurred' });
  }
};
