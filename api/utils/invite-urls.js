/**
 * Central place to build the invitation links sent to participants.
 *
 * Experts ("Invite a colleague") join the consultation through the
 * PATIENT/participant application, not through the doctor application:
 *  - the backend logs an expert in with `POST /api/v1/login-invite` using the
 *    invite's `expertToken` and creates a temporary user with role `expert`;
 *  - only the patient app accepts that role (see APP_ALLOWED_ROLES in
 *    AuthController: doctor app = doctor/admin/scheduler only) and only the
 *    patient app has the `/inv/?invite=<token>` route with the expert login
 *    form (first name / last name) and the expert consultation view.
 * So the expert link must point to a patient-app instance. By default it is
 * PUBLIC_URL; EXPERT_URL can override it (e.g. a dedicated patient-app
 * instance/branding for colleagues), but it must still serve the patient app.
 */

function trimBase(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

function getExpertBaseUrl() {
  return trimBase(process.env.EXPERT_URL || process.env.PUBLIC_URL);
}

function getExpertInvitationURL(expertToken) {
  if (!expertToken) {
    return '';
  }
  return `${getExpertBaseUrl()}/inv/?invite=${encodeURIComponent(expertToken)}`;
}

module.exports = {
  getExpertBaseUrl,
  getExpertInvitationURL,
};
