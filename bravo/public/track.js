(function () {
  var urlParams = new URLSearchParams(window.location.search);
  var urlDistinctId = urlParams.get('distinct_id');
  var arrivedFromOtherDomain = Boolean(urlDistinctId);
  var mixpanelDistinctId = null;
  var DEBUG =
    /localhost|127\.0\.0\.1/.test(window.location.hostname);

  function sessionDistinctId() {
    var key = 'demo_distinct_id';
    var stored = sessionStorage.getItem(key);
    if (!stored) {
      stored = 'demo-' + Math.random().toString(36).slice(2, 12);
      sessionStorage.setItem(key, stored);
    }
    return stored;
  }

  function getDistinctIdForLink() {
    if (urlDistinctId) return urlDistinctId;
    if (mixpanelDistinctId) return mixpanelDistinctId;
    return sessionDistinctId();
  }

  function updateDistinctIdDisplay() {
    var el = document.getElementById('distinct-id');
    if (el) el.textContent = getDistinctIdForLink();
  }

  function decorateCrossDomainLinks(otherSiteUrl) {
    if (!otherSiteUrl) {
      console.error('OTHER_SITE_URL is not configured (check .env and /api/config)');
      return;
    }

    var base = String(otherSiteUrl).replace(/\/$/, '');
    var id = getDistinctIdForLink();

    document.querySelectorAll('a.cross-domain').forEach(function (anchor) {
      var path = anchor.getAttribute('data-target-path') || '/page2.html';
      var target = base + path + '?distinct_id=' + encodeURIComponent(id);
      anchor.href = target;

      var hint = document.getElementById('cross-domain-target');
      if (hint) hint.textContent = 'Link target: ' + target;
    });
  }

  function track(event, props, callback) {
    var payload = Object.assign({}, props, {
      distinct_id: getDistinctIdForLink(),
    });

    fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: event, properties: payload }),
    })
      .then(function (res) {
        return res.json();
      })
      .then(function (data) {
        if (DEBUG) console.log('[mixpanel] sent:', event, payload, data);
        if (callback) callback();
      })
      .catch(function (err) {
        console.error('[mixpanel] /api/track failed:', event, err);
        if (callback) callback();
      });
  }

  function trackAndNavigate(e, anchor, eventName, props) {
    var url = anchor.href;
    if (!url || url === '#') return;

    e.preventDefault();
    var left = false;
    function go() {
      if (left) return;
      left = true;
      window.location.href = url;
    }

    track(eventName, props, go);
    setTimeout(go, 1000);
  }

  function bindClickTracking() {
    document.querySelectorAll('a.internal').forEach(function (anchor) {
      anchor.addEventListener('click', function (e) {
        trackAndNavigate(e, anchor, 'Internal Link Clicked', {
          from: window.location.pathname,
          to: anchor.getAttribute('href'),
        });
      });
    });

    document.querySelectorAll('a.cross-domain').forEach(function (anchor) {
      anchor.addEventListener('click', function (e) {
        trackAndNavigate(e, anchor, 'Cross Domain Navigation', {
          from: window.location.pathname,
          to: anchor.href,
          distinct_id_passed: getDistinctIdForLink(),
        });
      });
    });
  }

  function initMixpanelSdk(config) {
    if (!config.token) return;

    var script = document.createElement('script');
    script.src = 'https://cdn.mxpnl.com/libs/mixpanel-2-latest.min.js';
    script.async = true;
    script.onload = function () {
      if (!window.mixpanel || typeof mixpanel.init !== 'function') return;

      try {
        mixpanel.init(config.token, {
          track_pageview: false,
          persistence: 'cookie',
          batch_requests: false,
          loaded: function () {
            if (urlDistinctId) mixpanel.identify(urlDistinctId);
            try {
              mixpanelDistinctId = mixpanel.get_distinct_id();
              decorateCrossDomainLinks(config.otherSiteUrl);
              updateDistinctIdDisplay();
              if (DEBUG) {
                console.log('[mixpanel] SDK ready, distinct_id:', mixpanelDistinctId);
              }
            } catch (e) {
              if (DEBUG) console.warn('[mixpanel] SDK distinct_id:', e);
            }
          },
        });
      } catch (e) {
        if (DEBUG) console.warn('[mixpanel] SDK init skipped:', e.message);
      }
    };
    script.onerror = function () {
      if (DEBUG) console.warn('[mixpanel] SDK CDN blocked — events still sent via /api/track');
    };
    document.head.appendChild(script);
  }

  fetch('/api/config')
    .then(function (res) {
      if (!res.ok) throw new Error('config HTTP ' + res.status);
      return res.json();
    })
    .then(function (config) {
      decorateCrossDomainLinks(config.otherSiteUrl);
      updateDistinctIdDisplay();
      bindClickTracking();

      track('Page Viewed', {
        page: window.location.pathname,
        arrived_from_other_domain: arrivedFromOtherDomain,
      });

      initMixpanelSdk(config);
    })
    .catch(function (err) {
      console.error('Failed to load /api/config', err);
      var hint = document.getElementById('cross-domain-target');
      if (hint) {
        hint.textContent =
          'Config failed. Run npm run dev in bravo/ and open http://localhost:3001';
      }
    });
})();
