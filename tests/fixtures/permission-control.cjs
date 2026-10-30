// Test entry only. Capture the actual handlers installed by the app so that
// approving camera/microphone routing never opens physical user devices.
const { app, session } = require('electron');
globalThis.permissionTestHandlers = new WeakMap();
app.once('ready', () => {
  const proto = Object.getPrototypeOf(session.defaultSession);
  for (const kind of ['Request','Check']) {
    const name = 'setPermission' + kind + 'Handler', original = proto[name];
    proto[name] = function (handler) {
      const record = globalThis.permissionTestHandlers.get(this) || {};
      record[kind] = handler; globalThis.permissionTestHandlers.set(this, record);
      return original.call(this, handler);
    };
  }
});
require('../../out/main/index.js');
