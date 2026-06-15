// icue-shim.js — a compatibility runtime that lets unmodified iCUE / Xeneon Edge
// widgets (https://docs.elgato.com/icue/widgets/specification/) run on this macOS
// host. iCUE injects a native bridge before each widget's scripts; we recreate it
// here, backed by our /api/* collectors.
//
// The server injects this as the FIRST <head> script for any page under
// /plugins/installed/ (see src/server/server.mjs), so the globals below exist
// before the widget's own scripts run. Classic script, no imports, so it stays
// synchronous and satisfies the widgets' strict CSP (script-src 'self').
//
// Implemented from a real community widget (StealthyLabsHQ "Windows Media Pump"):
//   window.plugins.Mediadataprovider — .songName/.artist (direct) OR
//     getSongName(id)/getArtist(id) replying via the .asyncResponse signal
//   window.plugins.Sensorsdataprovider — .sensorValueChanged(sensorId, value)
//   window.icueEvents.{onICUEInitialized,onDataUpdated}
//   window.plugin<Module>Events.onInitialized, plugin<Module>_initialized flags
(function () {
  'use strict';

  // Qt WebChannel-style signal: widgets call `.connect(fn)`; we `_emit(...)`.
  function makeSignal() {
    var fns = [];
    return {
      connect: function (fn) {
        if (typeof fn === 'function') fns.push(fn);
      },
      disconnect: function (fn) {
        var i = fns.indexOf(fn);
        if (i >= 0) fns.splice(i, 1);
      },
      _emit: function () {
        var args = arguments;
        fns.slice().forEach(function (fn) {
          try {
            fn.apply(null, args);
          } catch (e) {
            /* a widget handler threw — keep going */
          }
        });
      },
    };
  }

  function fire(obj, method) {
    try {
      if (obj && typeof obj[method] === 'function') obj[method]();
    } catch (e) {
      /* widget hook threw — ignore */
    }
  }

  function getJson(pathname) {
    // Same-origin (the widget is served from our server) → satisfies connect-src 'self'.
    return fetch(pathname).then(function (r) {
      return r.ok ? r.json() : null;
    });
  }

  // ---- Media plugin (widgetbuilder.mediadataprovider:Media) -------------------
  var media = {
    songName: '',
    artist: '',
    albumName: '',
    playbackState: '',
    asyncResponse: makeSignal(),
    getSongName: function (id) {
      media.asyncResponse._emit(id, media.songName);
    },
    getArtist: function (id) {
      media.asyncResponse._emit(id, media.artist);
    },
    getAlbum: function (id) {
      media.asyncResponse._emit(id, media.albumName);
    },
  };

  // ---- Sensors plugin (widgetbuilder.sensorsdataprovider:Sensors) -------------
  // macOS exposes far fewer sensors than iCUE's hardware catalog; we map the few
  // we collect. Widgets that ask for arbitrary hardware sensors get no value.
  var sensors = {
    sensorValueChanged: makeSignal(),
    asyncResponse: makeSignal(),
    // Minimal catalog so sensor-selector widgets have something to pick.
    listSensors: function (id) {
      sensors.asyncResponse._emit(
        id,
        JSON.stringify([
          { id: 'cpu.load', name: 'CPU Load', unit: '%' },
          { id: 'mem.used', name: 'Memory Used', unit: 'MB' },
          { id: 'disk.used', name: 'Disk Used', unit: '%' },
        ]),
      );
    },
  };

  window.plugins = window.plugins || {};
  window.plugins.Mediadataprovider = media;
  window.plugins.Sensorsdataprovider = sensors;
  window.plugins.LinkProvider = window.plugins.LinkProvider || {};

  // Plugin-ready flags some widgets check before their onInitialized fires.
  window.pluginMediadataprovider_initialized = false;
  window.pluginSensorsdataprovider_initialized = false;

  // ---- iCUE global + lifecycle ------------------------------------------------
  window.tr =
    window.tr ||
    function (k) {
      return k; // translation.json wiring is a later refinement
    };
  window.iCUE = window.iCUE || {
    log: function () {
      try {
        console.log.apply(console, arguments);
      } catch (e) {
        /* ignore */
      }
    },
    tr: window.tr,
    platform: 'macos',
  };
  window.iCUE_initialized = false;

  // Apply <meta name="x-icue-property"> defaults as the global vars iCUE injects.
  function applyPropertyDefaults() {
    var metas = document.querySelectorAll('meta[name="x-icue-property"]');
    metas.forEach(function (m) {
      var name = m.getAttribute('content');
      if (!name) return;
      var raw = m.getAttribute('data-default');
      var val = raw;
      try {
        val = raw == null ? '' : Function('return (' + raw + ')')();
      } catch (e) {
        /* leave as the raw string */
      }
      try {
        window[name] = val;
      } catch (e) {
        /* ignore */
      }
    });
  }

  var notified = false;
  function notifyReady() {
    if (notified) return;
    notified = true;
    applyPropertyDefaults();
    window.iCUE_initialized = true;
    window.pluginMediadataprovider_initialized = true;
    window.pluginSensorsdataprovider_initialized = true;
    // The widget registers these during its own scripts (which run before
    // DOMContentLoaded), so they're present by the time we fire.
    fire(window.pluginMediadataproviderEvents, 'onInitialized');
    fire(window.pluginSensorsdataproviderEvents, 'onInitialized');
    fire(window.icueEvents, 'onICUEInitialized');
    fire(window.icueEvents, 'onDataUpdated');
  }

  // ---- Data binding -----------------------------------------------------------
  function pollMedia() {
    getJson('/api/media')
      .then(function (d) {
        media.songName = (d && d.title) || '';
        media.artist = (d && d.artist) || '';
        media.albumName = (d && d.album) || '';
        media.playbackState = (d && d.playerState) || '';
        fire(window.icueEvents, 'onDataUpdated');
      })
      .catch(function () {});
  }

  var lastSystem = {};
  function pollSystem() {
    getJson('/api/system')
      .then(function (d) {
        if (!d) return;
        var map = { 'cpu.load': d.cpu, 'mem.used': d.ramUsedMB, 'disk.used': d.disk };
        Object.keys(map).forEach(function (id) {
          if (map[id] != null && map[id] !== lastSystem[id]) {
            lastSystem[id] = map[id];
            sensors.sensorValueChanged._emit(id, map[id]);
          }
        });
      })
      .catch(function () {});
  }

  function startPolling() {
    pollMedia();
    pollSystem();
    setInterval(pollMedia, 1500);
    setInterval(pollSystem, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      notifyReady();
      startPolling();
    });
  } else {
    notifyReady();
    startPolling();
  }
})();
