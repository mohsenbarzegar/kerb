"use strict";
/*
 * Kerb engine — a faithful JavaScript port of restrictions.py.
 * Same input (OSM elements with tags + centre), same verdicts.
 * Tested against the Python engine on identical snapshot features.
 */
(function (global) {

const SIDES = ["left", "right", "both"];
const NO_PARK_VALUES = new Set(["no", "no_parking", "no_stopping", "no_standing"]);
const HUMAN_LABELS = {
  no: "no parking", no_parking: "no parking", no_stopping: "no stopping",
  no_standing: "no standing", loading_only: "loading only",
  residents_only: "residents / permit holders only",
  separate: "separately mapped parking",
};
const PERMITTED_ORIENTATIONS = new Set(
  ["parallel", "perpendicular", "diagonal", "marked", "yes", "on_street", "street_side"]);

function humanize(label) {
  if (!label) return "no parking";
  return HUMAN_LABELS[label] || label.replace(/_/g, " ");
}

const PAY_LABELS = {
  coins: "coins", cash: "cash", notes: "banknotes", cards: "cards",
  credit_cards: "credit cards", debit_cards: "debit cards",
  contactless: "contactless", app: "app", mobile_app: "mobile app",
  mobile_phone: "mobile phone", telephone: "phone",
  ringgo: "RingGo app", paybyphone: "PayByPhone app",
  justpark: "JustPark app", parkonomy: "Parkonomy",
  electronic_purses: "electronic purse", cheque: "cheque",
  tokens: "tokens", vouchers: "vouchers",
};
const PAY_ORDER = ["coins", "cash", "notes", "cards", "credit_cards", "debit_cards",
  "contactless", "ringgo", "paybyphone", "justpark", "app",
  "mobile_app", "mobile_phone", "telephone", "electronic_purses",
  "cheque", "tokens", "vouchers"];

function paymentMethods(tags) {
  const found = Object.keys(tags)
    .filter(k => k.startsWith("payment:") && tags[k] === "yes")
    .map(k => k.slice("payment:".length));
  found.sort((a, b) => {
    const ia = PAY_ORDER.includes(a) ? PAY_ORDER.indexOf(a) : 99;
    const ib = PAY_ORDER.includes(b) ? PAY_ORDER.indexOf(b) : 99;
    return ia - ib || (a < b ? -1 : a > b ? 1 : 0);
  });
  return found.map(m => PAY_LABELS[m] || m.replace(/_/g, " "));
}

function detailsFor(f) {
  const d = {};
  const tags = f.tags, extra = f.extra || {};
  const hours = extra.opening_hours || tags.opening_hours;
  if (hours) d.hours = hours;
  const price = extra.charge || tags.charge;
  if (price) d.price = price;
  const cond = extra["fee:conditional"] || tags["fee:conditional"];
  if (cond) d.price_note = cond;
  const pays = paymentMethods(tags);
  if (pays.length) d.pay_by = pays;
  const maxstay = extra.maxstay || tags.maxstay;
  if (maxstay) d.max_stay = maxstay;
  const website = extra.website || tags.website || tags["contact:website"];
  if (website) d.website = website;
  return d;
}
function sidePhrase(side) { return side === "both" ? "both sides" : `the ${side} side`; }

function get(tags, ...keys) {
  for (const k of keys) {
    if (k in tags && tags[k] !== null && tags[k] !== undefined && tags[k] !== "") return tags[k];
  }
  return null;
}

function parseSide(tags, side) {
  const curVal = get(tags, `parking:${side}`);
  const curRestr = get(tags, `parking:${side}:restriction`);
  const curRestrCond = get(tags, `parking:${side}:restriction:conditional`);
  let laneVal = get(tags, `parking:lane:${side}`);
  let condVal = get(tags, `parking:condition:${side}`);
  const condTime = get(tags, `parking:condition:${side}:time_interval`);
  if (side === "both") {
    laneVal = laneVal || get(tags, "parking:lane:both");
    condVal = condVal || get(tags, "parking:condition:both");
  }
  if (curVal === null && laneVal === null && curRestr === null && condVal === null) return null;

  const sr = { side, permitted: null, restriction: null, fee: null, maxstay: null, note: null };

  let restr = curRestr || (NO_PARK_VALUES.has(laneVal) ? laneVal : null);
  if (NO_PARK_VALUES.has(curVal)) restr = restr || curVal;
  if (restr) {
    sr.permitted = false;
    sr.restriction = restr;
    if (curRestrCond) sr.note = `Conditional: ${curRestrCond}`;
    return sr;
  }

  if (PERMITTED_ORIENTATIONS.has(curVal) || curVal === "yes") sr.permitted = true;
  else if (PERMITTED_ORIENTATIONS.has(laneVal)) sr.permitted = true;
  else if (curVal === "separate") {
    sr.permitted = null;
    sr.note = "Parking is mapped as a separate feature nearby.";
    return sr;
  }

  const feeTag = get(tags, `parking:${side}:fee`, "parking:fee", "fee");
  const cond = condVal;
  if (feeTag === "no") sr.fee = "free";
  else if (feeTag === "yes") sr.fee = "paid";
  if (cond) {
    if (["free", "no", "unlimited"].includes(cond)) {
      sr.fee = sr.fee || "free";
      if (sr.permitted === null && ["free", "unlimited"].includes(cond)) sr.permitted = true;
    } else if (["ticket", "paid", "disc", "voucher"].includes(cond)) {
      sr.fee = "paid";
      if (sr.permitted === null) sr.permitted = true;
    } else if (cond === "residents") {
      sr.fee = "residents";
      sr.restriction = "residents_only";
      if (sr.permitted === null) sr.permitted = false;
    } else if (cond === "no") {
      sr.permitted = false;
      sr.restriction = sr.restriction || "no_parking";
    }
    if (condTime) sr.note = `Condition applies: ${condTime}`;
  }

  sr.maxstay = get(tags, `parking:${side}:maxstay`, `parking:condition:${side}:maxstay`, "maxstay");
  return sr;
}

function parseFeature(el) {
  const tags = el.tags || {};
  const etype = el.type, eid = el.id;
  if (etype === null || etype === undefined || eid === null || eid === undefined) return null;
  let lat, lon;
  if (etype === "node") { lat = el.lat; lon = el.lon; }
  else { const c = el.center || {}; lat = c.lat; lon = c.lon; }
  if (lat === null || lat === undefined || lon === null || lon === undefined) return null;

  if (tags.amenity === "parking") {
    const extra = {};
    for (const k of ["fee", "capacity", "opening_hours", "access", "surface", "operator",
                     "park_ride", "charge", "fee:conditional", "maxstay"]) {
      if (k in tags) extra[k] = tags[k];
    }
    const website = tags.website || tags["contact:website"];
    if (website) extra.website = website;
    return { osm_type: etype, osm_id: eid, kind: "car_park", name: tags.name || null,
             lat, lon, sides: [], extra, tags };
  }

  const sides = [];
  const seen = new Set();
  for (const side of SIDES) {
    const sr = parseSide(tags, side);
    if (sr !== null) { sides.push(sr); seen.add(side); }
  }
  if (!sides.length) return null;
  let kept = sides;
  if (seen.has("both") && (seen.has("left") || seen.has("right"))) {
    kept = sides.filter(s => s.side !== "both");
  }
  return { osm_type: etype, osm_id: eid, kind: "street_segment",
           name: tags.name || tags.ref || null, lat, lon, sides: kept, extra: {}, tags };
}

const TIME_RANGE = /(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/;

function intervalCovers(interval, at) {
  const m = TIME_RANGE.exec(interval);
  if (!m) return null;
  const start = (+m[1]) * 60 + (+m[2]);
  const end = (+m[3]) * 60 + (+m[4]);
  const t = at.getHours() * 60 + at.getMinutes();
  // JS getDay(): Sun=0..Sat=6 -> convert to Mon=0..Sun=6
  const weekday = (at.getDay() + 6) % 7;
  let dayOk = true;
  const dayPart = interval.slice(0, m.index).trim();
  if (dayPart) {
    const days = { Mo: 0, Tu: 1, We: 2, Th: 3, Fr: 4, Sa: 5, Su: 6 };
    dayOk = false;
    for (const token of dayPart.split(/[,\s]+/)) {
      if (!token) continue;
      if (token.includes("-")) {
        const [a, b] = token.split("-", 2);
        if (a in days && b in days && days[a] <= weekday && weekday <= days[b]) dayOk = true;
      } else if (token in days && days[token] === weekday) dayOk = true;
    }
  }
  const inRange = start <= end ? (start <= t && t <= end) : (t >= start || t <= end);
  return dayOk && inRange;
}

function verdictFor(feature, at) {
  if (feature.kind === "car_park") {
    const fee = feature.extra.fee;
    const feeTxt = fee === "no" ? "free" : fee === "yes" ? "paid" : "fee unknown";
    const access = feature.extra.access;
    const accessTxt = access && !["yes", "public"].includes(access) ? `; access: ${access}` : "";
    let summary = `Off-street car park (${feeTxt}${accessTxt}).`;
    const det = detailsFor(feature);
    if (fee === "yes") {
      summary += det.price ? ` Price: ${det.price}.` : " Price not published in open data.";
    }
    if (det.hours) summary += ` Hours: ${det.hours}.`;
    if (det.pay_by) summary += ` Pay by: ${det.pay_by.join(", ")}.`;
    if (det.max_stay) summary += ` Max stay: ${det.max_stay}.`;
    return { verdict: "car_park", summary, confidence: fee ? "medium" : "low" };
  }
  const parts = [];
  let anyPerm = false, anyProhib = false;
  for (const s of feature.sides) {
    if (s.permitted === true) {
      anyPerm = true;
      let seg = `${sidePhrase(s.side)}: parking permitted`;
      if (s.fee) seg += `, ${s.fee}`;
      if (s.maxstay) seg += `, max stay ${s.maxstay}`;
      if (s.note) {
        const covers = at ? intervalCovers(s.note.replace("Condition applies: ", ""), at) : null;
        if (covers === true) seg += ` (${s.note} — applies at the requested time)`;
        else if (covers === false) seg += ` (${s.note} — does not apply at the requested time)`;
        else seg += ` (${s.note})`;
      }
      parts.push(seg);
    } else if (s.permitted === false) {
      anyProhib = true;
      parts.push(`${sidePhrase(s.side)}: ${humanize(s.restriction)}`);
    } else {
      parts.push(`${sidePhrase(s.side)}: unclear from open data`);
    }
  }
  let verdict, conf;
  if (anyPerm && !anyProhib) { verdict = "likely_ok"; conf = "medium"; }
  else if (anyProhib && !anyPerm) { verdict = "restricted"; conf = "medium"; }
  else if (anyPerm && anyProhib) { verdict = "mixed_by_side"; conf = "medium"; }
  else { verdict = "unknown"; conf = "low"; }
  return { verdict, summary: parts.join("; "), confidence: conf };
}

function toDict(f) {
  const d = { osm: `${f.osm_type}/${f.osm_id}`, kind: f.kind, name: f.name,
              lat: Math.round(f.lat * 1e6) / 1e6, lon: Math.round(f.lon * 1e6) / 1e6 };
  if (f.distance_m !== undefined && f.distance_m !== null) d.distance_m = f.distance_m;
  if (f.kind === "car_park") {
    for (const k of ["fee", "capacity", "opening_hours", "access", "surface", "operator"]) {
      if (k in f.extra) d[k] = f.extra[k];
    }
  }
  const details = detailsFor(f);
  if (Object.keys(details).length) d.details = details;
  if (f.kind !== "car_park") {
    d.sides = f.sides.map(s => {
      const row = { side: s.side,
        parking: s.permitted === true ? "permitted" : s.permitted === false ? "prohibited" : "unknown" };
      if (s.restriction) row.restriction = s.restriction;
      if (s.fee) row.fee = s.fee;
      if (s.maxstay) row.maxstay = s.maxstay;
      if (s.note) row.note = s.note;
      return row;
    });
  }
  return d;
}

function haversineM(lat1, lon1, lat2, lon2) {
  const r = 6371000.0;
  const p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180;
  const dp = (lat2 - lat1) * Math.PI / 180, dl = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return Math.round(2 * r * Math.asin(Math.sqrt(a)));
}

const KerbEngine = { parseFeature, verdictFor, toDict, haversineM, intervalCovers };
if (typeof module !== "undefined" && module.exports) module.exports = KerbEngine;
global.KerbEngine = KerbEngine;

})(typeof window !== "undefined" ? window : globalThis);
