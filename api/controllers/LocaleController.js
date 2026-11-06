const fs = require('fs');
const path = require('path');

module.exports = {
  supportedLanguages: function (req, res) {
    const localesDir = path.resolve(sails.config.appPath, 'config/locales');

    fs.readdir(localesDir, (err, files) => {
      if (err) {
        sails.config.customLogger.log('error', 'Error reading locales directory', {
          error: err.message,
          localesDir
        }, 'server-action', req.user?.id);
        return res.serverError(err);
      }

      const enabledLocales = sails.config.i18n.locales || ['en'];
      const languages = files
        .filter(file => file.endsWith('.json') && !file.startsWith('.'))
        .map(file => file.split('.').shift())
        .filter(language => enabledLocales.includes(language));
      sails.config.customLogger.log('info', `Supported languages retrieved ${languages}`, null, 'message', req.user?.id);
      return res.json(languages);
    });
  }
};
