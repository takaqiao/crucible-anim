import {MODULE_ID, SETTINGS} from "./const.mjs";

export function registerSettings() {
  const S = game.settings;
  S.register(MODULE_ID, SETTINGS.ENABLED, {
    name: "CANIM.Settings.Enabled.Name", hint: "CANIM.Settings.Enabled.Hint",
    scope: "world", config: true, type: Boolean, default: true, requiresReload: false
  });
  S.register(MODULE_ID, SETTINGS.DENSITY, {
    name: "CANIM.Settings.Density.Name", hint: "CANIM.Settings.Density.Hint",
    scope: "world", config: true, type: String, default: "standard",
    choices: {
      minimal: "CANIM.Settings.Density.Minimal",
      standard: "CANIM.Settings.Density.Standard",
      full: "CANIM.Settings.Density.Full"
    }
  });
  S.register(MODULE_ID, SETTINGS.VOLUME, {
    name: "CANIM.Settings.Volume.Name", hint: "CANIM.Settings.Volume.Hint",
    scope: "world", config: true, type: Number, default: 0.7,
    range: {min: 0, max: 1, step: 0.05}
  });
  S.register(MODULE_ID, SETTINGS.SHAKE, {
    name: "CANIM.Settings.Shake.Name", hint: "CANIM.Settings.Shake.Hint",
    scope: "world", config: true, type: Boolean, default: true
  });
  S.register(MODULE_ID, SETTINGS.DEBUG, {
    name: "CANIM.Settings.Debug.Name", hint: "CANIM.Settings.Debug.Hint",
    scope: "world", config: true, type: Boolean, default: false
  });
}

export function getSetting(key) {
  return game.settings.get(MODULE_ID, key);
}
