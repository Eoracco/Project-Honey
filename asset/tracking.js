/**
 * WildRoot — shared purchase reporting.
 *
 * Ported from the React reference modules (adsConversion.ts / OrderSuccess.tsx)
 * to plain ES5 for this static site. Same contract, same guards:
 *
 *  1. transaction_id is mandatory. Without an order id Google Ads cannot
 *     server-side dedupe, which is exactly why every refresh used to count
 *     again and why conversions landed at the $1 fallback value.
 *  2. value must be a finite positive number, or we skip rather than send a
 *     bogus conversion.
 *  3. Local dedupe by order id (30-day TTL, self-pruning) so a refreshed,
 *     back-navigated, or re-opened confirmation page reports once.
 *
 * Difference from the React original worth knowing: there the trigger is the
 * backend confirming the order. Here there is no backend — the trigger is the
 * Stripe redirect landing on /thank-you. Until the Stripe webhook -> server
 * side reporting exists, that redirect IS the confirmation signal.
 */
window.WRTracking = (function () {
  'use strict';

  var AW_CONVERSION_ID  = 'AW-18030883032';
  var AW_PURCHASE_LABEL = 'X5kBCIrQzuQcENjh5ZVD';
  var AW_PURCHASE_SEND_TO = AW_CONVERSION_ID + '/' + AW_PURCHASE_LABEL;

  var DEDUPE_STORAGE_KEY = 'wr_reported_purchases';
  var DEDUPE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

  function readReported() {
    try {
      var raw = window.localStorage.getItem(DEDUPE_STORAGE_KEY);
      if (!raw) return {};
      var parsed = JSON.parse(raw), now = Date.now(), out = {};
      for (var k in parsed) {                       /* prune expired as we go */
        if (Object.prototype.hasOwnProperty.call(parsed, k) &&
            now - parsed[k] < DEDUPE_TTL_MS) out[k] = parsed[k];
      }
      return out;
    } catch (e) { return {}; }
  }

  function markReported(transactionId) {
    try {
      var map = readReported();
      map[transactionId] = Date.now();
      window.localStorage.setItem(DEDUPE_STORAGE_KEY, JSON.stringify(map));
    } catch (e) {
      /* localStorage unavailable (private mode): dedupe degrades to
         once-per-page-load, which the caller's own guard already provides. */
    }
  }

  function hasReported(transactionId) {
    if (readReported()[transactionId]) return true;
    /* back-compat: keys written by the first version of this tracking */
    try { return !!window.localStorage.getItem('wr_purchase_sent_' + transactionId); }
    catch (e) { return false; }
  }

  function validate(tag, payload) {
    if (!payload.transactionId || String(payload.transactionId).trim() === '') {
      console.warn('[' + tag + '] missing transaction_id, purchase not reported');
      return false;
    }
    if (typeof payload.value !== 'number' || !isFinite(payload.value) || payload.value <= 0) {
      console.warn('[' + tag + '] invalid value, purchase not reported',
                   { transactionId: payload.transactionId, value: payload.value });
      return false;
    }
    if (typeof window.gtag !== 'function') {
      console.warn('[' + tag + '] gtag not ready, purchase not reported',
                   { transactionId: payload.transactionId });
      return false;
    }
    return true;
  }

  /** Google Ads conversion. Returns true if it actually fired. */
  function reportAdsPurchase(payload) {
    if (!validate('ads', payload)) return false;
    if (hasReported(payload.transactionId)) return false;

    var params = {
      send_to:        AW_PURCHASE_SEND_TO,
      transaction_id: String(payload.transactionId),
      value:          Number(payload.value.toFixed(2)),
      currency:       payload.currency || 'USD'
    };
    if (typeof payload.newCustomer === 'boolean') params.new_customer = payload.newCustomer;

    window.gtag('event', 'conversion', params);
    markReported(payload.transactionId);
    return true;
  }

  /** GA4 purchase — value + currency + transaction_id + items, always together. */
  function reportGa4Purchase(payload) {
    if (!validate('ga4', payload)) return false;

    window.gtag('event', 'purchase', {
      transaction_id: String(payload.transactionId),
      value:          Number(payload.value.toFixed(2)),
      currency:       payload.currency || 'USD',
      items:          payload.items || []
    });
    return true;
  }

  return {
    AW_CONVERSION_ID:    AW_CONVERSION_ID,
    AW_PURCHASE_LABEL:   AW_PURCHASE_LABEL,
    AW_PURCHASE_SEND_TO: AW_PURCHASE_SEND_TO,
    hasReported:         hasReported,
    markReported:        markReported,
    reportAdsPurchase:   reportAdsPurchase,
    reportGa4Purchase:   reportGa4Purchase
  };
})();
