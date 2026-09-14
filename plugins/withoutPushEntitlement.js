const fs = require("fs");
const plist = require("plist");
const { withFinalizedMod, IOSConfig } = require("expo/config-plugins");

// expo-notifications' own config plugin unconditionally sets aps-environment,
// even though Komfy only schedules local notifications. It gets auto-applied
// by Expo *after* app.json's plugins list regardless of ordering, so removing
// the key from a regular entitlements mod gets overwritten. A finalized mod
// runs after every other mod, so it's the only place that reliably wins.
// Personal (free) Apple dev teams cannot provision an app requesting the
// Push Notifications capability, which is why this entitlement must go.
module.exports = function withoutPushEntitlement(config) {
  return withFinalizedMod(config, [
    "ios",
    async (config) => {
      const entitlementsPath = IOSConfig.Entitlements.getEntitlementsPath(config.modRequest.projectRoot);
      if (entitlementsPath) {
        const entitlements = plist.parse(fs.readFileSync(entitlementsPath, "utf8"));
        delete entitlements["aps-environment"];
        fs.writeFileSync(entitlementsPath, plist.build(entitlements));
      }
      return config;
    },
  ]);
};
