/**
 * upsell-pay.js — Auto-payment engine para upsells
 * Cada upsell chama: UpsellPay.init({ taxa: 23.40, nextPage: 'up2.html' })
 *
 * Fluxo:
 *  1) ?auto=1 na URL → cria pagamento automaticamente ao carregar
 *  2) Volta do Satispay → encontra pending_id no localStorage → polling
 *  3) paid → redireciona para nextPage?auto=1
 *  4) Sem ?auto=1 → CTA funciona normalmente (click manual)
 */
(function(w){
  'use strict';

  var POLL_INTERVAL_MS = 5000;
  var MAX_POLL_ATTEMPTS = 72; // 6 minutos

  // ── Overlay de loading ────────────────────────────────────────────────────
  function showOverlay(msg, icon) {
    var ov = document.getElementById('_upOverlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = '_upOverlay';
      ov.style.cssText = [
        'position:fixed;inset:0;z-index:99999',
        'background:rgba(0,0,0,.88)',
        'display:flex;flex-direction:column;align-items:center;justify-content:center',
        'color:#fff;font-family:Poppins,sans-serif;text-align:center;padding:32px',
        'animation:_upFadeIn .25s ease',
      ].join(';');
      ov.innerHTML =
        '<style>@keyframes _spin{to{transform:rotate(360deg)}}@keyframes _upFadeIn{from{opacity:0}to{opacity:1}}</style>' +
        '<div id="_upSpinner" style="width:52px;height:52px;border:4px solid rgba(255,255,255,.18);border-top-color:#ff2d55;border-radius:50%;animation:_spin .75s linear infinite;margin-bottom:22px"></div>' +
        '<p id="_upIcon" style="font-size:36px;display:none;margin-bottom:12px"></p>' +
        '<p id="_upMsg" style="font-size:17px;font-weight:700;line-height:1.5;max-width:280px"></p>' +
        '<p id="_upSub" style="font-size:12px;color:rgba(255,255,255,.5);margin-top:8px;line-height:1.5;max-width:260px"></p>';
      document.body.appendChild(ov);
    }
    var spinner = document.getElementById('_upSpinner');
    var iconEl  = document.getElementById('_upIcon');
    var msgEl   = document.getElementById('_upMsg');
    var subEl   = document.getElementById('_upSub');

    msgEl.textContent = msg || '';
    if (icon) {
      iconEl.textContent = icon;
      iconEl.style.display = 'block';
      spinner.style.display = 'none';
    } else {
      iconEl.style.display = 'none';
      spinner.style.display = 'block';
    }
    if (subEl) subEl.textContent = '';
  }

  function setOverlaySub(sub) {
    var el = document.getElementById('_upSub');
    if (el) el.textContent = sub || '';
  }

  // ── Dados do pagador (salvos no checkout) ─────────────────────────────────
  function getPayer() {
    try {
      return {
        name:  localStorage.getItem('xxpay_payer_name')  || 'Cliente',
        email: localStorage.getItem('xxpay_payer_email') || 'cliente@email.it',
      };
    } catch(e) {
      return { name: 'Cliente', email: 'cliente@email.it' };
    }
  }

  // ── Criar pagamento ───────────────────────────────────────────────────────
  function createPayment(opts, params) {
    var payer   = getPayer();
    var total   = parseFloat(params.get('total')) || 868.75;
    var base    = w.location.href.split('?')[0];
    var src     = params.get('src');
    var returnUrl = base + '?total=' + total.toFixed(2) + '&taxa=' + opts.taxa.toFixed(2) +
      (src ? '&src=' + encodeURIComponent(src) : '');

    showOverlay('Generazione pagamento…');

    fetch('/api/criar-pagamento', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount:             opts.taxa,
        name:               payer.name,
        email:              payer.email,
        external_reference: 'upsell-' + Date.now(),
        return_url:         returnUrl,
      }),
    })
    .then(function(r){ return r.json().then(function(d){ return { ok: r.ok, data: d }; }); })
    .then(function(res) {
      if (!res.ok || !res.data || !res.data.id) {
        showOverlay('Errore nella generazione', '❌');
        setOverlaySub('La pagina verrà ricaricata tra 3 secondi…');
        setTimeout(function(){ w.location.reload(); }, 3000);
        return;
      }

      var payment    = res.data;
      var nextAction = payment.next_action;

      if (nextAction && nextAction.type === 'redirect' && nextAction.url) {
        try { localStorage.setItem('xxpay_upsell_pending_id', payment.id); } catch(e){}
        showOverlay('Reindirizzamento a Satispay…', '🔴');
        setOverlaySub('Verrai reindirizzato all\'app Satispay per confermare il pagamento.');
        setTimeout(function(){ w.location.href = nextAction.url; }, 900);
      } else {
        // Push / conferma immediata
        startPolling(payment.id, opts, params);
      }
    })
    .catch(function() {
      showOverlay('Errore di rete', '❌');
      setOverlaySub('Controlla la connessione e ricarica la pagina.');
    });
  }

  // ── Polling ───────────────────────────────────────────────────────────────
  function startPolling(paymentId, opts, params) {
    showOverlay('Verifica pagamento in corso…');
    setOverlaySub('Puoi chiudere il Satispay e tornare qui se hai già confermato.');

    var attempts = 0;
    var interval = null;

    function check() {
      if (++attempts > MAX_POLL_ATTEMPTS) {
        clearInterval(interval);
        showOverlay('Tempo scaduto', '⏰');
        setOverlaySub('Contatta il supporto se il pagamento è stato effettuato.');
        return;
      }

      fetch('/api/status-pagamento?id=' + encodeURIComponent(paymentId))
      .then(function(r){ return r.json(); })
      .then(function(data) {
        if (data.status === 'paid') {
          clearInterval(interval);
          onPaid(opts, params);
        } else if (data.status === 'failed' || data.status === 'cancelled') {
          clearInterval(interval);
          showOverlay('Pagamento non riuscito', '❌');
          setOverlaySub('La pagina verrà ricaricata tra 3 secondi…');
          setTimeout(function(){ w.location.reload(); }, 3000);
        }
        // 'pending' → continua
      })
      .catch(function(){/* rede instável — próxima tentativa */});
    }

    check(); // imediato
    interval = setInterval(check, POLL_INTERVAL_MS);
  }

  // ── Pagamento confirmado ──────────────────────────────────────────────────
  function onPaid(opts, params) {
    showOverlay('Pagamento confermato!', '✅');
    setOverlaySub('Preparazione del passo successivo…');
    setTimeout(function() {
      var dest = new URL(opts.nextPage, w.location.href);
      // Propaga todos os params existentes
      params.forEach(function(v, k) { dest.searchParams.set(k, v); });
      // Flag auto para o próximo upsell criar pagamento automaticamente
      dest.searchParams.set('auto', '1');
      // Remove taxa atual (o próximo upsell tem a sua)
      dest.searchParams.delete('taxa');
      w.location.href = dest.toString();
    }, 1000);
  }

  // ── API pública ───────────────────────────────────────────────────────────
  w.UpsellPay = {
    // Exposto para chamadas manuais (up5 btnPay)
    _create: function(opts, params) {
      createPayment(opts, params || new URLSearchParams(w.location.search));
    },
    init: function(opts) {
      // opts: { taxa: Number, nextPage: String }
      var params    = new URLSearchParams(w.location.search);
      var isAuto    = params.get('auto') === '1';

      // Verificar se voltou do Satispay (pending_id no localStorage)
      var pendingId = null;
      try { pendingId = localStorage.getItem('xxpay_upsell_pending_id'); } catch(e){}

      if (pendingId) {
        // Limpa antes de qualquer coisa
        try { localStorage.removeItem('xxpay_upsell_pending_id'); } catch(e){}
        startPolling(pendingId, opts, params);
        return;
      }

      if (isAuto) {
        // Veio de um pagamento confirmado — cria automaticamente
        createPayment(opts, params);
        return;
      }

      // Modo manual — conectar CTA existente na página
      var cta = document.getElementById('btnCta');
      if (cta) {
        cta.addEventListener('click', function(e) {
          e.preventDefault();
          createPayment(opts, params);
        });
      }

      // up4 tem btnConclude em vez de btnCta
      var conclude = document.getElementById('btnConclude');
      if (conclude) {
        conclude.addEventListener('click', function(e) {
          e.preventDefault();
          createPayment(opts, params);
        });
      }
    },
  };

})(window);
